// ─────────────────────────────────────────────────────────────────────────────
// ProvisioningService
//
// Business logic layer for the Zero-Config Hardware Provisioning System:
//
//  • findAll / findPending / findOne — query DeviceInventory
//  • assign  — approve a PENDING device, publish MQTT provisioning config
//  • reject  — mark device REJECTED
//  • scanCameras — delegate to OnvifScannerService
//  • addDiscoveredCamera — add an ONVIF-discovered camera to a center
// ─────────────────────────────────────────────────────────────────────────────

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common'
import { ClientProxy } from '@nestjs/microservices'
import { PrismaService } from '../prisma/prisma.service'
import { EventsGateway } from '../events/events.gateway'
import { OnvifScannerService, DiscoveredCamera } from './onvif-scanner.service'
import { AssignDeviceDto } from './dto/assign-device.dto'
import { RejectDeviceDto } from './dto/reject-device.dto'
import { ScanCamerasDto } from './dto/scan-cameras.dto'
import { DeviceInventoryQueryDto } from './dto/device-inventory-query.dto'
import { WS_EVENTS, provisionTopic } from '../mqtt/mqtt.constants'
import { InventoryStatus, InventoryDeviceType } from '@prisma/client'

export interface ProvisionConfig {
  centerId:     string
  centerCode:   string
  tableId?:     string
  wifiSsid:     string
  wifiPassword: string
  serverUrl:    string
  mqttUrl:      string
  provisionedAt: string
}

@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly onvifScanner: OnvifScannerService,
    @Inject('MQTT_CLIENT') private readonly mqttClient: ClientProxy,
  ) {}

  // ── Queries ───────────────────────────────────────────────────────────────

  async findAll(filters: DeviceInventoryQueryDto) {
    return this.prisma.deviceInventory.findMany({
      where: {
        ...(filters.status     ? { status:     filters.status }     : {}),
        ...(filters.deviceType ? { deviceType: filters.deviceType } : {}),
        ...(filters.centerId   ? { centerId:   filters.centerId }   : {}),
      },
      include: { center: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findPending() {
    return this.prisma.deviceInventory.findMany({
      where:   { status: InventoryStatus.PENDING },
      include: { center: { select: { id: true, name: true, code: true } } },
      orderBy: { lastSeenAt: 'desc' },
    })
  }

  async findOne(id: string) {
    const device = await this.prisma.deviceInventory.findUnique({
      where:   { id },
      include: { center: { select: { id: true, name: true, code: true } } },
    })
    if (!device) throw new NotFoundException(`Device inventory record ${id} not found`)
    return device
  }

  // ── Assign ────────────────────────────────────────────────────────────────

  /**
   * Super Admin approves a PENDING device and assigns it to a Center.
   *
   * Steps:
   *  1. Validate device exists and is PENDING
   *  2. Validate center exists
   *  3. Optionally validate table exists and belongs to the center
   *  4. Build provisioning config
   *  5. Publish config to device via MQTT
   *  6. Update DB → ASSIGNED
   *  7. Emit WS event to SUPER_ADMIN room
   */
  async assign(id: string, dto: AssignDeviceDto) {
    const device = await this.findOne(id)

    if (device.status === InventoryStatus.ASSIGNED) {
      throw new BadRequestException('Device is already assigned — use re-provision to update config')
    }
    if (device.status === InventoryStatus.REJECTED) {
      throw new BadRequestException('Device is REJECTED. Un-reject it first before assigning.')
    }

    // Validate center
    const center = await this.prisma.center.findUnique({ where: { id: dto.centerId } })
    if (!center) throw new NotFoundException(`Center ${dto.centerId} not found`)

    // Optionally validate table
    if (dto.tableId) {
      const table = await this.prisma.table.findUnique({ where: { id: dto.tableId } })
      if (!table) throw new NotFoundException(`Table ${dto.tableId} not found`)
      if (table.centerId !== dto.centerId) {
        throw new BadRequestException('Table does not belong to the specified Center')
      }
    }

    // Build the config that will be MQTT-published to the device
    const config: ProvisionConfig = {
      centerId:     center.id,
      centerCode:   center.code,
      tableId:      dto.tableId,
      wifiSsid:     dto.wifiSsid,
      wifiPassword: dto.wifiPassword,
      serverUrl:    process.env.BACKEND_URL ?? 'http://localhost:3000',
      mqttUrl:      process.env.MQTT_URL    ?? 'mqtt://localhost:1883',
      provisionedAt: new Date().toISOString(),
    }

    // Publish provisioning config to the device-specific MQTT topic
    if (device.macAddress) {
      const topic = provisionTopic(device.macAddress)
      this.mqttClient.emit(topic, config)
      this.logger.log(`📤 Provisioning config sent to [${topic}]`)
    }

    // Persist assignment
    const updated = await this.prisma.deviceInventory.update({
      where: { id },
      data: {
        status:         InventoryStatus.ASSIGNED,
        centerId:       dto.centerId,
        notes:          dto.notes,
        provisionConfig: config as object,
        provisionedAt:   new Date(),
      },
      include: { center: { select: { id: true, name: true, code: true } } },
    })

    // Notify Super Admin via WebSocket
    this.events.emitToSuperAdmin(WS_EVENTS.DEVICE_PROVISIONED, {
      serverTime:  new Date().toISOString(),
      severity:    'INFO',
      centerId:    center.id,
      centerName:  center.name,
      data:        updated,
    })

    this.logger.log(`✅ Device ${device.macAddress ?? id} assigned to center "${center.name}"`)
    return updated
  }

  // ── Reject ────────────────────────────────────────────────────────────────

  async reject(id: string, dto: RejectDeviceDto) {
    const device = await this.findOne(id)

    if (device.status === InventoryStatus.ASSIGNED) {
      throw new BadRequestException('Cannot reject an already-assigned device. Un-assign it first.')
    }

    const updated = await this.prisma.deviceInventory.update({
      where: { id },
      data: {
        status: InventoryStatus.REJECTED,
        notes:  dto.notes,
      },
      include: { center: { select: { id: true, name: true, code: true } } },
    })

    this.events.emitToSuperAdmin(WS_EVENTS.DEVICE_REJECTED, {
      serverTime: new Date().toISOString(),
      severity:   'LOW',
      centerId:   '',
      centerName: '',
      data:       updated,
    })

    this.logger.log(`🚫 Device ${device.macAddress ?? id} rejected`)
    return updated
  }

  // ── Re-Provision ──────────────────────────────────────────────────────────

  /**
   * Re-sends the MQTT provisioning config to an already-ASSIGNED device.
   * Useful when WiFi credentials change or device needs a factory-reset.
   */
  async reprovision(id: string, dto: AssignDeviceDto) {
    const device = await this.findOne(id)
    if (device.status !== InventoryStatus.ASSIGNED) {
      throw new BadRequestException('Only ASSIGNED devices can be re-provisioned')
    }
    return this.assign(id, dto)
  }

  // ── Camera Scan ───────────────────────────────────────────────────────────

  async scanCameras(dto: ScanCamerasDto): Promise<DiscoveredCamera[]> {
    return this.onvifScanner.scan(dto.subnet, dto.timeoutMs, dto.concurrency)
  }

  /**
   * Add a camera discovered via ONVIF scan directly to a Center as a Camera record.
   * Also creates a corresponding DeviceInventory record (ASSIGNED).
   */
  async addDiscoveredCamera(
    centerId: string,
    camera: {
      ipAddress: string
      manufacturer?: string
      model?: string
      onvifXAddr?: string
      rtspUrl?: string
      name?: string
    },
  ) {
    const center = await this.prisma.center.findUnique({ where: { id: centerId } })
    if (!center) throw new NotFoundException(`Center ${centerId} not found`)

    const name = camera.name ?? `${camera.manufacturer ?? 'CAM'} — ${camera.ipAddress}`
    const rtspUrl = camera.rtspUrl ?? `rtsp://admin:admin@${camera.ipAddress}:554/stream1`

    // Create the Camera record
    const newCamera = await this.prisma.camera.create({
      data: {
        name,
        rtspUrl,
        ipAddress: camera.ipAddress,
        model:     camera.model ?? camera.manufacturer,
        centerId,
      },
      include: { center: { select: { id: true, name: true, code: true } } },
    })

    // Record in device inventory as ASSIGNED (cameras don't need PENDING approval)
    await this.prisma.deviceInventory.upsert({
      where:  { macAddress: `CAM-${camera.ipAddress}` },
      update: {
        status:   InventoryStatus.ASSIGNED,
        centerId,
        model:    camera.model,
        manufacturer: camera.manufacturer,
        onvifXAddr:   camera.onvifXAddr,
        rtspUrl:      rtspUrl,
        ipAddress:    camera.ipAddress,
        lastSeenAt:   new Date(),
        provisionedAt: new Date(),
      },
      create: {
        macAddress:   `CAM-${camera.ipAddress}`,
        deviceType:   InventoryDeviceType.CAMERA,
        ipAddress:    camera.ipAddress,
        model:        camera.model,
        manufacturer: camera.manufacturer,
        onvifXAddr:   camera.onvifXAddr,
        rtspUrl:      rtspUrl,
        status:       InventoryStatus.ASSIGNED,
        centerId,
        lastSeenAt:   new Date(),
        provisionedAt: new Date(),
      },
    })

    this.logger.log(`📷 Camera at ${camera.ipAddress} added to center "${center.name}"`)
    return newCamera
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async getStats() {
    const [pending, assigned, rejected, offline, total] = await Promise.all([
      this.prisma.deviceInventory.count({ where: { status: InventoryStatus.PENDING } }),
      this.prisma.deviceInventory.count({ where: { status: InventoryStatus.ASSIGNED } }),
      this.prisma.deviceInventory.count({ where: { status: InventoryStatus.REJECTED } }),
      this.prisma.deviceInventory.count({ where: { status: InventoryStatus.OFFLINE } }),
      this.prisma.deviceInventory.count(),
    ])
    return { total, pending, assigned, rejected, offline }
  }
}
