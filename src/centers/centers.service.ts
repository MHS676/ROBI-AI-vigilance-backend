import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCenterDto } from './dto/create-center.dto'
import { UpdateCenterDto } from './dto/update-center.dto'
import { AddCameraDto, AddEspNodeDto, AddMicrophoneDto } from './dto/add-hardware.dto'
import { Role } from '@prisma/client'
import { RequestUser } from '../auth/interfaces/jwt-payload.interface'
import { StreamingService } from '../streaming/streaming.service'

@Injectable()
export class CentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly streaming: StreamingService,
  ) {}

  // ── helpers ─────────────────────────────────────────────────────────

  /** Ensure the caller is allowed to touch this center at all */
  private assertCenterAccess(centerId: string, user: RequestUser) {
    if (user.role === Role.ADMIN && user.centerId !== centerId) {
      throw new ForbiddenException('Access denied — cross-center operation')
    }
  }

  // ── CENTERS CRUD ─────────────────────────────────────────────────────

  async create(dto: CreateCenterDto, requestingUser: RequestUser, mapUrl?: string) {
    if (requestingUser.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can create centers')
    }

    const existing = await this.prisma.center.findUnique({
      where: { code: dto.code },
    })
    if (existing) {
      throw new ConflictException(`Center code ${dto.code} already exists`)
    }

    return this.prisma.center.create({ data: { ...dto, ...(mapUrl && { mapUrl }) } })
  }

  async findAll(requestingUser: RequestUser) {
    const where =
      requestingUser.role === Role.SUPER_ADMIN
        ? { isActive: true }           // only active centers for global list
        : { id: requestingUser.centerId }

    return this.prisma.center.findMany({
      where,
      include: {
        _count: {
          select: { users: true, cameras: true, espNodes: true, tables: true },
        },
      },
      orderBy: { code: 'asc' },
    })
  }

  async findOne(id: string, requestingUser: RequestUser) {
    const center = await this.prisma.center.findUnique({
      where: { id },
      include: {
        cameras: { where: { isActive: true } },
        espNodes: { where: { isActive: true } },
        microphones: { where: { isActive: true } },
        tables: {
          where: { isActive: true },
          include: {
            camera: true,
            microphone: true,
            agent: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
        _count: { select: { users: true } },
      },
    })

    if (!center) throw new NotFoundException(`Center ${id} not found`)

    if (
      requestingUser.role === Role.ADMIN &&
      center.id !== requestingUser.centerId
    ) {
      throw new ForbiddenException('Access denied — cross-center lookup')
    }

    return center
  }

  async update(id: string, dto: UpdateCenterDto, requestingUser: RequestUser) {
    await this.findOne(id, requestingUser)

    if (requestingUser.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can update centers')
    }

    return this.prisma.center.update({ where: { id }, data: dto })
  }

  async remove(id: string, requestingUser: RequestUser) {
    if (requestingUser.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can delete centers')
    }
    await this.findOne(id, requestingUser)

    return this.prisma.center.update({
      where: { id },
      data: { isActive: false },
    })
  }

  // ── HARDWARE SUB-RESOURCES ───────────────────────────────────────────
  // These endpoints scope hardware creation to a specific center by
  // injecting centerId from the URL, so callers don't repeat it in body.

  async getCameras(centerId: string, caller: RequestUser) {
    this.assertCenterAccess(centerId, caller)
    await this.assertCenterExists(centerId)
    return this.prisma.camera.findMany({
      where: { centerId, isActive: true },
      include: {
        table: { select: { id: true, name: true, tableNumber: true } },
      },
      orderBy: { name: 'asc' },
    })
  }

  async addCamera(centerId: string, dto: AddCameraDto, caller: RequestUser) {
    if (caller.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can add cameras to a center')
    }
    await this.assertCenterExists(centerId)

    const camera = await this.prisma.camera.create({
      data: { ...dto, centerId, isActive: true },
      include: { center: { select: { id: true, name: true, code: true } } },
    })

    // Start HLS transcoding immediately for the new camera
    if (camera.rtspUrl && dto.status !== 'OFFLINE') {
      this.streaming.startCamera(camera.id, camera.rtspUrl)
    }

    return camera
  }

  async addEspNode(centerId: string, dto: AddEspNodeDto, caller: RequestUser) {
    if (caller.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can add ESP nodes to a center')
    }
    await this.assertCenterExists(centerId)

    const existing = await this.prisma.espNode.findUnique({
      where: { macAddress: dto.macAddress },
    })
    if (existing) {
      throw new ConflictException(
        `MAC address '${dto.macAddress}' is already registered to node '${existing.name}'`,
      )
    }

    return this.prisma.espNode.create({
      data: { ...dto, centerId },
      include: { center: { select: { id: true, name: true, code: true } } },
    })
  }

  async addMicrophone(centerId: string, dto: AddMicrophoneDto, caller: RequestUser) {
    if (caller.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can add microphones to a center')
    }
    await this.assertCenterExists(centerId)

    return this.prisma.microphone.create({
      data: { ...dto, centerId },
      include: { center: { select: { id: true, name: true, code: true } } },
    })
  }

  /**
   * Returns a full hardware inventory for a center:
   * all cameras, ESP nodes, microphones — each showing whether they are
   * currently assigned to a table or available for mapping.
   */
  async getHardwareInventory(centerId: string, caller: RequestUser) {
    this.assertCenterAccess(centerId, caller)
    await this.assertCenterExists(centerId)

    const [cameras, espNodes, microphones] = await Promise.all([
      this.prisma.camera.findMany({
        where: { centerId },
        include: {
          table: { select: { id: true, name: true, tableNumber: true, isActive: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.espNode.findMany({
        where: { centerId },
        orderBy: { name: 'asc' },
      }),
      this.prisma.microphone.findMany({
        where: { centerId },
        include: {
          table: { select: { id: true, name: true, tableNumber: true, isActive: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ])

    return {
      centerId,
      summary: {
        cameras: { total: cameras.length, assigned: cameras.filter((c) => c.table).length },
        espNodes: { total: espNodes.length, online: espNodes.filter((e) => e.status === 'ONLINE').length },
        microphones: { total: microphones.length, assigned: microphones.filter((m) => m.table).length },
      },
      cameras,
      espNodes,
      microphones,
    }
  }

  async getTablesByCenter(centerId: string, caller: RequestUser) {
    this.assertCenterAccess(centerId, caller)
    await this.assertCenterExists(centerId)

    return this.prisma.table.findMany({
      where: { centerId },
      include: {
        camera:     { select: { id: true, name: true, rtspUrl: true, status: true } },
        microphone: { select: { id: true, name: true, channel: true, status: true } },
        agent:      { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ tableNumber: 'asc' }],
    })
  }

  async getMicrophonesByCenter(centerId: string, caller: RequestUser) {
    this.assertCenterAccess(centerId, caller)
    await this.assertCenterExists(centerId)

    return this.prisma.microphone.findMany({
      where: { centerId },
      include: {
        table: { select: { id: true, name: true, tableNumber: true, isActive: true } },
      },
      orderBy: { name: 'asc' },
    })
  }

  // ── PRIVATE HELPERS ──────────────────────────────────────────────────

  private async assertCenterExists(centerId: string) {
    const center = await this.prisma.center.findUnique({ where: { id: centerId } })
    if (!center) throw new NotFoundException(`Center '${centerId}' not found`)
    if (!center.isActive) throw new NotFoundException(`Center '${center.name}' is no longer active`)
    return center
  }
}
