// ─────────────────────────────────────────────────────────────────────────────
// DiscoveryMqttController
//
// Handles MQTT birth messages from newly powered-on ESP32 nodes and
// AI-Microphone devices.
//
// Devices publish to: falcon/discovery/pending
// Payload (JSON):
//   {
//     macAddress:  "AA:BB:CC:DD:EE:01",
//     firmwareVer: "v2.1.4",
//     deviceType:  "ESP32" | "AI_MICROPHONE",
//     ipAddress:   "192.168.1.201",
//     hostname:    "falcon-esp-001",
//     timestamp:   1712800000
//   }
//
// On receipt:
//   1. Upsert a DeviceInventory record (PENDING status) in PostgreSQL.
//   2. Emit `provisioning:device_discovered` to the SUPER_ADMIN WebSocket room.
//
// Provisioning ACKs (falcon/provision/ack/+) are also handled here.
// ─────────────────────────────────────────────────────────────────────────────

import { Controller, Logger } from '@nestjs/common'
import { EventPattern, Payload, Ctx, MqttContext } from '@nestjs/microservices'
import { PrismaService } from '../prisma/prisma.service'
import { EventsGateway } from '../events/events.gateway'
import { MQTT_TOPICS, WS_EVENTS, ROOM_SUPER_ADMIN } from '../mqtt/mqtt.constants'
import { InventoryDeviceType, InventoryStatus } from '@prisma/client'

interface DeviceBirthPayload {
  macAddress:  string
  firmwareVer?: string
  deviceType:  'ESP32' | 'AI_MICROPHONE'
  ipAddress?:  string
  hostname?:   string
  model?:      string
  timestamp?:  number
}

interface ProvisionAckPayload {
  macAddress: string
  status: 'OK' | 'ERROR'
  message?: string
}

@Controller()
export class DiscoveryMqttController {
  private readonly logger = new Logger(DiscoveryMqttController.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  // ── Birth Message Handler ─────────────────────────────────────────────────

  @EventPattern(MQTT_TOPICS.DISCOVERY_BIRTH)
  async handleBirthMessage(
    @Payload() data: DeviceBirthPayload,
    @Ctx() ctx: MqttContext,
  ): Promise<void> {
    try {
      const topic = ctx.getTopic()
      this.logger.log(`🐣 Birth message received on [${topic}]: MAC=${data?.macAddress}`)

      // Validate essential fields
      if (!data?.macAddress || !data?.deviceType) {
        this.logger.warn('⚠️  Birth message missing macAddress or deviceType — ignored')
        return
      }

      const deviceType =
        data.deviceType === 'AI_MICROPHONE'
          ? InventoryDeviceType.AI_MICROPHONE
          : InventoryDeviceType.ESP32

      // Upsert: if MAC already known, update heartbeat + IP; otherwise create PENDING
      const existing = await this.prisma.deviceInventory.findUnique({
        where: { macAddress: data.macAddress },
      })

      let device: Awaited<ReturnType<typeof this.prisma.deviceInventory.upsert>>

      if (existing && existing.status === InventoryStatus.ASSIGNED) {
        // Device already assigned — just refresh heartbeat, do NOT reset status
        device = await this.prisma.deviceInventory.update({
          where: { macAddress: data.macAddress },
          data: {
            ipAddress:       data.ipAddress   ?? existing.ipAddress,
            firmwareVer:     data.firmwareVer ?? existing.firmwareVer,
            hostname:        data.hostname    ?? existing.hostname,
            lastSeenAt:      new Date(),
            discoveryPayload: data as object,
          },
          include: { center: { select: { id: true, name: true, code: true } } },
        })
        this.logger.debug(`♻️  Known device ${data.macAddress} — heartbeat updated`)
      } else {
        // New or previously rejected/offline device — (re)enter PENDING state
        device = await this.prisma.deviceInventory.upsert({
          where: { macAddress: data.macAddress },
          update: {
            status:          InventoryStatus.PENDING,
            ipAddress:       data.ipAddress,
            firmwareVer:     data.firmwareVer,
            hostname:        data.hostname,
            model:           data.model,
            lastSeenAt:      new Date(),
            discoveryPayload: data as object,
          },
          create: {
            macAddress:      data.macAddress,
            deviceType,
            firmwareVer:     data.firmwareVer,
            ipAddress:       data.ipAddress,
            hostname:        data.hostname,
            model:           data.model,
            status:          InventoryStatus.PENDING,
            lastSeenAt:      new Date(),
            discoveryPayload: data as object,
          },
          include: { center: { select: { id: true, name: true, code: true } } },
        })
        this.logger.log(`✅ Device ${data.macAddress} added to inventory as PENDING`)
      }

      // Emit to all SUPER_ADMIN sockets so the dashboard updates in real-time
      this.events.emitToSuperAdmin(WS_EVENTS.DEVICE_DISCOVERED, {
        serverTime:  new Date().toISOString(),
        severity:    'INFO' as const,
        centerId:    '',
        centerName:  '',
        data:        device,
      })
    } catch (err: any) {
      this.logger.error(`❌ Failed to process birth message: ${err.message}`, err.stack)
    }
  }

  // ── Provisioning ACK Handler ──────────────────────────────────────────────

  @EventPattern(MQTT_TOPICS.PROVISION_ACK)
  async handleProvisionAck(
    @Payload() data: ProvisionAckPayload,
    @Ctx() ctx: MqttContext,
  ): Promise<void> {
    try {
      const topic = ctx.getTopic()
      this.logger.log(`📬 Provision ACK on [${topic}]: MAC=${data?.macAddress} status=${data?.status}`)

      if (!data?.macAddress) return

      if (data.status === 'OK') {
        // Mark as provisioned in DB
        await this.prisma.deviceInventory.updateMany({
          where: { macAddress: data.macAddress },
          data:  { provisionedAt: new Date() },
        })
      }

      this.events.emitToSuperAdmin(WS_EVENTS.PROVISION_ACK, {
        serverTime:  new Date().toISOString(),
        severity:    data.status === 'OK' ? ('INFO' as const) : ('HIGH' as const),
        centerId:    '',
        centerName:  '',
        data,
      })
    } catch (err: any) {
      this.logger.error(`❌ Failed to process provision ACK: ${err.message}`)
    }
  }
}
