import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken'

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Override canActivate to give clearer error messages before
   * Passport's internal handling takes over.
   */
  canActivate(context: ExecutionContext) {
    return super.canActivate(context)
  }

  /**
   * Called by Passport after validation.
   * err   → thrown by JwtStrategy.validate()
   * user  → value returned by JwtStrategy.validate(), or false if denied
   * info  → jsonwebtoken error (TokenExpiredError, JsonWebTokenError, etc.)
   */
  handleRequest<TUser = any>(
    err: any,
    user: TUser | false,
    info: any,
  ): TUser {
    // Strategy validation threw (e.g. user deactivated)
    if (err) {
      throw err instanceof UnauthorizedException
        ? err
        : new UnauthorizedException(err.message ?? 'Authentication error')
    }

    // No token supplied at all
    if (!user && info?.name === 'JsonWebTokenError') {
      throw new UnauthorizedException('Malformed or missing token')
    }

    // Token is syntactically valid but expired
    if (!user && info instanceof TokenExpiredError) {
      throw new UnauthorizedException(
        'Token has expired — please log in again',
      )
    }

    // No token in Authorization header
    if (!user && !info) {
      throw new UnauthorizedException(
        'No token provided — add Authorization: Bearer <token>',
      )
    }

    if (!user) {
      throw new UnauthorizedException('Authentication failed')
    }

    return user
  }
}
