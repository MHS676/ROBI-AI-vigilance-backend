import { Controller, Logger } from '@nestjs/common'
import {
  MessagePattern,
  Payload,
  Ctx,
  MqttContext,
  EventPattern,
} from '@nestjs/microservices'
import { PrismaService } from '../prisma/prisma.service'
import { EventsGateway } from '../events/events.gateway'
import {
  MQTT_TOPICS,
  WS_EVENTS,
  AI_EVENT_SEVERITY,
  WIFI_EVENT_SEVERITY,
  AlertSeverity,
} from './mqtt.constants'
import {
  WifiSensingPayload,
  AiResultsPayload,
  AudioLevelPayload,
  DeviceStatusPayload,
} from './interfaces/mqtt-payload.interface'
import { DeviceStatus } from '@prisma/client'

// ─────────────────────────────────────────────────────────────────────────────
// MqttController
//
// Receives MQTT messages from the 525 ESP32 nodes and AI edge modules.
// For each message it:
//   1. Parses the centerId from the MQTT topic
//   2. Looks up the center in PostgreSQL (name cached on instance for perf)
//   3. Determines severity
//   4. Calls EventsGateway.emitToCenterAndSuperAdmin() to push to:
//      - room:super_admin           (all SUPER_ADMIN dashboards)
//      - room:center:{centerId}     (the local ADMIN for that center)
//
// Note: @EventPattern is used instead of @MessagePattern because ESP32 nodes
// publish fire-and-forget (QoS 0/1 without response expected from the server).
// ─────────────────────────────────────────────────────────────────────────────

@Controller()
export class MqttController {
  private readonly logger = new Logger(MqttController.name)

  /**
   * Simple in-memory cache: centerId → { name, code }
   * Avoids a DB lookup on every MQTT message (ESP32 nodes publish at ~1 Hz).
   * Cache is populated lazily and never evicted — centers rarely change names.
   */
  private centerCache = new Map<string, { name: string; code: string }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Extract the center ID from the MQTT topic.
   * Topic format: falcon/center/{centerId}/{dataType}
   * Index:         0      1       2          3
   */
  private extractCenterId(topic: string): string | null {
    const parts = topic.split('/')
    return parts[2] ?? null
  }

  /**
   * Fetch center { name, code } from cache or DB.
   * Returns null if the center doesn't exist — caller should skip the event.
   */
  private async resolveCenter(
    centerId: string,
  ): Promise<{ name: string; code: string } | null> {
    if (this.centerCache.has(centerId)) {
      return this.centerCache.get(centerId)!
    }

    const center = await this.prisma.center.findUnique({
      where: { id: centerId },
      select: { name: true, code: true },
    })

    if (!center) {
      this.logger.warn(`⚠️  Unknown centerId in MQTT topic: ${centerId}`)
      return null
    }

    this.centerCache.set(centerId, center)
    return center
  }

  // ── WIFI SENSING ──────────────────────────────────────────────────────────
  //
  // ESP32 nodes measure WiFi RSSI / CSI to detect presence, movement, and falls.
  // Published to: falcon/center/{centerId}/wifi-sensing
  // ─────────────────────────────────────────────────────────────────────────

  @EventPattern(MQTT_TOPICS.WIFI_SENSING)
  async handleWifiSensing(
    @Payload() data: WifiSensingPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic()
    const centerId = this.extractCenterId(topic) ?? data.centerId

    if (!centerId) {
      this.logger.warn('wifi-sensing: cannot determine centerId — skipping')
      return
    }

    const center = await this.resolveCenter(centerId)
    if (!center) return

    const severity: AlertSeverity =
      WIFI_EVENT_SEVERITY[data.event] ?? 'INFO'

    this.logger.log(
      `📡 WiFi sensing [${center.code}] node=${data.nodeId} ` +
        `event=${data.event} severity=${severity}`,
    )

    const wsEvent =
      data.event === 'FALL_DETECTED'
        ? WS_EVENTS.FALL_DETECTED
        : WS_EVENTS.WIFI_SENSING_UPDATE

    const envelope = this.events.buildEnvelope(centerId, center.name, severity, data)
    this.events.emitToCenterAndSuperAdmin(centerId, wsEvent, envelope)
  }

  // ── AI RESULTS ────────────────────────────────────────────────────────────
  //
  // AI edge module publishes inference results from camera feeds.
  // Published to: falcon/center/{centerId}/ai-results
  // ─────────────────────────────────────────────────────────────────────────

  @EventPattern(MQTT_TOPICS.AI_RESULTS)
  async handleAiResults(
    @Payload() data: AiResultsPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic()
    const centerId = this.extractCenterId(topic) ?? data.centerId

    if (!centerId) {
      this.logger.warn('ai-results: cannot determine centerId — skipping')
      return
    }

    const center = await this.resolveCenter(centerId)
    if (!center) return

    const severity: AlertSeverity =
      AI_EVENT_SEVERITY[data.primaryEvent] ?? 'INFO'

    this.logger.log(
      `🤖 AI result [${center.code}] camera=${data.cameraId} ` +
        `event=${data.primaryEvent} confidence=${data.detections[0]?.confidence?.toFixed(2) ?? 'n/a'} ` +
        `severity=${severity}`,
    )

    // Pick the most specific WS event name
    let wsEvent: string = WS_EVENTS.AI_RESULTS_UPDATE
    if (data.primaryEvent === 'FALL_DETECTED') wsEvent = WS_EVENTS.FALL_DETECTED
    else if (data.primaryEvent === 'AGGRESSION' || data.primaryEvent === 'VIOLENT_BEHAVIOUR')
      wsEvent = WS_EVENTS.AGGRESSION_DETECTED
    else if (data.primaryEvent === 'CROWD' || data.primaryEvent === 'OVERCROWDING')
      wsEvent = WS_EVENTS.CROWD_DETECTED

    const envelope = this.events.buildEnvelope(centerId, center.name, severity, data)
    this.events.emitToCenterAndSuperAdmin(centerId, wsEvent, envelope)
  }

  // ── AUDIO LEVEL ───────────────────────────────────────────────────────────
  //
  // Microphones publish audio levels; NestJS triggers an alert when the
  // threshold is exceeded.
  // Published to: falcon/center/{centerId}/audio-level
  // ─────────────────────────────────────────────────────────────────────────

  @EventPattern(MQTT_TOPICS.AUDIO_LEVEL)
  async handleAudioLevel(
    @Payload() data: AudioLevelPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic()
    const centerId = this.extractCenterId(topic) ?? data.centerId

    if (!centerId) {
      this.logger.warn('audio-level: cannot determine centerId — skipping')
      return
    }

    const center = await this.resolveCenter(centerId)
    if (!center) return

    // Only escalate if it's actually a high-level / special event
    const isAlert =
      data.event === 'HIGH_AUDIO_LEVEL' ||
      data.event === 'SCREAM' ||
      data.event === 'BREAKING_GLASS'

    const severity: AlertSeverity =
      data.event === 'SCREAM' || data.event === 'BREAKING_GLASS'
        ? 'HIGH'
        : data.event === 'HIGH_AUDIO_LEVEL'
          ? 'MEDIUM'
          : 'INFO'

    this.logger.log(
      `🎤 Audio [${center.code}] mic=${data.microphoneId} ` +
        `event=${data.event} dB=${data.dbLevel} severity=${severity}`,
    )

    const wsEvent = isAlert ? WS_EVENTS.HIGH_AUDIO_LEVEL : WS_EVENTS.AUDIO_LEVEL_UPDATE
    const envelope = this.events.buildEnvelope(centerId, center.name, severity, data)
    this.events.emitToCenterAndSuperAdmin(centerId, wsEvent, envelope)
  }

  // ── DEVICE STATUS ─────────────────────────────────────────────────────────
  //
  // ESP nodes, cameras, and microphones send heartbeats / status changes.
  // Published to: falcon/center/{centerId}/device-status
  // NestJS also updates the corresponding DB record.
  // ─────────────────────────────────────────────────────────────────────────

  @EventPattern(MQTT_TOPICS.DEVICE_STATUS)
  async handleDeviceStatus(
    @Payload() data: DeviceStatusPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    const topic = context.getTopic()
    const centerId = this.extractCenterId(topic) ?? data.centerId

    if (!centerId) {
      this.logger.warn('device-status: cannot determine centerId — skipping')
      return
    }

    const center = await this.resolveCenter(centerId)
    if (!center) return

    const severity: AlertSeverity =
      data.status === 'OFFLINE' || data.status === 'ERROR' ? 'MEDIUM'
        : data.status === 'LOW_BATTERY' ? 'LOW'
          : 'INFO'

    this.logger.log(
      `🖥️  Device status [${center.code}] ${data.deviceType}=${data.deviceId} ` +
        `status=${data.status} severity=${severity}`,
    )

    // ── Persist status change to the DB ────────────────────────────────────
    // Map MQTT status → Prisma DeviceStatus enum
    const prismaStatus: DeviceStatus =
      data.status === 'ONLINE' ? DeviceStatus.ONLINE
        : data.status === 'REBOOT' ? DeviceStatus.MAINTENANCE
          : DeviceStatus.OFFLINE

    await this.persistDeviceStatus(data, prismaStatus).catch((err) =>
      this.logger.error(
        `Failed to persist device status for ${data.deviceId}: ${err?.message}`,
      ),
    )

    const envelope = this.events.buildEnvelope(centerId, center.name, severity, data)
    this.events.emitToCenterAndSuperAdmin(centerId, WS_EVENTS.DEVICE_STATUS_UPDATE, envelope)
  }

  // ── DB persistence helpers ────────────────────────────────────────────────

  private async persistDeviceStatus(
    data: DeviceStatusPayload,
    status: DeviceStatus,
  ): Promise<void> {
    if (data.deviceType === 'ESP_NODE') {
      await this.prisma.espNode.updateMany({
        where: { id: data.deviceId },
        data: {
          status,
          lastSeenAt: new Date(data.timestamp * 1000),
          ...(data.ipAddress && { ipAddress: data.ipAddress }),
        },
      })
    } else if (data.deviceType === 'CAMERA') {
      await this.prisma.camera.updateMany({
        where: { id: data.deviceId },
        data: { status },
      })
    } else if (data.deviceType === 'MICROPHONE') {
      await this.prisma.microphone.updateMany({
        where: { id: data.deviceId },
        data: { status },
      })
    }
  }
}
