import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { JwtPayload, RequestUser } from '../interfaces/jwt-payload.interface'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    })
  }

  /**
   * Called automatically by Passport after the JWT signature is verified.
   * We do a live DB lookup so deactivated users are rejected immediately —
   * even if their token has not yet expired.
   *
   * The object returned here is attached to request.user for every
   * protected route and is injectable via @CurrentUser().
   */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        centerId: true,
        isActive: true,
      },
    })

    if (!user) {
      throw new UnauthorizedException('User no longer exists')
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account has been deactivated')
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      // Guarantee centerId is null (not undefined) for SUPER_ADMIN
      centerId: user.centerId ?? null,
      isActive: user.isActive,
    }
  }
}
