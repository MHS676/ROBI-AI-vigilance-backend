import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger'
import { Role } from '@prisma/client'
import { AlertsService, AlertsQuery } from './alerts.service'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { CurrentUser } from '../auth/decorators/current-user.decorator'
import { RequestUser } from '../auth/interfaces/jwt-payload.interface'

// ─────────────────────────────────────────────────────────────────────────────
// AlertsController
//
// Exposes the persisted Alert records for the Historical Evidence Dashboard.
//
// Routes:
//   GET /alerts          — paginated list with optional filters
//   GET /alerts/:id      — single alert by id
//
// Filter params (all optional):
//   centerId, type, severity, dateFrom (ISO), dateTo (ISO), page, limit
//
// Access:
//   SUPER_ADMIN → all centers (centerId filter is optional)
//   ADMIN       → own center only (centerId param is ignored)
//   AGENT       → not permitted
// ─────────────────────────────────────────────────────────────────────────────

@ApiTags('Alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'List historical alerts with optional filters and pagination' })
  @ApiQuery({ name: 'centerId',  required: false, description: 'Filter by center (SUPER_ADMIN only)' })
  @ApiQuery({ name: 'type',      required: false, description: 'Filter by alert type (e.g. WEAPON, FALL)' })
  @ApiQuery({ name: 'severity',  required: false, description: 'Filter by severity (CRITICAL, HIGH, MEDIUM, LOW, INFO)' })
  @ApiQuery({ name: 'dateFrom',  required: false, description: 'Inclusive start datetime (ISO 8601)' })
  @ApiQuery({ name: 'dateTo',    required: false, description: 'Inclusive end datetime (ISO 8601)' })
  @ApiQuery({ name: 'page',      required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit',     required: false, description: 'Items per page (default: 50, max: 100)' })
  findAll(
    @Query() query: AlertsQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.alertsService.findAll(query, user)
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Get a single alert by id (includes evidence imageUrl)' })
  findOne(@Param('id') id: string) {
    return this.alertsService.findOne(id)
  }
}
