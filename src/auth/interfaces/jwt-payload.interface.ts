import { Role } from '@prisma/client'

/**
 * Shape of the JWT payload stored inside every token issued by Falcon Security.
 *
 * sub      → User.id (CUID)
 * email    → User.email (unique)
 * role     → SUPER_ADMIN | ADMIN | AGENT
 * centerId → null for SUPER_ADMIN (global scope)
 *            string for ADMIN / AGENT (center-scoped)
 * iat / exp are added automatically by @nestjs/jwt
 */
export interface JwtPayload {
  sub: string
  email: string
  role: Role
  centerId: string | null
  iat?: number
  exp?: number
}

/**
 * The user object attached to every authenticated request.
 * Returned by JwtStrategy.validate() and injected via @CurrentUser().
 */
export interface RequestUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: Role
  centerId: string | null
  isActive: boolean
}
