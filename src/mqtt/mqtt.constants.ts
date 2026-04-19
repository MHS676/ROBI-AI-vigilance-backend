// ─────────────────────────────────────────────────────────────────────────────
// MQTT TOPIC CONSTANTS
// All 525 ESP32 nodes publish to topics under the `falcon/` namespace.
//
// Topic anatomy:
//   falcon / center / {centerId} / {dataType}
//
// centerId is extracted at runtime from the MQTT context — we subscribe with
// the MQTT single-level wildcard `+` so one @MessagePattern catches every center.
// ─────────────────────────────────────────────────────────────────────────────

export const MQTT_TOPICS = {
  /** ESP32 WiFi CSI / RSSI-based presence & fall detection.
   *  Published by: ESP32 nodes (up to 5 per center = 525 total nodes).
   *  Pattern: falcon/center/{centerId}/wifi-sensing */
  WIFI_SENSING: 'falcon/center/+/wifi-sensing',

  /** AI inference results from the camera-based vision pipeline.
   *  Published by: the AI edge module (Docker container on site or cloud).
   *  Pattern: falcon/center/{centerId}/ai-results */
  AI_RESULTS: 'falcon/center/+/ai-results',

  /** Raw audio-level readings from microphones.
   *  Pattern: falcon/center/{centerId}/audio-level */
  AUDIO_LEVEL: 'falcon/center/+/audio-level',

  /** ESP32 heartbeats — used to mark devices ONLINE / OFFLINE.
   *  Pattern: falcon/center/{centerId}/device-status */
  DEVICE_STATUS: 'falcon/center/+/device-status',

  /** Catch-all for custom / future subtopics under a center.
   *  Pattern: falcon/center/{centerId}/# */
  CENTER_ALL: 'falcon/center/+/#',

  /** Raw CSI (Channel State Information) payload from RuView-compatible ESP32 nodes.
   *  Unlike WIFI_SENSING (which is center-scoped), this topic is node-scoped.
   *  The RuViewEngineService resolves centerId via EspNode.macAddress DB lookup.
   *  Pattern: falcon/esp/wifi-sensing */
  WIFI_SENSING_RAW: 'falcon/esp/wifi-sensing',

  // ── Zero-Config Provisioning ──────────────────────────────────────────────

  /** Birth / announcement message published by any new ESP32 or AI-Mic.
   *  Device publishes: { macAddress, firmwareVer, deviceType, ipAddress, hostname }
   *  QoS 1 — retained so late-connecting server still receives it. */
  DISCOVERY_BIRTH: 'falcon/discovery/pending',

  /** Provisioning config sent FROM backend TO a specific device.
   *  Topic: falcon/provision/{mac_with_underscores}
   *  Payload: { centerId, tableId?, wifiSsid, wifiPassword, serverUrl } */
  PROVISION_DEVICE: 'falcon/provision/+',

  /** Acknowledgement sent FROM device TO backend after receiving config.
   *  Topic: falcon/provision/ack/{mac_with_underscores}
   *  Payload: { macAddress, status: 'OK' | 'ERROR', message? } */
  PROVISION_ACK: 'falcon/provision/ack/+',
} as const

/**
 * Build the MQTT topic to push a provisioning config to a specific device.
 * MAC colons are replaced with underscores for MQTT topic safety.
 * @example provisionTopic('AA:BB:CC:DD:EE:01') → 'falcon/provision/AA_BB_CC_DD_EE_01'
 */
export const provisionTopic = (macAddress: string): string =>
  `falcon/provision/${macAddress.replace(/:/g, '_')}`

/**
 * Build the MQTT topic a device publishes its provisioning ACK to.
 * @example provisionAckTopic('AA:BB:CC:DD:EE:01') → 'falcon/provision/ack/AA_BB_CC_DD_EE_01'
 */
export const provisionAckTopic = (macAddress: string): string =>
  `falcon/provision/ack/${macAddress.replace(/:/g, '_')}`

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET ROOM NAMES
// Clients join these rooms after authenticating over the Socket.io connection.
// ─────────────────────────────────────────────────────────────────────────────

/** All SUPER_ADMIN sockets join this room and receive events from all 105 centers. */
export const ROOM_SUPER_ADMIN = 'room:super_admin'

/** ADMIN and AGENT sockets for a specific center join this room.
 *  @example roomForCenter('clxyz123') → "room:center:clxyz123" */
export const roomForCenter = (centerId: string) => `room:center:${centerId}`

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET EVENT NAMES  (server → client)
// These are the string event names the Next.js frontend listens for.
// ─────────────────────────────────────────────────────────────────────────────

export const WS_EVENTS = {
  // ── Alerts (high-priority, require immediate attention) ───────────────────
  /** A fall was detected at a table — CRITICAL */
  FALL_DETECTED: 'alert:fall_detected',

  /** Aggressive / violent behaviour detected by AI vision — HIGH */
  AGGRESSION_DETECTED: 'alert:aggression_detected',

  /** Audio level exceeded threshold — MEDIUM */
  HIGH_AUDIO_LEVEL: 'alert:high_audio_level',

  /** Crowd / overcrowding at a table detected — MEDIUM */
  CROWD_DETECTED: 'alert:crowd_detected',

  // ── Live updates (informational, lower frequency) ─────────────────────────
  /** Regular WiFi sensing update — presence / motion state */
  WIFI_SENSING_UPDATE: 'update:wifi_sensing',

  /** AI inference result summary — confidence + bounding box */
  AI_RESULTS_UPDATE: 'update:ai_results',

  /** Microphone audio level sample */
  AUDIO_LEVEL_UPDATE: 'update:audio_level',

  /** ESP32 or camera came online / went offline */
  DEVICE_STATUS_UPDATE: 'update:device_status',

  /** A camera or ESP32 node went OFFLINE — triggers Red Alert on dashboard */
  DEVICE_OFFLINE: 'alert:device_offline',

  // ── System ────────────────────────────────────────────────────────────────
  /** Sent immediately after a client connects and joins rooms */
  CONNECTED: 'system:connected',

  /** Error sent back to a single socket */
  ERROR: 'system:error',

  // ── Provisioning (Super Admin only) ────────────────────────────────────────
  /** New device announced via MQTT birth message — emitted to SUPER_ADMIN room */
  DEVICE_DISCOVERED: 'provisioning:device_discovered',

  /** Super Admin provisioned a device — config sent to device via MQTT */
  DEVICE_PROVISIONED: 'provisioning:device_provisioned',

  /** Super Admin rejected a pending device */
  DEVICE_REJECTED: 'provisioning:device_rejected',

  /** Device sent provisioning ACK back to broker */
  PROVISION_ACK: 'provisioning:provision_ack',

  // ── AI Configuration ────────────────────────────────────────────────────────
  /** Camera AI features updated — emitted to SUPER_ADMIN + center room */
  AI_FEATURES_UPDATED: 'update:ai_features',

  // ── Enterprise Dashboard ────────────────────────────────────────────────────
  /** Objective row status changed — payload: { objectiveId, status, confidence, tech } */
  OBJECTIVE_STATUS: 'update:objective_status',

  /** Resource Saver Mode toggled by Super Admin */
  RESOURCE_SAVER_CHANGED: 'update:resource_saver',

  /** Hybrid source priority changed for an objective */
  HYBRID_SOURCE_CHANGED: 'update:hybrid_source',

  /** Weapon / explosive item detected — CRITICAL */
  WEAPON_DETECTED: 'alert:weapon_detected',

  /** Fire / smoke detected — CRITICAL */
  FIRE_DETECTED: 'alert:fire_detected',

  /** Person sudden sick / incapacitated — HIGH */
  SICK_DETECTED: 'alert:sick_detected',

  /** WiFi CSI-based fall detection from RuView engine — CRITICAL.
   *  Source: falcon/esp/wifi-sensing → RuViewEngineService CSI_VARIANCE_FALL algorithm.
   *  Payload: { alertId, type, tableId, tableName, tableNumber, nodeId, confidence,
   *            algorithm, detectedAt, centerId, centerName } */
  WIFI_CSI_FALL_DETECTED: 'alert:wifi_csi_fall',

  /** Idle agent / empty counter detected — MEDIUM */
  IDLE_AGENT: 'alert:idle_agent',

  /** Two or more agents detected at the same table without a customer — LOW */
  GOSSIP_DETECTED: 'alert:gossip_detected',

  /** Long serving time threshold exceeded — MEDIUM */
  LONG_SERVICE: 'alert:long_service',

  /** Individual staying too long in center — MEDIUM */
  LONG_STAY: 'alert:long_stay',

  /** Vandalism / shouting / slang detected via audio — HIGH */
  VANDALISM_DETECTED: 'alert:vandalism_detected',

  /** Irate customer detected via facial expression — HIGH */
  IRATE_CUSTOMER: 'alert:irate_customer',

  /** Physically challenged visitor identified — INFO */
  CHALLENGED_VISITOR: 'alert:challenged_visitor',

  /** Token issued without physical visitor presence — MEDIUM */
  GHOST_TOKEN: 'alert:ghost_token',

  /** Repeated customer visit within time frame — INFO */
  REPEATED_VISIT: 'alert:repeated_visit',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET EVENT NAMES  (client → server)
// ─────────────────────────────────────────────────────────────────────────────

export const WS_CLIENT_EVENTS = {
  /** Client asks to join a room — payload: { room: string } */
  JOIN_ROOM: 'join_room',

  /** Client asks to leave a room — payload: { room: string } */
  LEAVE_ROOM: 'leave_room',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// ALERT SEVERITY MAP  (used to populate the `severity` field in WS payloads)
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export const AI_EVENT_SEVERITY: Record<string, AlertSeverity> = {
  FALL_DETECTED: 'CRITICAL',
  AGGRESSION: 'HIGH',
  VIOLENT_BEHAVIOUR: 'HIGH',
  CROWD: 'MEDIUM',
  OVERCROWDING: 'MEDIUM',
  SUSPICIOUS: 'MEDIUM',
  MOTION: 'LOW',
  NORMAL: 'INFO',
}

export const WIFI_EVENT_SEVERITY: Record<string, AlertSeverity> = {
  FALL_DETECTED: 'CRITICAL',
  SUDDEN_MOVEMENT: 'HIGH',
  MOTION: 'LOW',
  IDLE: 'INFO',
  EMPTY: 'INFO',
}
