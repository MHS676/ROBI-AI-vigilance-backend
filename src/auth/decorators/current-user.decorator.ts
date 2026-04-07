import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { RequestUser } from '../interfaces/jwt-payload.interface'

/**
 * Extracts the authenticated user from the request object.
 * Must be used on routes protected by JwtAuthGuard.
 *
 * Usage:
 *   @Get('profile')
 *   @UseGuards(JwtAuthGuard)
 *   getProfile(@CurrentUser() user: RequestUser) { ... }
 *
 * Optionally extract a single field:
 *   @CurrentUser('role') role: Role
 */
export const CurrentUser = createParamDecorator(
  (field: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest()
    const user: RequestUser = request.user
    return field ? user?.[field] : user
  },
)
