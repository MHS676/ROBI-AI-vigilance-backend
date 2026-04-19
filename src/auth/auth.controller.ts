import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  HttpStatus as HTTP,
} from '@nestjs/common'
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger'
import { Role } from '@prisma/client'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { RolesGuard } from './guards/roles.guard'
import { ApiKeyGuard } from './guards/api-key.guard'
import { Roles } from './decorators/roles.decorator'
import { CurrentUser } from './decorators/current-user.decorator'
import { RequestUser } from './interfaces/jwt-payload.interface'
import { PunchDto } from './dto/punch.dto'

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ─────────────────────────────────────────────────────────────
  // POST /auth/login
  // ─────────────────────────────────────────────────────────────
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login',
    description:
      'Authenticate with email + password. Returns a signed JWT.\n\n' +
      '**JWT payload includes:** `sub` (userId), `email`, `role`, `centerId`\n\n' +
      '- `SUPER_ADMIN` → `centerId: null` (global access)\n' +
      '- `ADMIN` / `AGENT` → `centerId: "<branchId>"` (center-scoped)',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful — returns JWT and safe user object',
    schema: {
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        token_type: 'Bearer',
        expires_in: '7d',
        user: {
          id: 'clxyz...',
          email: 'admin@falconsecurity.ng',
          firstName: 'Lagos',
          lastName: 'Admin',
          role: 'ADMIN',
          centerId: 'clcenter123',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  // ─────────────────────────────────────────────────────────────
  // POST /auth/register
  // Requires JWT — only SUPER_ADMIN or ADMIN can create accounts.
  // ADMIN can only create AGENT accounts within their own center.
  // SUPER_ADMIN can create any role in any center.
  // ─────────────────────────────────────────────────────────────
  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register a new user',
    description:
      '**Requires authentication.**\n\n' +
      '| Caller role  | Can create roles       | centerId rule                     |\n' +
      '|-------------|------------------------|-----------------------------------|\n' +
      '| SUPER_ADMIN | SUPER_ADMIN, ADMIN, AGENT | Any centerId or null           |\n' +
      '| ADMIN       | AGENT only             | Forced to caller\'s own centerId   |',
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({
    status: 201,
    description: 'User created — returns JWT and user object',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  register(@Body() dto: RegisterDto, @CurrentUser() caller: RequestUser) {
    return this.authService.register(dto, caller)
  }

  // ─────────────────────────────────────────────────────────────
  // GET /auth/me
  // ─────────────────────────────────────────────────────────────
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Whoami — get the currently authenticated user',
    description:
      'Returns the live database record of the user who owns the supplied JWT.\n\n' +
      'Useful to confirm role, centerId, and active status without decoding the token client-side.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current user object',
    schema: {
      example: {
        id: 'clxyz...',
        email: 'superadmin@falconsecurity.ng',
        firstName: 'Super',
        lastName: 'Admin',
        role: 'SUPER_ADMIN',
        centerId: null,
        isActive: true,
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing, expired, or invalid token' })
  me(@CurrentUser() user: RequestUser) {
    return user
  }

  // ───────────────────────────────────────────────────────────────
  // POST /auth/punch-in
  // Called exclusively by the gate_attendance AI service.
  // Requires x-gate-api-key header (GATE_API_KEY env var).
  // ───────────────────────────────────────────────────────────────
  @Post('punch-in')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Gate punch-in — agent recognised at Camera_Entry',
    description:
      'Called by the gate_attendance AI service with `x-gate-api-key` header.\n\n' +
      'Creates (or returns existing) Attendance record for the agent today.',
  })
  @ApiBody({ type: PunchDto })
  @ApiResponse({ status: 200, description: 'Punched in or already active session returned' })
  @ApiResponse({ status: 401, description: 'Missing / invalid API key' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  punchIn(@Body() dto: PunchDto) {
    return this.authService.punchIn(dto)
  }

  // ───────────────────────────────────────────────────────────────
  // POST /auth/punch-out
  // ───────────────────────────────────────────────────────────────
  @Post('punch-out')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Gate punch-out — agent recognised at Camera_Exit',
    description:
      'Called by the gate_attendance AI service with `x-gate-api-key` header.\n\n' +
      'Closes the most recent open Attendance record (sets exitTime).',
  })
  @ApiBody({ type: PunchDto })
  @ApiResponse({ status: 200, description: 'Session closed successfully' })
  @ApiResponse({ status: 400, description: 'No open session found for this agent' })
  @ApiResponse({ status: 401, description: 'Missing / invalid API key' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  punchOut(@Body() dto: PunchDto) {
    return this.authService.punchOut(dto)
  }
}
