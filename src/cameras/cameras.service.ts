import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import * as net from 'net'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCameraDto } from './dto/create-camera.dto'
import { UpdateCameraDto } from './dto/update-camera.dto'
import { Role } from '@prisma/client'

// ─── TCP probe: tries to open a socket to host:port within timeoutMs ──────────
function tcpProbe(
  host: string,
  port = 554,
  timeoutMs = 3000,
): Promise<{ reachable: boolean; latencyMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      socket.destroy()
      resolve({ reachable: true, latencyMs: Date.now() - start })
    })
    socket.once('timeout', () => { socket.destroy(); resolve({ reachable: false, latencyMs: timeoutMs }) })
    socket.once('error',   () => { socket.destroy(); resolve({ reachable: false, latencyMs: Date.now() - start }) })
    socket.connect(port, host)
  })
}

@Injectable()
export class CamerasService {
  constructor(private prisma: PrismaService) {}

  private scopeGuard(camera: any, requestingUser: any) {
    if (
      requestingUser.role === Role.ADMIN &&
      camera.centerId !== requestingUser.centerId
    ) {
      throw new ForbiddenException('Access denied — cross-center camera')
    }
  }

  async create(dto: CreateCameraDto, requestingUser: any) {
    if (
      requestingUser.role === Role.ADMIN &&
      dto.centerId !== requestingUser.centerId
    ) {
      throw new ForbiddenException('ADMINs can only add cameras to their center')
    }

    return this.prisma.camera.create({
      data: dto,
      include: { center: { select: { id: true, name: true, code: true } } },
    })
  }

  async findAll(requestingUser: any) {
    const where =
      requestingUser.role === Role.SUPER_ADMIN
        ? {}
        : { centerId: requestingUser.centerId }

    return this.prisma.camera.findMany({
      where,
      include: {
        center: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, name: true, tableNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string, requestingUser: any) {
    const camera = await this.prisma.camera.findUnique({
      where: { id },
      include: {
        center: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, name: true, tableNumber: true } },
      },
    })

    if (!camera) throw new NotFoundException(`Camera ${id} not found`)
    this.scopeGuard(camera, requestingUser)
    return camera
  }

  async ping(id: string, requestingUser: any) {
    const camera = await this.findOne(id, requestingUser)

    if (!camera.ipAddress) {
      return { status: 'UNKNOWN', latencyMs: null, message: 'No IP address configured' }
    }

    // Extract port from RTSP URL if available, otherwise use 554 (standard RTSP)
    let port = 554
    try {
      const match = camera.rtspUrl?.match(/:(\/\/[^/]+:)(\d+)/)
      if (match) port = parseInt(match[2], 10)
    } catch { /* use default */ }

    const { reachable, latencyMs } = await tcpProbe(camera.ipAddress, port)
    const newStatus = reachable ? 'ONLINE' : 'OFFLINE'

    await this.prisma.camera.update({
      where: { id },
      data: { status: newStatus as any },
    })

    return { status: newStatus, latencyMs, ip: camera.ipAddress }
  }

  async update(id: string, dto: UpdateCameraDto, requestingUser: any) {
    const camera = await this.findOne(id, requestingUser)

    return this.prisma.camera.update({
      where: { id: camera.id },
      data: dto,
    })
  }

  async remove(id: string, requestingUser: any) {
    const camera = await this.findOne(id, requestingUser)

    return this.prisma.camera.update({
      where: { id: camera.id },
      data: { isActive: false },
    })
  }
}
