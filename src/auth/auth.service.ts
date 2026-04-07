import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Role } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { JwtPayload, RequestUser } from './interfaces/jwt-payload.interface'

/** Fields returned to the client — never includes the hashed password */
export interface AuthResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: string
  user: Omit<RequestUser, 'isActive'> & { createdAt?: Date }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // REGISTER
  // Only SUPER_ADMINs can create other SUPER_ADMIN or ADMIN accounts.
  // Open registration always defaults to AGENT role.
  // ─────────────────────────────────────────────────────────────
  async register(dto: RegisterDto, requestingUser?: RequestUser): Promise<AuthResponse> {
    // Only SUPER_ADMIN may create ADMIN or other SUPER_ADMIN accounts
    if (
      dto.role &&
      dto.role !== Role.AGENT &&
      requestingUser?.role !== Role.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only SUPER_ADMIN can create ADMIN or SUPER_ADMIN accounts',
      )
    }

    // ADMIN creating a user must lock them to the same center
    if (requestingUser?.role === Role.ADMIN) {
      dto.centerId = requestingUser.centerId ?? undefined
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    })
    if (existing) {
      throw new ConflictException(`Email '${dto.email}' is already registered`)
    }

    const hashed = await bcrypt.hash(dto.password, 12)

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role ?? Role.AGENT,
        // SUPER_ADMIN has no centerId — global scope
        centerId: dto.role === Role.SUPER_ADMIN ? null : (dto.centerId ?? null),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        centerId: true,
        createdAt: true,
      },
    })

    return this.buildResponse(user)
  }

  // ─────────────────────────────────────────────────────────────
  // LOGIN
  // ─────────────────────────────────────────────────────────────
  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    })

    if (!user || !user.isActive) {
      // Intentionally vague — don't leak whether the email exists
      throw new UnauthorizedException('Invalid email or password')
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.password)
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid email or password')
    }

    return this.buildResponse(user)
  }

  // ─────────────────────────────────────────────────────────────
  // VALIDATE USER  (called by LocalStrategy if ever added)
  // ─────────────────────────────────────────────────────────────
  async validateUser(email: string, password: string): Promise<RequestUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !user.isActive) return null

    const match = await bcrypt.compare(password, user.password)
    if (!match) return null

    const { password: _pw, ...rest } = user
    return rest as RequestUser
  }

  // ─────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Build a signed JWT.
   * SUPER_ADMIN  → centerId is always null  (global scope)
   * ADMIN/AGENT  → centerId is the branch id
   */
  private signToken(user: {
    id: string
    email: string
    role: Role
    centerId: string | null
  }): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      centerId: user.role === Role.SUPER_ADMIN ? null : user.centerId,
    }
    return this.jwtService.sign(payload)
  }

  private buildResponse(user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: Role
    centerId: string | null
    createdAt?: Date
  }): AuthResponse {
    const token = this.signToken(user)
    return {
      access_token: token,
      token_type: 'Bearer',
      expires_in: process.env.JWT_EXPIRES_IN ?? '7d',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        centerId: user.role === Role.SUPER_ADMIN ? null : user.centerId,
        ...(user.createdAt && { createdAt: user.createdAt }),
      },
    }
  }
}
