import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCenterDto } from './dto/create-center.dto'
import { UpdateCenterDto } from './dto/update-center.dto'
import { Role } from '@prisma/client'

@Injectable()
export class CentersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCenterDto, requestingUser: any) {
    if (requestingUser.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can create centers')
    }

    const existing = await this.prisma.center.findUnique({
      where: { code: dto.code },
    })
    if (existing) {
      throw new ConflictException(`Center code ${dto.code} already exists`)
    }

    return this.prisma.center.create({ data: dto })
  }

  async findAll(requestingUser: any) {
    const where =
      requestingUser.role === Role.SUPER_ADMIN
        ? {}
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

  async findOne(id: string, requestingUser: any) {
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

  async update(id: string, dto: UpdateCenterDto, requestingUser: any) {
    await this.findOne(id, requestingUser)

    if (requestingUser.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can update centers')
    }

    return this.prisma.center.update({ where: { id }, data: dto })
  }

  async remove(id: string, requestingUser: any) {
    if (requestingUser.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can delete centers')
    }
    await this.findOne(id, requestingUser)

    return this.prisma.center.update({
      where: { id },
      data: { isActive: false },
    })
  }
}
