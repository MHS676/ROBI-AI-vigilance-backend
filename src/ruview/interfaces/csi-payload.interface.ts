// ─────────────────────────────────────────────────────────────────────────────
// CsiPayload — MQTT message published to falcon/esp/wifi-sensing
//
// Published by ESP32-S3 nodes running RuView-compatible firmware.
// The CSI (Channel State Information) array contains per-subcarrier amplitude
// values sampled from nearby WiFi reflections. Firmware publishes at ~10 Hz.
//
// The RuViewEngineService uses this payload to:
//   1. Identify which Table the node is serving (via nodeId → EspNode → center → tables)
//   2. Apply spatial gating (optional x/y from firmware AoA pre-processing)
//   3. Run the CSI variance-based fall detection algorithm
//   4. Dispatch a CRITICAL alert when a "Sudden Sick / Fall" pattern is confirmed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw CSI payload from a Falcon ESP32 node.
 *
 * Minimum required fields: `nodeId` + `csi`.
 * All other fields are optional — firmware capability determines what is sent.
 */
export interface CsiPayload {
  /**
   * Hardware identifier of the ESP32 node.
   * Must match either `EspNode.macAddress` or `EspNode.id` in the database.
   * Format: MAC address with colons, e.g. "AA:BB:CC:DD:EE:01"
   */
  nodeId: string

  /**
   * Raw CSI amplitude array — one value per subcarrier per sample.
   * Typical size: 52–128 values per OFDM packet (802.11n / 802.11ac).
   * Values are normalised amplitudes (arbitrary units, firmware-dependent).
   *
   * The RuView fall detection algorithm uses sliding-window variance on
   * this array to detect the "spike → sustained drop" pattern of a fall.
   */
  csi: number[]

  /**
   * Center CUID — optionally embedded by the ESP32 firmware after provisioning.
   * If present, used as a hint to speed up the DB lookup.
   */
  centerId?: string

  /**
   * Unix timestamp (seconds) when the CSI frame was captured on-device.
   * Falls back to server time if omitted.
   */
  timestamp?: number

  /**
   * Firmware version string — used for diagnostics / compatibility checks.
   * e.g. "rv-2.3.1"
   */
  firmwareVersion?: string

  /**
   * Estimated X coordinate of the detected activity on the center floor plan.
   * Computed by advanced firmware using AoA (Angle-of-Arrival) or ToF
   * (Time-of-Flight) pre-processing — absent on basic nodes.
   *
   * When present, the spatial filter uses this to determine which Table's
   * `wifiZoneX / wifiZoneY / wifiZoneWidth / wifiZoneHeight` rectangle
   * contains the disturbance.
   *
   * When absent, all Tables in the center with a wifi zone are treated
   * as candidates and the CSI variance pattern alone decides.
   */
  estimatedX?: number

  /**
   * Estimated Y coordinate of the detected activity on the center floor plan.
   * See `estimatedX` for full description.
   */
  estimatedY?: number
}

// ── Resolved table shape (returned by DB query inside RuViewEngineService) ──

export interface ResolvedTable {
  id: string
  name: string
  tableNumber: number
  centerId: string
  wifiZoneX: number | null
  wifiZoneY: number | null
  wifiZoneWidth: number | null
  wifiZoneHeight: number | null
  center: { id: string; name: string; code: string }
}

// ── Fall detection result ────────────────────────────────────────────────────

export interface FallDetectionResult {
  /** Whether a fall signature was confirmed */
  detected: boolean
  /** Confidence score 0–1 derived from spike magnitude and post-spike drop */
  confidence: number
  /** Window index where the spike occurred (-1 = no spike) */
  spikeIndex: number
  /** Variance value at the spike window */
  spikeValue: number
  /** Ratio of post-spike mean variance to overall mean variance (lower = stronger drop) */
  dropRatio: number
}
