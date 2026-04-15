import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EventsGateway } from '../events/events.gateway'
import { WS_EVENTS, AlertSeverity } from '../mqtt/mqtt.constants'
import { CsiPayload, ResolvedTable, FallDetectionResult } from './interfaces/csi-payload.interface'

// ─────────────────────────────────────────────────────────────────────────────
// CSI FALL DETECTION ALGORITHM CONSTANTS
//
// These values are tuned for 802.11n 2.4 GHz CSI amplitude arrays collected
// at ~1–2 m range (typical customer service desk deployment).
//
// Reference implementations:
//   • Wi-Fall    (Wang et al., 2017)  — variance-window spike detection
//   • FallDeFi   (Palipana et al., 2018) — Doppler-shift + variance fusion
//   • WiDeep     (Kim et al., 2021)   — CNN on raw CSI
//
// The algorithm here is a lightweight implementation of the Wi-Fall approach:
//   1. Split CSI into non-overlapping windows of WINDOW_SIZE samples
//   2. Compute per-window variance
//   3. Spike:  any window whose variance > meanVariance × SPIKE_MULTIPLIER
//   4. Drop:   mean variance of all POST-spike windows < meanVariance × POST_SPIKE_RATIO
//   5. Confidence: function of spike magnitude + drop depth
// ─────────────────────────────────────────────────────────────────────────────

/** Spike must exceed baseline variance by this factor to be a fall candidate */
const SPIKE_MULTIPLIER = 3.0

/** Post-spike variance must fall below this fraction of baseline to confirm fall */
const POST_SPIKE_RATIO = 0.35

/** Non-overlapping window size for variance computation */
const WINDOW_SIZE = 5

/** Minimum CSI samples required for a valid detection attempt */
const MIN_CSI_SAMPLES = 15

/** Hard cap on reported confidence — CSI alone is not 100% reliable */
const CONFIDENCE_MAX = 0.92

/** Cache TTL in ms — node→table mapping is refreshed after this period */
const CACHE_TTL_MS = 60_000

// ─────────────────────────────────────────────────────────────────────────────
// NODE CACHE ENTRY
// ─────────────────────────────────────────────────────────────────────────────

interface NodeCacheEntry {
  tables: ResolvedTable[]
  centerId: string
  centerName: string
  fetchedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// RuViewEngineService
//
// Acts as the intelligence bridge between raw WiFi CSI readings from ESP32
// nodes and the Falcon alert pipeline.
//
// Data flow:
//   MQTT falcon/esp/wifi-sensing
//     ↓ RuViewController.handleWifiSensingRaw()
//     ↓ RuViewEngineService.process()
//       ├─ resolveNodeTables()       — EspNode → Table via Prisma
//       ├─ spatialFilter()           — wifiZone rectangle containment check
//       ├─ detectFall()              — CSI variance spike+drop algorithm
//       └─ saveAndDispatch()
//             ├─ prisma.alert.create()          — persist to DB
//             └─ events.emitToCenterAndSuperAdmin() — WebSocket broadcast
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class RuViewEngineService {
  private readonly logger = new Logger(RuViewEngineService.name)

  /**
   * In-memory cache: nodeId (MAC address) → resolved tables + center info.
   * Prevents a DB round-trip on every ~10 Hz MQTT message.
   * Entries are lazily evicted after CACHE_TTL_MS.
   */
  private readonly nodeCache = new Map<string, NodeCacheEntry>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  // ── Public entry point ────────────────────────────────────────────────────

  /**
   * Main processing pipeline for a single CSI payload.
   *
   * Steps:
   *   1. Validate payload (nodeId present, CSI array long enough)
   *   2. Resolve nodeId → EspNode → center → candidate Tables
   *   3. Apply spatial filter (wifi zone containment)
   *   4. Run CSI fall detection algorithm
   *   5. For each candidate table that passes: save Alert + emit WebSocket event
   */
  async process(payload: CsiPayload): Promise<void> {
    const { nodeId, csi, estimatedX, estimatedY } = payload

    // ── Guard: minimum payload validity ──────────────────────────────────
    if (!nodeId) {
      this.logger.warn('⚡ RuView: payload missing nodeId — discarding')
      return
    }

    if (!Array.isArray(csi) || csi.length < MIN_CSI_SAMPLES) {
      this.logger.debug(
        `⚡ RuView [${nodeId}]: CSI too short (${csi?.length ?? 0} samples, min ${MIN_CSI_SAMPLES}) — skipping`,
      )
      return
    }

    // ── Step 1: Resolve node → tables ────────────────────────────────────
    const resolved = await this.resolveNodeTables(nodeId, payload.centerId)
    if (!resolved) {
      this.logger.warn(
        `⚡ RuView [${nodeId}]: no matching EspNode found in DB — discarding payload`,
      )
      return
    }

    if (resolved.tables.length === 0) {
      this.logger.debug(
        `⚡ RuView [${nodeId}]: center "${resolved.centerName}" has no tables with WiFi zones configured`,
      )
      return
    }

    // ── Step 2: Spatial filter ────────────────────────────────────────────
    const candidateTables = this.spatialFilter(resolved.tables, estimatedX, estimatedY)

    if (candidateTables.length === 0) {
      this.logger.debug(
        `⚡ RuView [${nodeId}]: CSI disturbance at (${estimatedX},${estimatedY}) ` +
          `is outside all WiFi zones — discarding`,
      )
      return
    }

    // ── Step 3: Fall detection algorithm ─────────────────────────────────
    const fallResult = this.detectFall(csi)

    if (!fallResult.detected) {
      this.logger.debug(
        `⚡ RuView [${nodeId}]: no fall pattern detected ` +
          `(spikeValue=${fallResult.spikeValue.toFixed(2)} dropRatio=${fallResult.dropRatio.toFixed(2)})`,
      )
      return
    }

    this.logger.warn(
      `🚨 RuView FALL DETECTED — node=${nodeId} ` +
        `conf=${fallResult.confidence.toFixed(3)} ` +
        `spikeIdx=${fallResult.spikeIndex} ` +
        `dropRatio=${(fallResult.dropRatio * 100).toFixed(1)}% ` +
        `center="${resolved.centerName}"`,
    )

    // ── Step 4: Save to DB + broadcast WebSocket alert ───────────────────
    for (const table of candidateTables) {
      await this.saveAndDispatch(
        table,
        { id: resolved.centerId, name: resolved.centerName },
        nodeId,
        fallResult.confidence,
      )
    }
  }

  // ── Node → Tables mapping ─────────────────────────────────────────────────

  /**
   * Resolves a nodeId (ESP32 MAC address or DB id) to:
   *   - The list of Tables in the same center that have wifi zones configured
   *   - The center's id and name
   *
   * Results are cached for CACHE_TTL_MS to prevent DB pressure from
   * high-frequency (~10 Hz) MQTT messages.
   *
   * @param nodeId  MAC address or CUID of the EspNode
   * @param hintCenterId  Optional centerId from the payload (speeds up lookup)
   */
  private async resolveNodeTables(
    nodeId: string,
    hintCenterId?: string,
  ): Promise<NodeCacheEntry | null> {
    // Check cache first
    const cached = this.nodeCache.get(nodeId)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached
    }

    // Resolve the EspNode record
    const node = await this.prisma.espNode.findFirst({
      where: {
        OR: [{ macAddress: nodeId }, { id: nodeId }],
        ...(hintCenterId ? { centerId: hintCenterId } : {}),
        isActive: true,
      },
      include: {
        center: { select: { id: true, name: true, code: true } },
      },
    })

    if (!node) return null

    // Fetch all active Tables in the same center with WiFi zones defined
    const tables = await this.prisma.table.findMany({
      where: {
        centerId: node.centerId,
        isActive: true,
        NOT: { wifiZoneX: null },
      },
      select: {
        id: true,
        name: true,
        tableNumber: true,
        centerId: true,
        wifiZoneX: true,
        wifiZoneY: true,
        wifiZoneWidth: true,
        wifiZoneHeight: true,
        center: { select: { id: true, name: true, code: true } },
      },
    })

    const entry: NodeCacheEntry = {
      tables: tables as ResolvedTable[],
      centerId: node.centerId,
      centerName: node.center.name,
      fetchedAt: Date.now(),
    }

    this.nodeCache.set(nodeId, entry)
    this.logger.debug(
      `🗂️  RuView cache SET — node=${nodeId} → center="${node.center.name}" ` +
        `wifiTables=${tables.length}`,
    )
    return entry
  }

  // ── Spatial Filter ────────────────────────────────────────────────────────

  /**
   * Filters tables whose WiFi zone rectangle contains the estimated position.
   *
   * Two operating modes:
   *
   * **Position provided** (`estimatedX` and `estimatedY` present):
   *   Strict containment: only tables whose `(wifiZoneX, wifiZoneY, wifiZoneWidth,
   *   wifiZoneHeight)` rectangle contains the point pass the filter.
   *   This relies on the ESP32 firmware having done AoA/ToF pre-processing.
   *
   * **No position** (most basic nodes — only CSI array):
   *   Permissive mode: all tables in the center with any wifi zone configured
   *   are treated as candidates. The CSI algorithm alone determines fall detection.
   *   This is appropriate when the ESP node physically covers a single-table area.
   *
   * @param tables  Candidate tables from the same center
   * @param x       Estimated X coordinate (floor-plan pixels), if available
   * @param y       Estimated Y coordinate (floor-plan pixels), if available
   */
  spatialFilter(tables: ResolvedTable[], x?: number, y?: number): ResolvedTable[] {
    // No position estimate → permissive: all tables with configured zones
    if (x === undefined || y === undefined) {
      return tables.filter(
        (t) =>
          t.wifiZoneX !== null &&
          t.wifiZoneY !== null &&
          t.wifiZoneWidth !== null &&
          t.wifiZoneHeight !== null,
      )
    }

    // Position provided → strict rectangle containment
    return tables.filter((t) => {
      if (
        t.wifiZoneX === null ||
        t.wifiZoneY === null ||
        t.wifiZoneWidth === null ||
        t.wifiZoneHeight === null
      ) {
        return false
      }

      return (
        x >= t.wifiZoneX &&
        x <= t.wifiZoneX + t.wifiZoneWidth &&
        y >= t.wifiZoneY &&
        y <= t.wifiZoneY + t.wifiZoneHeight
      )
    })
  }

  // ── CSI Fall Detection Algorithm ──────────────────────────────────────────

  /**
   * Analyses the raw CSI amplitude array for a "Sudden Sick / Fall" pattern.
   *
   * # Fall Signature (based on Wi-Fall / FallDeFi research)
   *
   *   Phase 1 — Baseline: moderate, periodic variance (person seated / walking)
   *   Phase 2 — Fall event: **sudden HIGH-amplitude spike** caused by the body
   *             rapidly changing position and reflecting WiFi energy differently
   *   Phase 3 — Post-fall: **sustained LOW variance** — person lying still,
   *             almost no reflected energy change
   *
   * # Algorithm
   *
   *   1. Segment the CSI array into non-overlapping windows of WINDOW_SIZE samples
   *   2. Compute per-window variance
   *   3. Compute `meanVariance` across ALL windows (baseline activity level)
   *   4. **Spike detection**: find the first window where
   *      `variance > meanVariance × SPIKE_MULTIPLIER`
   *   5. **Drop confirmation**: the mean variance of all windows AFTER the spike
   *      must be `< meanVariance × POST_SPIKE_RATIO` (body is now still)
   *   6. **Confidence**: derived from spike magnitude and drop depth:
   *      `conf = clamp( (spikeRatio / (SPIKE_MULTIPLIER×2)) × (1 - dropRatio/POST_SPIKE_RATIO), 0.5, CONFIDENCE_MAX )`
   *
   * # Why both conditions are required
   *   - Spike alone could be a quick knock or hand wave
   *   - Drop alone could be an empty room (person left)
   *   - Spike + sustained drop = person fell and is not moving → fall confirmed
   *
   * @param csi  Raw amplitude array from the ESP32 node
   * @returns    FallDetectionResult with detected flag, confidence, and diagnostics
   */
  detectFall(csi: number[]): FallDetectionResult {
    const noFall: FallDetectionResult = {
      detected: false,
      confidence: 0,
      spikeIndex: -1,
      spikeValue: 0,
      dropRatio: 1,
    }

    if (csi.length < MIN_CSI_SAMPLES) return noFall

    // ── Step 1: Windowed variance ─────────────────────────────────────────
    const variances = this.windowedVariance(csi, WINDOW_SIZE)
    if (variances.length < 3) return noFall

    // ── Step 2: Baseline variance (mean across all windows) ──────────────
    const meanVar = variances.reduce((a, b) => a + b, 0) / variances.length
    if (meanVar === 0) return noFall // completely flat signal → empty room or dead sensor

    // ── Step 3: Spike detection (highest qualifying spike wins) ──────────
    const spikeThreshold = meanVar * SPIKE_MULTIPLIER
    let spikeIdx = -1
    let spikeVar = 0

    for (let i = 0; i < variances.length - 1; i++) {
      // Must not be the LAST window (we need post-spike windows to check the drop)
      if (variances[i] > spikeThreshold && variances[i] > spikeVar) {
        spikeIdx = i
        spikeVar = variances[i]
      }
    }

    if (spikeIdx < 0) return noFall // no spike → definitely not a fall

    // ── Step 4: Post-spike drop confirmation ─────────────────────────────
    const postSpikeVars = variances.slice(spikeIdx + 1)
    if (postSpikeVars.length === 0) return noFall // spike was at the very end

    const postSpikeMean = postSpikeVars.reduce((a, b) => a + b, 0) / postSpikeVars.length
    const dropRatio = postSpikeMean / meanVar

    if (dropRatio >= POST_SPIKE_RATIO) {
      // Post-spike variance is still high → person is moving, not lying still
      return noFall
    }

    // ── Step 5: Confidence calculation ───────────────────────────────────
    const spikeRatio = spikeVar / meanVar
    // Higher spike ratio and lower drop ratio → higher confidence
    const rawConf = (spikeRatio / (SPIKE_MULTIPLIER * 2)) * (1 - dropRatio / POST_SPIKE_RATIO)
    const confidence = Math.min(Math.max(rawConf, 0.5), CONFIDENCE_MAX)

    return { detected: true, confidence, spikeIndex: spikeIdx, spikeValue: spikeVar, dropRatio }
  }

  // ── Alert persistence + WebSocket dispatch ────────────────────────────────

  /**
   * Persists a WIFI_FALL alert to the database and broadcasts a WebSocket
   * event to both the SUPER_ADMIN room and the affected center's room.
   *
   * On DB failure the error is logged but does not throw — the WebSocket
   * broadcast is attempted regardless.
   */
  private async saveAndDispatch(
    table: ResolvedTable,
    center: { id: string; name: string },
    nodeId: string,
    confidence: number,
  ): Promise<void> {
    let alertId: string | null = null

    // ── 1. Persist to Alert table ─────────────────────────────────────────
    try {
      const saved = await this.prisma.alert.create({
        data: {
          type: 'WIFI_FALL',
          severity: 'CRITICAL',
          confidence,
          centerId: center.id,
          tableId: table.id,
          // cameraId is intentionally null — this is a CSI sensor event, not camera
        },
      })
      alertId = saved.id
      this.logger.log(
        `💾 Alert saved — id=${saved.id} type=WIFI_FALL ` +
          `table="${table.name}" conf=${confidence.toFixed(3)}`,
      )
    } catch (dbErr: any) {
      this.logger.error(`❌ RuView DB save failed: ${dbErr?.message}`, dbErr?.stack)
      // Fall through — still emit WebSocket even if DB save failed
    }

    // ── 2. Build WebSocket payload ────────────────────────────────────────
    const wsPayload = {
      alertId,
      type: 'WIFI_FALL',
      tableId: table.id,
      tableName: table.name,
      tableNumber: table.tableNumber,
      centerId: center.id,
      centerName: center.name,
      nodeId,
      confidence,
      algorithm: 'CSI_VARIANCE_FALL',
      detectedAt: new Date().toISOString(),
    }

    // ── 3. Broadcast to SUPER_ADMIN + center room ─────────────────────────
    try {
      const envelope = this.events.buildEnvelope<typeof wsPayload>(
        center.id,
        center.name,
        'CRITICAL' as AlertSeverity,
        wsPayload,
      )
      this.events.emitToCenterAndSuperAdmin(center.id, WS_EVENTS.WIFI_CSI_FALL_DETECTED, envelope)

      this.logger.warn(
        `📡 WS broadcast — ${WS_EVENTS.WIFI_CSI_FALL_DETECTED} ` +
          `center="${center.name}" table="${table.name}" conf=${confidence.toFixed(3)}`,
      )
    } catch (wsErr: any) {
      this.logger.error(`❌ RuView WS broadcast failed: ${wsErr?.message}`, wsErr?.stack)
    }
  }

  // ── Windowed variance helper ──────────────────────────────────────────────

  /**
   * Computes per-window variance for non-overlapping windows of width `w`.
   * Returns one variance value per complete window (partial tail is discarded).
   *
   * @example windowedVariance([1,2,3,4,5,6], 3) → [variance([1,2,3]), variance([4,5,6])]
   */
  private windowedVariance(samples: number[], w: number): number[] {
    const result: number[] = []
    for (let i = 0; i + w <= samples.length; i += w) {
      const window = samples.slice(i, i + w)
      const mean = window.reduce((a, b) => a + b, 0) / w
      const variance = window.reduce((acc, val) => acc + (val - mean) ** 2, 0) / w
      result.push(variance)
    }
    return result
  }

  // ── Cache management (used by provisioning callbacks) ─────────────────────

  /**
   * Evicts a single node entry from the resolution cache.
   * Call this after a node is re-provisioned to force a fresh DB lookup.
   */
  evictNodeCache(nodeId: string): void {
    this.nodeCache.delete(nodeId)
    this.logger.debug(`🗑️  RuView cache evicted for node: ${nodeId}`)
  }

  /** Clears the entire node→table resolution cache. */
  clearNodeCache(): void {
    this.nodeCache.clear()
    this.logger.log('🗑️  RuView node cache fully cleared')
  }
}
