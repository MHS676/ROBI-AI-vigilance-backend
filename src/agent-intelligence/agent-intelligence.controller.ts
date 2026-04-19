import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger'
import { Role } from '@prisma/client'
import { AgentIntelligenceService } from './agent-intelligence.service'
import {
  UpsertActivityDto,
  RecordAttendanceDto,
} from './dto/agent-intelligence.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { ApiKeyGuard } from '../auth/guards/api-key.guard'

/**
 * AgentIntelligenceController
 *
 * Manages Agent Intelligence data — desk-presence activity, attendance records,
 * and aggregated profile information.
 *
 * Access patterns:
 *   POST /agent/activity     — AI service (x-gate-api-key) or SUPER_ADMIN / ADMIN
 *   POST /agent/attendance   — AI gate service (x-gate-api-key)
 *   GET  /agent/profile/:id  — SUPER_ADMIN / ADMIN (JWT)
 *
 * Each mutating call also broadcasts a real-time update via EventsGateway:
 *   - AGENT_ACTIVITY_UPDATED  → SUPER_ADMIN + center room
 *   - AGENT_ATTENDANCE_UPDATED → SUPER_ADMIN + center room
 *   - AGENT_PROFILE_UPDATED   → SUPER_ADMIN room only
 */
@ApiTags('Agent Intelligence')
@Controller('agent')
export class AgentIntelligenceController {
  private readonly logger = new Logger(AgentIntelligenceController.name)

  constructor(private readonly agentIntelligence: AgentIntelligenceService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // POST /agent/activity
  //
  // Called by the AI inference pipeline every ~60 seconds to push updated
  // desk-presence metrics (active minutes, gossip events, SHI score).
  // Also callable by SUPER_ADMIN / ADMIN for manual overrides.
  //
  // Guards: ApiKeyGuard (AI service) OR JwtAuthGuard + SUPER_ADMIN/ADMIN role
  // ─────────────────────────────────────────────────────────────────────────
  @Post('activity')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '📊 Upsert agent desk-presence activity metrics',
    description:
      'Merges the provided activity metrics into today's AgentActivity record. ' +
      'Creates a new record if none exists for today. ' +
      'Broadcasts AGENT_ACTIVITY_UPDATED to SUPER_ADMIN + center room. ' +
      'Protected by x-gate-api-key header (AI service).',
  })
  @ApiResponse({
    status: 200,
    description: 'Activity upserted successfully — includes time-in-chair breakdown + SHI',
  })
  @ApiResponse({ status: 404, description: 'User or Table not found' })
  upsertActivity(@Body() dto: UpsertActivityDto) {
    return this.agentIntelligence.upsertActivity(dto)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POST /agent/attendance
  //
  // Called by the gate_attendance Python service to punch an agent in or out.
  // Idempotent on punch-in — returns the existing open session if found.
  //
  // Guards: ApiKeyGuard (gate AI service)
  // ─────────────────────────────────────────────────────────────────────────
  @Post('attendance')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '🚪 Record agent punch-in / punch-out attendance event',
    description:
      'punch_in: Creates a new Attendance record. Idempotent — returns the existing ' +
      'open session if the agent already punched in today. ' +
      'punch_out: Closes the most recent open session, recording exitTime and shift duration. ' +
      'Broadcasts AGENT_ATTENDANCE_UPDATED to SUPER_ADMIN + center room.',
  })
  @ApiResponse({
    status: 200,
    description: 'Attendance record created / updated — includes totalShiftMinutes on punch-out',
  })
  @ApiResponse({ status: 400, description: 'Punch-out with no open session' })
  @ApiResponse({ status: 404, description: 'User or Center not found' })
  recordAttendance(@Body() dto: RecordAttendanceDto) {
    return this.agentIntelligence.recordAttendance(dto)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /agent/profile/:id
  //
  // Returns a fully-aggregated Agent Intelligence profile.  Includes:
  //   • Today's attendance session + time-in-chair breakdown
  //   • Today's activity metrics (active mins, gossip count, SHI)
  //   • Last 30 days of daily summaries
  //   • Lifetime totals (shifts, active mins, avg SHI, avg time-in-chair %)
  //
  // Broadcasts AGENT_PROFILE_UPDATED to the SUPER_ADMIN room on each call.
  //
  // Guards: JwtAuthGuard + SUPER_ADMIN or ADMIN role
  // ─────────────────────────────────────────────────────────────────────────
  @Get('profile/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '🧠 Get aggregated Agent Intelligence profile',
    description:
      'Returns a single JSON object aggregating all attendance, desk-presence, ' +
      'gossip, and expression scores for an agent. ' +
      'Includes a time-in-chair breakdown for today's shift. ' +
      'Also broadcasts AGENT_PROFILE_UPDATED to the SUPER_ADMIN WebSocket room.',
  })
  @ApiParam({ name: 'id', description: 'CUID of the agent (User.id)' })
  @ApiResponse({
    status: 200,
    description: 'Full agent profile with attendance, activity, SHI history, and lifetime totals',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  getProfile(@Param('id') id: string) {
    return this.agentIntelligence.getProfile(id)
  }
}
