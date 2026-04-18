// ─────────────────────────────────────────────────────────────────────────────
// CsiFrame — one persisted CSI sample stored in a daily .jsonl log file.
//
// Every CSI payload that passes basic validation in RuViewEngineService is
// written to disk as one UTF-8 JSON line in the form:
//
//   { "ts": 1713420000.123, "nodeId": "AA:BB:CC:DD:EE:01",
//     "tableId": "tbl-seed-001", "centerId": "ctr-seed-001",
//     "csi": [12,34,56,...], "estimatedX": 120, "estimatedY": 80 }
//
// File path layout (one file per node per day):
//   {CSI_LOG_ROOT}/{centerId}/{tableId}/{YYYY-MM-DD}/csi_{safeNodeId}.jsonl
//
// Design notes:
//   • `ts` is a float Unix timestamp (seconds + fractional ms) — compact,
//     fast to filter in a readline scan, and timezone-independent.
//   • `tableId` is duplicated inside each line so a single file can be
//     reconstructed without the path context.
//   • The `csi` array is the raw subcarrier amplitude array from the ESP32.
//     Typical length: 52–128 values.
//   • `estimatedX / estimatedY` are optional — only present when the ESP32
//     firmware performs AoA pre-processing.
// ─────────────────────────────────────────────────────────────────────────────

export interface CsiFrame {
  /** Unix timestamp (seconds.fractional_ms) when the frame was captured. */
  ts: number

  /** ESP32 MAC address or CUID that produced this frame. */
  nodeId: string

  /** Table the node is serving — used for playback filtering. */
  tableId: string

  /** Center the node belongs to. */
  centerId: string

  /**
   * Raw CSI amplitude array — one value per subcarrier per OFDM packet.
   * Typical size: 52–128 values.
   */
  csi: number[]

  /**
   * Estimated X coordinate on the center floor plan (pixels).
   * Present only when the firmware performs AoA / ToF pre-processing.
   */
  estimatedX?: number

  /** Estimated Y coordinate on the center floor plan (pixels). */
  estimatedY?: number

  /** Firmware version string, e.g. "rv-2.3.1". */
  firmwareVersion?: string
}

// ─── File metadata returned by listFiles() ───────────────────────────────────

export interface CsiLogFileMeta {
  /** Absolute path to the .jsonl file. */
  path: string

  /** Center this file belongs to. */
  centerId: string

  /** Table this file belongs to. */
  tableId: string

  /** ISO date string, e.g. "2026-04-18". */
  date: string

  /** Node (MAC address, underscores) encoded in the filename. */
  nodeId: string

  /** File size in bytes. */
  sizeBytes: number

  /** Approximate frame count (lines in the file). */
  frameCount: number | null
}
