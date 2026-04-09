import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import * as net from 'net'
import { PrismaService } from '../prisma/prisma.service'
import { CreateMicrophoneDto } from './dto/create-microphone.dto'
import { UpdateMicrophoneDto } from './dto/update-microphone.dto'
import { Role } from '@prisma/client'

// ─── TCP probe helper ─────────────────────────────────────────────────────────
function tcpProbe(
  host: string,
  port = 80,
  timeoutMs = 3000,
): Promise<{ reachable: boolean; latencyMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => { socket.destroy(); resolve({ reachable: true,  latencyMs: Date.now() - start }) })
    socket.once('timeout', () => { socket.destroy(); resolve({ reachable: false, latencyMs: timeoutMs }) })
    socket.once('error',   () => { socket.destroy(); resolve({ reachable: false, latencyMs: Date.now() - start }) })
    socket.connect(port, host)
  })
}

@Injectable()
export class MicrophonesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateMicrophoneDto, requestingUser: any) {
    if (
      requestingUser.role === Role.ADMIN &&
      dto.centerId !== requestingUser.centerId
    ) {
      throw new ForbiddenException('ADMINs can only add microphones to their center')
    }

    return this.prisma.microphone.create({
      data: dto,
      include: { center: { select: { id: true, name: true, code: true } } },
    })
  }

  async findAll(requestingUser: any) {
    const where =
      requestingUser.role === Role.SUPER_ADMIN
        ? {}
        : { centerId: requestingUser.centerId }

    return this.prisma.microphone.findMany({
      where,
      include: {
        center: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, name: true, tableNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string, requestingUser: any) {
    const mic = await this.prisma.microphone.findUnique({
      where: { id },
      include: {
        center: { select: { id: true, name: true, code: true } },
        table: { select: { id: true, name: true, tableNumber: true } },
      },
    })

    if (!mic) throw new NotFoundException(`Microphone ${id} not found`)

    if (
      requestingUser.role === Role.ADMIN &&
      mic.centerId !== requestingUser.centerId
    ) {
      throw new ForbiddenException('Access denied — cross-center microphone')
    }

    return mic
  }

  async ping(id: string, requestingUser: any) {
    const mic = await this.findOne(id, requestingUser)

    if (!mic.ipAddress) {
      return { status: 'UNKNOWN', latencyMs: null, message: 'No IP address configured' }
    }

    const { reachable, latencyMs } = await tcpProbe(mic.ipAddress, 80)
    const newStatus = reachable ? 'ONLINE' : 'OFFLINE'

    await this.prisma.microphone.update({
      where: { id },
      data: { status: newStatus as any },
    })

    return { status: newStatus, latencyMs, ip: mic.ipAddress }
  }

  async update(id: string, dto: UpdateMicrophoneDto, requestingUser: any) {
    const mic = await this.findOne(id, requestingUser)
    return this.prisma.microphone.update({ where: { id: mic.id }, data: dto })
  }

  async remove(id: string, requestingUser: any) {
    const mic = await this.findOne(id, requestingUser)
    return this.prisma.microphone.update({
      where: { id: mic.id },
      data: { isActive: false },
    })
  }
}
