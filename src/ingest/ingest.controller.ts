import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { IsString, IsNumber, IsArray, IsOptional, IsNotEmpty } from 'class-validator'
import { ConfigService } from '@nestjs/config'
import { EventsGateway } from '../events/events.gateway'
import { PrismaService } from '../prisma/prisma.service'
import {
  WS_EVENTS,
  AI_EVENT_SEVERITY,
  AlertSeverity,
} from '../mqtt/mqtt.constants'

// ─── DTO ─────────────────────────────────────────────────────────────────────
class IngestAlertDto {
  @IsString() @IsNotEmpty() center_id: string
  @IsString() @IsNotEmpty() camera_id: string
  @IsString() @IsOptional() table_id?: string
  @IsString() @IsNotEmpty() anomaly_type: string
  @IsString() @IsNotEmpty() severity: string
  @IsString() @IsNotEmpty() primary_event: string
  @IsArray() detections: Record<string, unknown>[]
  @IsNumber() timestamp: number
  @IsString() @IsOptional() source?: string
}

/**
 * IngestController
 *
 * Service-to-service endpoint.  Only the Python AI microservice calls this.
 * Protected by a shared secret in the X-Service-Key header.
 *
 * On receipt it immediately emits a WebSocket event to:
 *   - room:super_admin
 *   - room:center:{centerId}
 *
 * This way the AI service doesn't need to speak MQTT — it just POSTs here.
 */
@ApiTags('Ingest (service-to-service)')
@Controller('ingest')
export class IngestController {
  private readonly logger = new Logger(IngestController.name)

  constructor(
    private readonly events: EventsGateway,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post('ai-alert')
  @ApiOperation({
    summary: '🤖 Receive AI anomaly alert from the Python edge worker',
    description:
      'Called by the Falcon AI Microservice (FastAPI).  ' +
      'Protected by X-Service-Key header.  ' +
      'Emits a WebSocket event to SUPER_ADMIN + center-specific rooms.',
  })
  @ApiResponse({ status: 201, description: 'Alert received and broadcast' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-Service-Key' })
  async receiveAiAlert(
    @Body() dto: IngestAlertDto,
    @Headers('x-service-key') serviceKey: string,
  ) {
    // ── Auth — shared secret between NestJS and the AI service ───────────────
    const expected = this.config.get<string>('NESTJS_SERVICE_KEY') ?? ''
    if (!expected || serviceKey !== expected) {
      this.logger.warn(
        `❌ /ingest/ai-alert — invalid X-Service-Key (centerId=${dto.center_id})`,
      )
      throw new UnauthorizedException('Invalid service key')
    }

    // ── Resolve center name ───────────────────────────────────────────────────
    const center = await this.prisma.center.findUnique({
      where: { id: dto.center_id },
      select: { name: true, code: true },
    })

    const centerName = center ? `${center.name} (${center.code})` : dto.center_id

    // ── Map severity ──────────────────────────────────────────────────────────
    const severity = (dto.severity as AlertSeverity) ?? 'HIGH'

    // ── Pick the correct WS event name ────────────────────────────────────────
    const wsEventMap: Record<string, string> = {
      WEAPON_DETECTED: WS_EVENTS.FALL_DETECTED,     // reuse CRITICAL channel
      FALL_DETECTED: WS_EVENTS.FALL_DETECTED,
      FIGHT_DETECTED: WS_EVENTS.AGGRESSION_DETECTED,
      FIRE_DETECTED: WS_EVENTS.AI_RESULTS_UPDATE,
    }
    const wsEvent = wsEventMap[dto.anomaly_type] ?? WS_EVENTS.AI_RESULTS_UPDATE

    // ── Build envelope + broadcast ────────────────────────────────────────────
    const envelope = this.events.buildEnvelope(
      dto.center_id,
      centerName,
      severity,
      {
        source: dto.source ?? 'ai-service',
        cameraId: dto.camera_id,
        tableId: dto.table_id,
        anomalyType: dto.anomaly_type,
        primaryEvent: dto.primary_event,
        detections: dto.detections,
        timestamp: dto.timestamp,
      },
    )

    this.events.emitToCenterAndSuperAdmin(dto.center_id, wsEvent, envelope)

    this.logger.log(
      `🚨 AI alert broadcast  center=${centerName}  ` +
        `anomaly=${dto.anomaly_type}  severity=${severity}  ` +
        `detections=${dto.detections.length}  source=${dto.source ?? 'ai-service'}`,
    )

    return {
      message: 'Alert received and broadcast',
      centerId: dto.center_id,
      wsEvent,
      severity,
    }
  }
}
