import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Role } from '@prisma/client'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { RequestUser } from '../interfaces/jwt-payload.interface'

/**
 * Role hierarchy used for access decisions:
 *
 *   SUPER_ADMIN (3)  ──►  can access any route
 *   ADMIN       (2)  ──►  can access ADMIN + AGENT routes
 *   AGENT       (1)  ──►  can only access AGENT routes
 *
 * A route decorated with @Roles(Role.ADMIN) is accessible by
 * both ADMIN and SUPER_ADMIN, but NOT by AGENT.
 */
const ROLE_HIERARCHY: Record<Role, number> = {
  [Role.SUPER_ADMIN]: 3,
  [Role.ADMIN]: 2,
  [Role.AGENT]: 1,
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Collect roles from both handler (@Roles on method) and class (@Roles on controller)
    // getAllAndOverride uses the most specific (handler) first, then falls back to class
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    // No @Roles() decorator → route is open to any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest()
    const user: RequestUser | undefined = request.user

    // JwtAuthGuard must run before RolesGuard — if user is missing something is wired wrong
    if (!user) {
      throw new ForbiddenException(
        'No authenticated user found — ensure JwtAuthGuard runs before RolesGuard',
      )
    }

    const userLevel = ROLE_HIERARCHY[user.role] ?? 0

    // The user passes if their hierarchy level is >= the MINIMUM required level
    // e.g. @Roles(ADMIN) requires level 2; SUPER_ADMIN (level 3) also passes
    const minimumRequired = Math.min(
      ...requiredRoles.map((r) => ROLE_HIERARCHY[r] ?? 0),
    )

    if (userLevel < minimumRequired) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: `Your role '${user.role}' does not have sufficient privileges`,
        requiredRoles,
        yourRole: user.role,
      })
    }

    return true
  }
}
