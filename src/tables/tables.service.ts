import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateTableDto } from './dto/create-table.dto'
import { UpdateTableDto } from './dto/update-table.dto'
import { Role } from '@prisma/client'

@Injectable()
export class TablesService {
  constructor(private prisma: PrismaService) {}

  // Full relation include for consistent responses
  private tableInclude = {
    center: { select: { id: true, name: true, code: true } },
    camera: {
      select: { id: true, name: true, rtspUrl: true, status: true },
    },
    microphone: {
      select: { id: true, name: true, channel: true, status: true },
    },
    agent: {
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
    },
  }

  async create(dto: CreateTableDto, requestingUser: any) {
    // ADMIN scope check
    if (
      requestingUser.role === Role.ADMIN &&
      dto.centerId !== requestingUser.centerId
    ) {
      throw new ForbiddenException('ADMINs can only create tables in their center')
    }

    // Validate: agent must belong to the same center
    const agent = await this.prisma.user.findUnique({ where: { id: dto.agentId } })
    if (!agent) throw new NotFoundException(`Agent ${dto.agentId} not found`)
    if (agent.centerId !== dto.centerId) {
      throw new BadRequestException('Agent must belong to the same center as the table')
    }
    if (agent.role !== Role.AGENT) {
      throw new BadRequestException('Only users with role AGENT can be assigned to a table')
    }

    // Validate: camera must belong to the same center
    const camera = await this.prisma.camera.findUnique({ where: { id: dto.cameraId } })
    if (!camera) throw new NotFoundException(`Camera ${dto.cameraId} not found`)
    if (camera.centerId !== dto.centerId) {
      throw new BadRequestException('Camera must belong to the same center as the table')
    }

    // Validate: microphone must belong to the same center
    const mic = await this.prisma.microphone.findUnique({ where: { id: dto.microphoneId } })
    if (!mic) throw new NotFoundException(`Microphone ${dto.microphoneId} not found`)
    if (mic.centerId !== dto.centerId) {
      throw new BadRequestException('Microphone must belong to the same center as the table')
    }

    try {
      return await this.prisma.table.create({
        data: {
          name: dto.name,
          tableNumber: dto.tableNumber,
          centerId: dto.centerId,
          cameraId: dto.cameraId,
          boundingBox: dto.boundingBox as any,
          microphoneId: dto.microphoneId,
          agentId: dto.agentId,
          notes: dto.notes,
        },
        include: this.tableInclude,
      })
    } catch (e: any) {
      if (e.code === 'P2002') {
        // Unique constraint violation — determine which field
        const target = e.meta?.target as string[]
        if (target?.includes('cameraId')) {
          throw new ConflictException('Camera is already assigned to another table')
        }
        if (target?.includes('microphoneId')) {
          throw new ConflictException('Microphone is already assigned to another table')
        }
        if (target?.includes('agentId')) {
          throw new ConflictException('Agent is already assigned to another table')
        }
        if (target?.includes('centerId') && target?.includes('tableNumber')) {
          throw new ConflictException(`Table number ${dto.tableNumber} already exists in this center`)
        }
      }
      throw e
    }
  }

  async findAll(requestingUser: any) {
    const where =
      requestingUser.role === Role.SUPER_ADMIN
        ? {}
        : { centerId: requestingUser.centerId }

    return this.prisma.table.findMany({
      where,
      include: this.tableInclude,
      orderBy: [{ centerId: 'asc' }, { tableNumber: 'asc' }],
    })
  }

  async findOne(id: string, requestingUser: any) {
    const table = await this.prisma.table.findUnique({
      where: { id },
      include: this.tableInclude,
    })

    if (!table) throw new NotFoundException(`Table ${id} not found`)

    if (
      requestingUser.role === Role.ADMIN &&
      table.centerId !== requestingUser.centerId
    ) {
      throw new ForbiddenException('Access denied — cross-center table')
    }

    return table
  }

  async findByAgent(agentId: string, requestingUser: any) {
    const table = await this.prisma.table.findUnique({
      where: { agentId },
      include: this.tableInclude,
    })

    if (!table) throw new NotFoundException(`No table assigned to agent ${agentId}`)

    if (
      requestingUser.role === Role.ADMIN &&
      table.centerId !== requestingUser.centerId
    ) {
      throw new ForbiddenException('Access denied')
    }

    return table
  }

  async update(id: string, dto: UpdateTableDto, requestingUser: any) {
    const existing = await this.findOne(id, requestingUser)

    try {
      return await this.prisma.table.update({
        where: { id: existing.id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.tableNumber && { tableNumber: dto.tableNumber }),
          ...(dto.cameraId && { cameraId: dto.cameraId }),
          ...(dto.boundingBox && { boundingBox: dto.boundingBox as any }),
          ...(dto.microphoneId && { microphoneId: dto.microphoneId }),
          ...(dto.agentId && { agentId: dto.agentId }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
        include: this.tableInclude,
      })
    } catch (e: any) {
      if (e.code === 'P2002') {
        throw new ConflictException('A unique constraint was violated — camera, microphone, or agent already assigned')
      }
      throw e
    }
  }

  async remove(id: string, requestingUser: any) {
    const table = await this.findOne(id, requestingUser)
    return this.prisma.table.update({
      where: { id: table.id },
      data: { isActive: false },
    })
  }
}
