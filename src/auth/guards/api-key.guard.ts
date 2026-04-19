import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'

/**
 * ApiKeyGuard — validates the `x-gate-api-key` header sent by the
 * gate_attendance AI service when calling punch-in / punch-out endpoints.
 *
 * Set GATE_API_KEY in .env.  The Python service must include:
 *   headers: { "x-gate-api-key": "<GATE_API_KEY>" }
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>()
    const key = req.headers['x-gate-api-key'] as string | undefined

    const expected = this.config.get<string>('GATE_API_KEY')
    if (!expected) {
      throw new UnauthorizedException('GATE_API_KEY is not configured on the server')
    }
    if (!key || key !== expected) {
      throw new UnauthorizedException('Invalid or missing x-gate-api-key header')
    }
    return true
  }
}
