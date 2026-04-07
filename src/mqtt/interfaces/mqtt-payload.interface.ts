import { AlertSeverity } from '../mqtt.constants'

// ─────────────────────────────────────────────────────────────────────────────
// INBOUND MQTT PAYLOADS  (ESP32 nodes → MQTT broker → NestJS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base fields present on every MQTT message from a Falcon node.
 * The centerId can also be derived from the topic, but including it in the
 * payload allows the ESP32 to double-encode it for reliability.
 */
export interface MqttBasePayload {
  /** Center CUID — should match the centerId in the topic path */
  centerId: string
  /** Unix timestamp (seconds) when the event was recorded on-device */
  timestamp: number
  /** Optional firmware version for diagnostics */
  firmwareVersion?: string
}

// ── WiFi Sensing ─────────────────────────────────────────────────────────────
export type WifiSensingEvent =
  | 'FALL_DETECTED'
  | 'SUDDEN_MOVEMENT'
  | 'MOTION'
  | 'IDLE'
  | 'EMPTY'

export interface WifiSensingPayload extends MqttBasePayload {
  /** MAC address of the ESP32 node that generated this reading */
  nodeId: string
  /** Optional table CUID if this node is linked to a specific table */
  tableId?: string
  /** Human-readable event name */
  event: WifiSensingEvent
  /** RSSI samples from nearby devices — used for fall/motion detection */
  rssiSamples?: number[]
  /** Channel State Information amplitude variance (optional, advanced nodes) */
  csiVariance?: number
  /** Number of WiFi devices detected nearby */
  deviceCount?: number
  /** Confidence score 0–1 for the reported event */
  confidence?: number
}

// ── AI Results ───────────────────────────────────────────────────────────────
export type AiEvent =
  | 'FALL_DETECTED'
  | 'AGGRESSION'
  | 'VIOLENT_BEHAVIOUR'
  | 'CROWD'
  | 'OVERCROWDING'
  | 'SUSPICIOUS'
  | 'MOTION'
  | 'NORMAL'

export interface AiBoundingBox {
  x: number
  y: number
  w: number
  h: number
}

export interface AiDetection {
  event: AiEvent
  confidence: number
  boundingBox?: AiBoundingBox
  /** Object class label returned by the model (e.g. "person", "weapon") */
  label?: string
}

export interface AiResultsPayload extends MqttBasePayload {
  cameraId: string
  tableId?: string
  /** The primary event — highest confidence detection in the frame */
  primaryEvent: AiEvent
  /** All detections in this frame */
  detections: AiDetection[]
  /** Model name / version for debugging */
  modelVersion?: string
}

// ── Audio Level ───────────────────────────────────────────────────────────────
export type AudioEvent = 'HIGH_AUDIO_LEVEL' | 'SCREAM' | 'BREAKING_GLASS' | 'NORMAL' | 'SILENT'

export interface AudioLevelPayload extends MqttBasePayload {
  microphoneId: string
  tableId?: string
  /** Decibel level (dB SPL) */
  dbLevel: number
  /** Threshold that was exceeded (from center config) */
  threshold?: number
  event: AudioEvent
  /** Dominant frequency band (Hz) — helps classify the audio event */
  dominantFrequency?: number
}

// ── Device Status ─────────────────────────────────────────────────────────────
export type DeviceType = 'ESP_NODE' | 'CAMERA' | 'MICROPHONE'
export type DeviceStatusEvent = 'ONLINE' | 'OFFLINE' | 'REBOOT' | 'LOW_BATTERY' | 'ERROR'

export interface DeviceStatusPayload extends MqttBasePayload {
  deviceId: string
  deviceType: DeviceType
  status: DeviceStatusEvent
  /** IP address of the device at time of event */
  ipAddress?: string
  /** Battery level 0–100 (for battery-powered nodes) */
  batteryLevel?: number
  /** Error code / description if status is ERROR */
  errorCode?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTBOUND WEBSOCKET PAYLOADS  (NestJS → Socket.io → Next.js frontend)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envelope wrapping every WebSocket event emitted to the frontend.
 * The frontend can use `severity` to color-code and prioritize alerts.
 */
export interface WsEventEnvelope<T = unknown> {
  /** ISO-8601 timestamp set by NestJS when the event is emitted */
  serverTime: string
  /** Alert severity — drives frontend notification priority */
  severity: AlertSeverity
  /** The centerId this event belongs to */
  centerId: string
  /** Human-readable center name (resolved from DB) */
  centerName: string
  /** The actual payload — type depends on the event */
  data: T
}

// Typed envelope aliases for each outbound event type
export type WifiSensingEnvelope = WsEventEnvelope<WifiSensingPayload>
export type AiResultsEnvelope = WsEventEnvelope<AiResultsPayload>
export type AudioLevelEnvelope = WsEventEnvelope<AudioLevelPayload>
export type DeviceStatusEnvelope = WsEventEnvelope<DeviceStatusPayload>
