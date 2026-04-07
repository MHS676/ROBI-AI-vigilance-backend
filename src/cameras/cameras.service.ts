import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCameraDto } from './dto/create-camera.dto'
import { UpdateCameraDto } from './dto/update-camera.dto'
import { Role } from '@prisma/client'

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
