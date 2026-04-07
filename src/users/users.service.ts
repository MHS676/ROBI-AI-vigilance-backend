import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import { UpdateUserDto } from './dto/update-user.dto'
import { Role } from '@prisma/client'

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private readonly safeSelect = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    role: true,
    centerId: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  }

  // SUPER_ADMIN: all users | ADMIN: only users in their center
  async findAll(requestingUser: any) {
    const where =
      requestingUser.role === Role.SUPER_ADMIN
        ? {}
        : { centerId: requestingUser.centerId }

    return this.prisma.user.findMany({
      where,
      select: this.safeSelect,
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string, requestingUser: any) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...this.safeSelect,
        assignedTable: {
          select: { id: true, name: true, tableNumber: true },
        },
      },
    })

    if (!user) throw new NotFoundException(`User ${id} not found`)

    // ADMINs can only view users in their center
    if (
      requestingUser.role === Role.ADMIN &&
      user.centerId !== requestingUser.centerId
    ) {
      throw new ForbiddenException('Access denied — cross-center lookup')
    }

    return user
  }

  async update(id: string, dto: UpdateUserDto, requestingUser: any) {
    const user = await this.findOne(id, requestingUser)

    // Only SUPER_ADMIN can change roles
    if (dto.role && requestingUser.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can change roles')
    }

    const data: any = { ...dto }
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 12)
    }

    return this.prisma.user.update({
      where: { id: user.id },
      data,
      select: this.safeSelect,
    })
  }

  async remove(id: string, requestingUser: any) {
    await this.findOne(id, requestingUser)

    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: this.safeSelect,
    })
  }
}
