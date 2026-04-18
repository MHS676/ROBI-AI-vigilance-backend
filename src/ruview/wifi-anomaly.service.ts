import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EventsGateway } from '../events/events.gateway'
import { WS_EVENTS, AlertSeverity } from '../mqtt/mqtt.constants'
import { CsiPayload } from './interfaces/csi-payload.interface'

// ─────────────────────────────────────────────────────────────────────────────
// ALGORITHM CONSTANTS
//
// The detector maintains a per-node Exponential Moving Average (EMA) of the
// mean CSI subcarrier amplitude.  On every new frame it asks:
//
//   "Is this frame's mean amplitude more than ANOMALY_THRESHOLD × the EMA?"
//
// A genuine fall produces a characteristic signature in 802.11n CSI:
//
//   1. **Pre-fall baseline**: moderate, slowly-varying amplitude EMA
//      (person seated — small, periodic Doppler from breathing)
//
//   2. **Fall burst**: rapid, large-amplitude spike as the body sweeps
//      through the WiFi field — mean amplitude >> EMA
//
//   3. **Post-fall stillness**: very low amplitude — person lying motionless
//      (though we detect at step 2 and confirm with a post-burst drop in the
//       FALL_CONFIRM window)
//
// Why EMA vs. simple average?
//   • EMA adapts to gradual environmental drift (furniture moved, doors open)
//     without requiring a fixed warm-up period.
//   • EMA is computed in O(1) memory — safe at ~10 Hz × 525 nodes.
//   • α = 0.05 gives an effective window of ~1/α = 20 frames ≈ 2 seconds,
//     long enough to form a stable baseline but short enough to re-adapt
//     when the room state genuinely changes.
// ─────────────────────────────────────────────────────────────────────────────

/** EMA smoothing factor.  α ∈ (0, 1).  Lower = longer memory. */
const EMA_ALPHA = 0.05

/**
 * A frame triggers a POTENTIAL anomaly when its mean amplitude is this many
 * times larger than the current EMA.  3× corresponds roughly to a Z-score of
 * ~2.5 for a normally distributed RSSI signal.
 */
const ANOMALY_THRESHOLD = 3.0

/**
 * After the anomaly spike, at least this many consecutive frames must have
 * mean amplitude ≤ EMA × POST_SPIKE_RATIO to confirm a fall (person still).
 * Filters out brief bumps, hand-waves, or objects being placed on the desk.
 */
const POST_SPIKE_RATIO = 0.5

/** Number of frames in the post-spike confirmation window. */
const CONFIRM_WINDOW = 3

/** Minimum frames of EMA warm-up required before anomaly detection is armed. */
const WARMUP_FRAMES = 10

/** Minimum CSI samples per frame to compute a meaningful mean. */
const MIN_CSI_SAMPLES = 8

/** Hard upper cap on the reported confidence value. */
const CONFIDENCE_MAX = 0.95

/** How long (ms) to suppress repeated fall alerts for the same node. */
const COOLDOWN_MS = 30_000

// ─────────────────────────────────────────────────────────────────────────────
// PER-NODE STATE
// One of these is maintained in memory for every ESP32 node that sends CSI.
// ─────────────────────────────────────────────────────────────────────────────

interface NodeState {
  /** Current EMA of mean CSI amplitude. */
  ema: number
  /** How many frames have been processed (gate for warm-up). */
  frameCount: number
  /**
   * Rolling buffer of the last CONFIRM_WINDOW mean-amplitude values,
   * recorded AFTER the most recent anomaly spike.
   * Reset each time we enter a new spike or when a fall is confirmed.
   */
  postSpikeBuffer: number[]
  /**
   * True when we have detected a spike above ANOMALY_THRESHOLD and are
   * waiting for the post-spike drop to confirm (or reject) a fall.
   */
  inSpike: boolean
  /**
   * Unix timestamp (ms) of the last confirmed fall alert.
   * Used for per-node cooldown to avoid alert floods.
   */
  lastAlertAt: number
  /**
   * Mean-amplitude value of the spike frame that triggered inSpike.
   * Stored so the confidence formula can reference the spike magnitude.
   */
  spikeAmplitude: number
}

// ─────────────────────────────────────────────────────────────────────────────
// ANOMALY RESULT
// ─────────────────────────────────────────────────────────────────────────────

export interface AnomalyResult {
  /** True only when spike + post-spike drop are both confirmed. */
  detected: boolean
  /** Confidence score 0.0–CONFIDENCE_MAX */
  confidence: number
  /** Mean amplitude of the current frame */
  currentAmplitude: number
  /** EMA at the time of evaluation */
  emaAtDetection: number
  /** Ratio currentAmplitude / ema — how far above baseline */
  deviationRatio: number
}

// ─────────────────────────────────────────────────────────────────────────────
// WifiAnomalyService
//
// Dual role:
//   1. **Detection**  — maintains per-node EMA state, runs the anomaly
//                       algorithm on each incoming CSI frame.
//   2. **Response**   — saves confirmed anomalies to the AuditLog table
//                       in PostgreSQL and broadcasts a WebSocket alert.
//
// This service is intentionally separate from RuViewEngineService which uses
// a different (variance-based spike+drop) algorithm.  Running both in parallel
// provides defence-in-depth against missed detections.
//
// Integration point: RuViewController calls both
//   await this.ruviewService.process(data)   ← variance spike+drop
//   await this.anomalyService.process(data)  ← EMA moving-average
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class WifiAnomalyService {
  private readonly logger = new Logger(WifiAnomalyService.name)

  /**
   * Per-node EMA state keyed by nodeId (ESP32 MAC address or CUID).
   * Created lazily on first frame from each node.
   */
  private readonly nodeStates = new Map<string, NodeState>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  // ── Public entry point ────────────────────────────────────────────────────

  /**
   * Main processing pipeline for a single CSI payload.
   *
   * Steps:
   *   1. Guard: validate nodeId and minimum CSI length
   *   2. Compute mean amplitude of the CSI frame
   *   3. Update per-node EMA
   *   4. Run anomaly / fall detection state machine
   *   5. If fall confirmed: resolve node → center/table, save AuditLog, emit WS
   *
   * @param payload  Raw CSI payload from the MQTT broker
   */
  async process(payload: CsiPayload): Promise<void> {
    const { nodeId, csi } = payload

    // ── Guard ─────────────────────────────────────────────────────────────
    if (!nodeId) {
      this.logger.debug('WifiAnomaly: missing nodeId — skipping')
      return
    }

    if (!Array.isArray(csi) || csi.length < MIN_CSI_SAMPLES) {
      this.logger.debug(
        `WifiAnomaly [${nodeId}]: CSI array too short (${csi?.length ?? 0}) — skipping`,
      )
      return
    }

    // ── Step 1: Mean amplitude of this frame ──────────────────────────────
    const amplitude = this.meanAmplitude(csi)

    // ── Step 2: Initialise or update per-node EMA state ───────────────────
    const state = this.getOrCreateState(nodeId)
    const prevEma = state.ema

    // Warm-up: before WARMUP_FRAMES just accumulate into EMA without alerting
    state.frameCount += 1
    state.ema = state.frameCount === 1
      ? amplitude // bootstrap EMA with first observation
      : EMA_ALPHA * amplitude + (1 - EMA_ALPHA) * state.ema

    if (state.frameCount < WARMUP_FRAMES) {
      this.logger.debug(
        `WifiAnomaly [${nodeId}]: warm-up ${state.frameCount}/${WARMUP_FRAMES} ema=${state.ema.toFixed(2)}`,
      )
      return
    }

    // ── Step 3: Anomaly state machine ─────────────────────────────────────
    const result = this.evaluate(state, amplitude, prevEma)

    if (!result.detected) return

    // ── Step 4: Cooldown gate ─────────────────────────────────────────────
    if (Date.now() - state.lastAlertAt < COOLDOWN_MS) {
      this.logger.debug(
        `WifiAnomaly [${nodeId}]: fall confirmed but still in cooldown — suppressing`,
      )
      return
    }
    state.lastAlertAt = Date.now()
    state.inSpike = false
    state.postSpikeBuffer = []

    this.logger.warn(
      `🚨 WifiAnomaly FALL DETECTED — node=${nodeId} ` +
        `amplitude=${result.currentAmplitude.toFixed(2)} ` +
        `ema=${result.emaAtDetection.toFixed(2)} ` +
        `deviation=${result.deviationRatio.toFixed(2)}× ` +
        `conf=${result.confidence.toFixed(3)}`,
    )

    // ── Step 5: Resolve node → center/table, persist, broadcast ──────────
    await this.saveAndDispatch(nodeId, payload.centerId, result)
  }

  // ── EMA anomaly state machine ─────────────────────────────────────────────

  /**
   * Runs the EMA-based anomaly state machine on a single frame.
   *
   * State transitions:
   *
   *   NORMAL  → SPIKE   when amplitude > ema × ANOMALY_THRESHOLD
   *   SPIKE   → CONFIRM when the last CONFIRM_WINDOW amplitudes all ≤ ema × POST_SPIKE_RATIO
   *   SPIKE   → NORMAL  if CONFIRM_WINDOW frames pass without the drop condition
   *   CONFIRM → NORMAL  (fall reported, then reset)
   *
   * @param state    The mutable per-node state object (mutated in-place)
   * @param amplitude  Mean amplitude of the current CSI frame
   * @param ema      EMA value *before* this frame was applied (snapshot)
   * @returns        AnomalyResult — detected=true only on confirmed fall
   */
  private evaluate(state: NodeState, amplitude: number, ema: number): AnomalyResult {
    const noDetection: AnomalyResult = {
      detected: false,
      confidence: 0,
      currentAmplitude: amplitude,
      emaAtDetection: ema,
      deviationRatio: amplitude / (ema || 1),
    }

    const deviationRatio = amplitude / (ema || 1)

    // ── Not yet in a spike: check if this frame IS the spike ──────────────
    if (!state.inSpike) {
      if (deviationRatio >= ANOMALY_THRESHOLD) {
        state.inSpike = true
        state.spikeAmplitude = amplitude
        state.postSpikeBuffer = []
        this.logger.debug(
          `WifiAnomaly: spike entered — deviation=${deviationRatio.toFixed(2)}× ema=${ema.toFixed(2)}`,
        )
      }
      return noDetection
    }

    // ── Currently in spike: accumulate post-spike frames ─────────────────
    state.postSpikeBuffer.push(amplitude)

    if (state.postSpikeBuffer.length < CONFIRM_WINDOW) {
      // Not enough post-spike frames yet — keep waiting
      return noDetection
    }

    // ── Check post-spike drop condition ───────────────────────────────────
    const postMean =
      state.postSpikeBuffer.reduce((a, b) => a + b, 0) / state.postSpikeBuffer.length
    const postRatio = postMean / (ema || 1)

    if (postRatio > POST_SPIKE_RATIO) {
      // Post-spike variance is too high — person is still moving, not a fall
      // Reset the spike gate so we can detect the next real event
      this.logger.debug(
        `WifiAnomaly: spike cancelled — post-spike ratio=${postRatio.toFixed(2)} > ${POST_SPIKE_RATIO}`,
      )
      state.inSpike = false
      state.postSpikeBuffer = []
      return noDetection
    }

    // ── Confirmed fall: compute confidence ────────────────────────────────
    // Higher spike deviation + deeper post-spike drop → higher confidence.
    // spikeRatio / (ANOMALY_THRESHOLD × 2) normalises the spike magnitude.
    // (1 - postRatio / POST_SPIKE_RATIO) scores the drop depth.
    const spikeRatio = state.spikeAmplitude / (ema || 1)
    const rawConf =
      (spikeRatio / (ANOMALY_THRESHOLD * 2)) * (1 - postRatio / POST_SPIKE_RATIO)
    const confidence = Math.min(Math.max(rawConf, 0.5), CONFIDENCE_MAX)

    return {
      detected: true,
      confidence,
      currentAmplitude: state.spikeAmplitude,
      emaAtDetection: ema,
      deviationRatio: spikeRatio,
    }
  }

  // ── Node → center/table resolution + persistence + broadcast ─────────────

  /**
   * Resolves the ESP32 node's center and table from the database, then:
   *   1. Creates an `AuditLog` record with full diagnostic metadata
   *   2. Emits the `alert:fall_detected` WebSocket event to the center room
   *      and the SUPER_ADMIN room
   *
   * DB failure is non-fatal — the WebSocket broadcast is attempted even if
   * the DB write fails, so the operator is notified in real time.
   *
   * @param nodeId       MAC address or CUID of the ESP32 node
   * @param hintCenterId Optional centerId hint from the MQTT payload
   * @param result       AnomalyResult from the EMA state machine
   */
  private async saveAndDispatch(
    nodeId: string,
    hintCenterId: string | undefined,
    result: AnomalyResult,
  ): Promise<void> {
    // ── Resolve EspNode → center + table ─────────────────────────────────
    let centerId = hintCenterId
    let centerName = 'Unknown'
    let tableId: string | null = null
    let tableName = 'Unknown'
    let tableNumber: number | null = null

    try {
      const node = await this.prisma.espNode.findFirst({
        where: {
          OR: [{ macAddress: nodeId }, { id: nodeId }],
          ...(hintCenterId ? { centerId: hintCenterId } : {}),
          isActive: true,
        },
        include: {
          center: { select: { id: true, name: true } },
        },
      })

      if (node) {
        centerId = node.centerId
        centerName = node.center.name

        // Find the first active table in the same center that has a wifi zone
        const table = await this.prisma.table.findFirst({
          where: { centerId: node.centerId, isActive: true, NOT: { wifiZoneX: null } },
          select: { id: true, name: true, tableNumber: true },
        })

        if (table) {
          tableId = table.id
          tableName = table.name
          tableNumber = table.tableNumber
        }
      } else {
        this.logger.warn(
          `WifiAnomaly [${nodeId}]: EspNode not found in DB — saving audit log without table`,
        )
      }
    } catch (lookupErr: any) {
      this.logger.error(
        `WifiAnomaly [${nodeId}]: DB lookup failed: ${lookupErr?.message}`,
        lookupErr?.stack,
      )
    }

    // centerId must be known to satisfy the required FK on AuditLog
    if (!centerId) {
      this.logger.error(
        `WifiAnomaly [${nodeId}]: cannot determine centerId — skipping AuditLog + WS`,
      )
      return
    }

    // ── 1. Persist AuditLog ───────────────────────────────────────────────
    let auditLogId: string | null = null
    try {
      const log = await this.prisma.auditLog.create({
        data: {
          eventType: 'FALL_DETECTED',
          source: 'WIFI_CSI_EMA',
          nodeId,
          emaValue: result.emaAtDetection,
          currentAmplitude: result.currentAmplitude,
          deviationRatio: result.deviationRatio,
          confidence: result.confidence,
          centerId,
          tableId,
          metadata: {
            algorithm: 'EMA_SPIKE_DROP',
            emaAlpha: EMA_ALPHA,
            anomalyThreshold: ANOMALY_THRESHOLD,
            postSpikeRatio: POST_SPIKE_RATIO,
            confirmWindow: CONFIRM_WINDOW,
          },
        },
      })
      auditLogId = log.id
      this.logger.log(
        `💾 AuditLog saved — id=${log.id} type=FALL_DETECTED ` +
          `node=${nodeId} conf=${result.confidence.toFixed(3)}`,
      )
    } catch (dbErr: any) {
      this.logger.error(
        `WifiAnomaly: AuditLog save failed: ${dbErr?.message}`,
        dbErr?.stack,
      )
      // Non-fatal — still broadcast WS
    }

    // ── 2. Build and broadcast WebSocket event ────────────────────────────
    const wsPayload = {
      auditLogId,
      type: 'FALL_DETECTED',
      source: 'WIFI_CSI_EMA',
      nodeId,
      tableId,
      tableName,
      tableNumber,
      centerId,
      centerName,
      confidence: result.confidence,
      emaValue: result.emaAtDetection,
      currentAmplitude: result.currentAmplitude,
      deviationRatio: result.deviationRatio,
      algorithm: 'EMA_SPIKE_DROP',
      detectedAt: new Date().toISOString(),
    }

    try {
      const envelope = this.events.buildEnvelope(
        centerId,
        centerName,
        'CRITICAL' as AlertSeverity,
        wsPayload,
      )
      // WS_EVENTS.FALL_DETECTED = 'alert:fall_detected'
      this.events.emitToCenterAndSuperAdmin(centerId, WS_EVENTS.FALL_DETECTED, envelope)

      this.logger.warn(
        `📡 WS → ${WS_EVENTS.FALL_DETECTED} ` +
          `center="${centerName}" table="${tableName}" ` +
          `conf=${result.confidence.toFixed(3)}`,
      )
    } catch (wsErr: any) {
      this.logger.error(
        `WifiAnomaly: WS broadcast failed: ${wsErr?.message}`,
        wsErr?.stack,
      )
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Computes the arithmetic mean of the CSI amplitude array.
   * We interpret each element as a subcarrier amplitude value.
   * Negative values (phase-only representations) are abs()-corrected.
   */
  private meanAmplitude(csi: number[]): number {
    const sum = csi.reduce((acc, v) => acc + Math.abs(v), 0)
    return sum / csi.length
  }

  /**
   * Returns the NodeState for the given nodeId, creating a fresh one if this
   * is the first frame from this node.
   */
  private getOrCreateState(nodeId: string): NodeState {
    if (!this.nodeStates.has(nodeId)) {
      this.nodeStates.set(nodeId, {
        ema: 0,
        frameCount: 0,
        postSpikeBuffer: [],
        inSpike: false,
        lastAlertAt: 0,
        spikeAmplitude: 0,
      })
    }
    return this.nodeStates.get(nodeId)!
  }

  // ── Cache management ──────────────────────────────────────────────────────

  /** Resets the EMA state for a specific node (e.g. after re-provisioning). */
  evictNodeState(nodeId: string): void {
    this.nodeStates.delete(nodeId)
    this.logger.debug(`WifiAnomaly: state evicted for node ${nodeId}`)
  }

  /** Returns a read-only snapshot of all current node EMA states (for debugging). */
  getNodeStates(): ReadonlyMap<string, Readonly<NodeState>> {
    return this.nodeStates
  }
}
