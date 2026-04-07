import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateEspNodeDto } from './dto/create-esp-node.dto'
import { UpdateEspNodeDto } from './dto/update-esp-node.dto'
import { Role } from '@prisma/client'

@Injectable()
export class EspNodesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateEspNodeDto, requestingUser: any) {
    if (
      requestingUser.role === Role.ADMIN &&
      dto.centerId !== requestingUser.centerId
    ) {
      throw new ForbiddenException('ADMINs can only add ESP nodes to their center')
    }

    const existing = await this.prisma.espNode.findUnique({
      where: { macAddress: dto.macAddress },
    })
    if (existing) {
      throw new ConflictException(`MAC address ${dto.macAddress} already registered`)
    }

    return this.prisma.espNode.create({
      data: dto,
      include: { center: { select: { id: true, name: true, code: true } } },
    })
  }

  async findAll(requestingUser: any) {
    const where =
      requestingUser.role === Role.SUPER_ADMIN
        ? {}
        : { centerId: requestingUser.centerId }

    return this.prisma.espNode.findMany({
      where,
      include: { center: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string, requestingUser: any) {
    const node = await this.prisma.espNode.findUnique({
      where: { id },
      include: { center: { select: { id: true, name: true, code: true } } },
    })

    if (!node) throw new NotFoundException(`ESP Node ${id} not found`)

    if (
      requestingUser.role === Role.ADMIN &&
      node.centerId !== requestingUser.centerId
    ) {
      throw new ForbiddenException('Access denied — cross-center node')
    }

    return node
  }

  async heartbeat(macAddress: string) {
    const node = await this.prisma.espNode.findUnique({ where: { macAddress } })
    if (!node) throw new NotFoundException(`ESP Node MAC ${macAddress} not found`)

    return this.prisma.espNode.update({
      where: { macAddress },
      data: { lastSeenAt: new Date(), status: 'ONLINE' },
    })
  }

  async update(id: string, dto: UpdateEspNodeDto, requestingUser: any) {
    const node = await this.findOne(id, requestingUser)
    return this.prisma.espNode.update({ where: { id: node.id }, data: dto })
  }

  async remove(id: string, requestingUser: any) {
    const node = await this.findOne(id, requestingUser)
    return this.prisma.espNode.update({
      where: { id: node.id },
      data: { isActive: false },
    })
  }
}
