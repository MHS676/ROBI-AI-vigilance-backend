import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import * as net from 'net'
import { PrismaService } from '../prisma/prisma.service'
import { EventsGateway } from '../events/events.gateway'
import { WS_EVENTS } from '../mqtt/mqtt.constants'
import { DeviceStatus } from '@prisma/client'
import { StreamingService } from '../streaming/streaming.service'

// ─── TCP probe ────────────────────────────────────────────────────────────────
function tcpProbe(
  host: string,
  port: number,
  timeoutMs = 4000,
): Promise<{ reachable: boolean; latencyMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      socket.destroy()
      resolve({ reachable: true, latencyMs: Date.now() - start })
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve({ reachable: false, latencyMs: timeoutMs })
    })
    socket.once('error', () => {
      socket.destroy()
      resolve({ reachable: false, latencyMs: Date.now() - start })
    })
    socket.connect(port, host)
  })
}

// ─── Extract host:port from an RTSP URL ───────────────────────────────────────
function parseRtspPort(rtspUrl: string): number {
  try {
    // rtsp://user:pass@192.168.1.10:554/stream  →  554
    const match = rtspUrl.match(/rtsp:\/\/[^/]*:(\d+)/)
    if (match) return parseInt(match[1], 10)
  } catch { /* fall through */ }
  return 554
}

// ─────────────────────────────────────────────────────────────────────────────
// CameraPollerService
//
// Runs every 30 seconds and TCP-probes every active camera's RTSP port.
// If a camera transitions ONLINE→OFFLINE or vice-versa:
//   1. Updates the `status` column in PostgreSQL.
//   2. Emits `update:device_status` to the affected center's WS room.
//   3. Emits `alert:device_offline` when a camera goes OFFLINE (red alert).
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CameraPollerService implements OnModuleInit {
  private readonly logger = new Logger(CameraPollerService.name)
  /** centerId → { name } — resolved lazily, cached */
  private centerCache = new Map<string, { name: string; code: string }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    @Optional() private readonly streaming: StreamingService,
  ) {}

  /** Fire one poll immediately when the module boots so admins see status right away. */
  onModuleInit() {
    // Delay slightly to let DB connection warm up
    setTimeout(() => this.pollAll(), 5_000)
  }

  // ── Cron: every 30 seconds ──────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollAll(): Promise<void> {
    let cameras: Array<{
      id: string
      name: string
      ipAddress: string | null
      rtspUrl: string
      status: DeviceStatus
      centerId: string
    }> = []

    // Guard: DB may be temporarily unreachable (P1001). Skip the poll cycle
    // rather than letting the error bubble up to the [Scheduler] error handler.
    try {
      cameras = await this.prisma.camera.findMany({
        where: {
          isActive: true,
          ipAddress: { not: null },
        },
        select: {
          id: true,
          name: true,
          ipAddress: true,
          rtspUrl: true,
          status: true,
          centerId: true,
        },
      })
    } catch (err) {
      this.logger.warn(
        `📷 Poll cycle skipped — DB unreachable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      return
    }

    if (cameras.length === 0) return

    this.logger.debug(`📷 Polling ${cameras.length} camera(s)…`)

    // Run all probes concurrently (with a cap so we don't flood the network)
    const BATCH = 20
    for (let i = 0; i < cameras.length; i += BATCH) {
      const batch = cameras.slice(i, i + BATCH)
      await Promise.all(batch.map((cam) => this.probe(cam)))
    }
  }

  // ── Per-camera probe ────────────────────────────────────────────────────────
  private async probe(cam: {
    id: string
    name: string
    ipAddress: string | null
    rtspUrl: string
    status: DeviceStatus
    centerId: string
  }): Promise<void> {
    if (!cam.ipAddress) return

    const port = parseRtspPort(cam.rtspUrl)
    const { reachable, latencyMs } = await tcpProbe(cam.ipAddress, port)
    const newStatus: DeviceStatus = reachable ? DeviceStatus.ONLINE : DeviceStatus.OFFLINE

    // Skip DB write + WS emit if status hasn't changed
    if (newStatus === cam.status) return

    this.logger.log(
      `📷 Camera "${cam.name}" [${cam.ipAddress}:${port}] → ${newStatus} (${latencyMs}ms)`,
    )

    // ── 1. Persist ──────────────────────────────────────────────────────────
    try {
      await this.prisma.camera.update({
        where: { id: cam.id },
        data: { status: newStatus },
      })
    } catch (err) {
      this.logger.warn(
        `📷 Could not persist status for "${cam.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      return
    }

    // ── 2. Resolve center ───────────────────────────────────────────────────
    const center = await this.resolveCenter(cam.centerId)
    if (!center) return

    // ── 3. Emit update:device_status to center + super_admin room ───────────
    // If camera just came back ONLINE, restart its HLS stream
    if (newStatus === DeviceStatus.ONLINE && cam.rtspUrl) {
      this.streaming?.onCameraOnline(cam.id, cam.rtspUrl)
    }

    const statusEnvelope = this.events.buildEnvelope(
      cam.centerId,
      center.name,
      newStatus === DeviceStatus.OFFLINE ? 'MEDIUM' : 'INFO',
      {
        deviceId:   cam.id,
        deviceType: 'CAMERA',
        status:     newStatus,
        ipAddress:  cam.ipAddress,
        latencyMs,
        name:       cam.name,
        centerName: center.name,
      },
    )
    this.events.emitToCenterAndSuperAdmin(
      cam.centerId,
      WS_EVENTS.DEVICE_STATUS_UPDATE,
      statusEnvelope,
    )

    // ── 4. Emit alert:device_offline for Red Alert on dashboard ─────────────
    if (newStatus === DeviceStatus.OFFLINE) {
      // Stop the HLS stream for this camera
      this.streaming?.onCameraOffline(cam.id)

      const offlineEnvelope = this.events.buildEnvelope(
        cam.centerId,
        center.name,
        'MEDIUM',
        {
          deviceId:   cam.id,
          deviceType: 'CAMERA',
          status:     'OFFLINE',
          ipAddress:  cam.ipAddress,
          name:       cam.name,
          centerName: center.name,
        },
      )
      this.events.emitToCenterAndSuperAdmin(
        cam.centerId,
        WS_EVENTS.DEVICE_OFFLINE,
        offlineEnvelope,
      )
      this.logger.warn(
        `🔴 OFFLINE alert: Camera "${cam.name}" [${cam.ipAddress}] in ${center.code}`,
      )
    }
  }

  // ── Center cache ────────────────────────────────────────────────────────────
  private async resolveCenter(
    centerId: string,
  ): Promise<{ name: string; code: string } | null> {
    if (this.centerCache.has(centerId)) return this.centerCache.get(centerId)!
    const c = await this.prisma.center.findUnique({
      where: { id: centerId },
      select: { name: true, code: true },
    })
    if (!c) return null
    this.centerCache.set(centerId, c)
    return c
  }
}
