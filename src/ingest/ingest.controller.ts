import { Controller, Post, Patch, Body, Headers, UnauthorizedException, Logger, Get } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { IsString, IsNumber, IsArray, IsOptional, IsNotEmpty, IsBoolean } from 'class-validator'
import { ConfigService } from '@nestjs/config'
import { EventsGateway } from '../events/events.gateway'
import { PrismaService } from '../prisma/prisma.service'
import {
  WS_EVENTS,
  AI_EVENT_SEVERITY,
  AlertSeverity,
} from '../mqtt/mqtt.constants'
import { ANOMALY_TO_FEATURE } from '../cameras/dto/update-ai-features.dto'

// ─── DTOs ─────────────────────────────────────────────────────────────────────
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
  /** Confidence score 0–100 from the AI model */
  @IsNumber() @IsOptional() confidence?: number
  /** Which sensor tech triggered this alert: CCTV | WIFI | AUDIO */
  @IsString() @IsOptional() tech?: string
  /** Extra metadata (agent monitoring events only) */
  metadata?: Record<string, unknown>
}

class AgentActivityDto {
  @IsString() @IsNotEmpty() table_id: string
  @IsString() @IsNotEmpty() user_id: string
  @IsNumber() @IsOptional() active_minutes?: number
  @IsNumber() @IsOptional() gossip_count?: number
  /** Normalised sentiment score in [-1, +1]; SHI = (score+1)/2*100 */
  @IsNumber() @IsOptional() avg_sentiment_score?: number
}

class ResourceSaverDto {
  @IsBoolean() enabled: boolean
  /** Optional centerId — if omitted, applies globally */
  @IsString() @IsOptional() centerId?: string
}

class HybridSourceDto {
  @IsNumber() objectiveId: number
  @IsString() primarySource: string
  @IsBoolean() preferLowCompute: boolean
  @IsString() @IsOptional() centerId?: string
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
 *
 * Additional endpoints:
 *   PATCH /ingest/resource-saver  — toggle GPU Resource Saver Mode
 *   PATCH /ingest/hybrid-source   — change hybrid source priority
 *   GET   /ingest/resource-saver  — read current mode state
 */
@ApiTags('Ingest (service-to-service)')
@Controller('ingest')
export class IngestController {
  private readonly logger = new Logger(IngestController.name)

  /**
   * In-memory Resource Saver Mode state.
   * Key: centerId | 'global'
   * Value: true = resource saver ON (high-compute CCTV skipped unless WiFi/Audio triggered first)
   */
  private resourceSaverMode: Record<string, boolean> = {}

  /**
   * Hybrid source priority per objective (in-memory, per center).
   * Key: `${centerId}:${objectiveId}` | `global:${objectiveId}`
   */
  private hybridSources: Record<string, { primarySource: string; preferLowCompute: boolean }> = {}

  /** Track which centers have a recent WiFi/Audio anomaly (for GPU gate) */
  private recentSensorAnomalies = new Map<string, number>() // centerId → expiry epoch ms

  constructor(
    private readonly events: EventsGateway,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ── Resource Saver Mode endpoints ─────────────────────────────────────────

  @Get('resource-saver')
  @ApiOperation({ summary: 'Get current Resource Saver Mode state' })
  getResourceSaverMode() {
    return { resourceSaverMode: this.resourceSaverMode, hybridSources: this.hybridSources }
  }

  @Patch('resource-saver')
  @ApiOperation({
    summary: '⚡ Toggle GPU Resource Saver Mode',
    description:
      'When enabled, high-compute CCTV models (face recognition, weapon detection) ' +
      'only activate AFTER WiFi Sees or Audio AI detects an initial anomaly. ' +
      'Drastically reduces GPU VRAM usage during quiet periods.',
  })
  setResourceSaverMode(
    @Body() dto: ResourceSaverDto,
    @Headers('x-service-key') serviceKey: string,
  ) {
    const expected = this.config.get<string>('NESTJS_SERVICE_KEY') ?? ''
    if (!expected || serviceKey !== expected) throw new UnauthorizedException('Invalid service key')

    const key = dto.centerId ?? 'global'
    this.resourceSaverMode[key] = dto.enabled
    this.logger.log(`⚡ Resource Saver Mode ${dto.enabled ? 'ON' : 'OFF'} — ${key}`)

    // Broadcast to all super admins
    const rsEnvelope = this.events.buildEnvelope(
      dto.centerId ?? 'global',
      dto.centerId ?? 'global',
      'INFO',
      { centerId: dto.centerId ?? 'global', enabled: dto.enabled, updatedAt: new Date().toISOString() },
    )
    this.events.emitToCenterAndSuperAdmin(
      dto.centerId ?? 'global',
      WS_EVENTS.RESOURCE_SAVER_CHANGED,
      rsEnvelope,
    )
    return { message: 'Resource Saver Mode updated', key, enabled: dto.enabled }
  }

  @Patch('hybrid-source')
  @ApiOperation({ summary: '🔀 Update hybrid source priority for an objective' })
  setHybridSource(
    @Body() dto: HybridSourceDto,
    @Headers('x-service-key') serviceKey: string,
  ) {
    const expected = this.config.get<string>('NESTJS_SERVICE_KEY') ?? ''
    if (!expected || serviceKey !== expected) throw new UnauthorizedException('Invalid service key')

    const key = `${dto.centerId ?? 'global'}:${dto.objectiveId}`
    this.hybridSources[key] = { primarySource: dto.primarySource, preferLowCompute: dto.preferLowCompute }
    this.logger.log(`🔀 HybridSource updated — ${key} → ${dto.primarySource}`)

    const hsEnvelope = this.events.buildEnvelope(
      dto.centerId ?? 'global',
      dto.centerId ?? 'global',
      'INFO',
      { ...dto, updatedAt: new Date().toISOString() },
    )
    this.events.emitToCenterAndSuperAdmin(
      dto.centerId ?? 'global',
      WS_EVENTS.HYBRID_SOURCE_CHANGED,
      hsEnvelope,
    )
    return { message: 'Hybrid source updated', key }
  }

  /**
   * Called by WiFi Sees / Audio AI to signal an anomaly detected via low-compute sensors.
   * This primes the GPU gate so the next CCTV alert within 30s will be allowed through
   * even in Resource Saver Mode.
   */
  @Post('sensor-anomaly')
  @ApiOperation({
    summary: '📡 Register a WiFi/Audio anomaly (arms GPU gate for 30 s)',
  })
  registerSensorAnomaly(
    @Body() body: { center_id: string; tech: string; objectiveId?: number; confidence?: number },
    @Headers('x-service-key') serviceKey: string,
  ) {
    const expected = this.config.get<string>('NESTJS_SERVICE_KEY') ?? ''
    if (!expected || serviceKey !== expected) throw new UnauthorizedException('Invalid service key')

    const expiry = Date.now() + 30_000
    this.recentSensorAnomalies.set(body.center_id, expiry)
    this.logger.debug(`📡 Sensor anomaly arm — center=${body.center_id} tech=${body.tech} expiry=+30s`)
    return { armed: true, expiresAt: new Date(expiry).toISOString() }
  }

  @Post('ai-alert')
  @ApiOperation({
    summary: '🤖 Receive AI anomaly alert from the Python edge worker',
    description:
      'Called by the Falcon AI Microservice (FastAPI).  ' +
      'Protected by X-Service-Key header.  ' +
      'Emits a WebSocket event to SUPER_ADMIN + center-specific rooms.  ' +
      'Respects Resource Saver Mode GPU gate and per-camera AI feature toggles.',
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
      this.logger.warn(`❌ /ingest/ai-alert — invalid X-Service-Key (centerId=${dto.center_id})`)
      throw new UnauthorizedException('Invalid service key')
    }

    // ── Resource Saver Mode GPU gate ─────────────────────────────────────────
    // If high-compute CCTV detection + resource saver is ON for this center
    // and no recent WiFi/Audio anomaly has armed the gate → suppress
    const rsGlobal = this.resourceSaverMode['global'] ?? false
    const rsCenter = this.resourceSaverMode[dto.center_id] ?? rsGlobal
    const HIGH_COMPUTE_ANOMALIES = ['WEAPON_DETECTED', 'FIGHT_DETECTED', 'FIRE_DETECTED']
    if (rsCenter && HIGH_COMPUTE_ANOMALIES.includes(dto.anomaly_type)) {
      const armExpiry = this.recentSensorAnomalies.get(dto.center_id) ?? 0
      if (Date.now() > armExpiry) {
        this.logger.debug(
          `⚡ Resource Saver suppressed high-compute alert — center=${dto.center_id} anomaly=${dto.anomaly_type}`,
        )
        return {
          message: 'Suppressed by Resource Saver Mode — no prior sensor anomaly',
          centerId: dto.center_id,
          anomalyType: dto.anomaly_type,
        }
      }
    }

    // ── AI Feature gate — skip broadcast if feature is disabled for this camera
    const requiredFeature = ANOMALY_TO_FEATURE[dto.anomaly_type]
    if (requiredFeature) {
      const cam = await this.prisma.camera.findUnique({
        where:  { id: dto.camera_id },
        select: { aiFeatures: true },
      })
      const enabled = (cam?.aiFeatures ?? []) as string[]
      if (!enabled.includes(requiredFeature)) {
        this.logger.debug(
          `🔇 Alert suppressed — feature ${requiredFeature} disabled for camera ${dto.camera_id}`,
        )
        return {
          message: 'Alert suppressed — feature disabled for this camera',
          centerId: dto.center_id,
          disabledFeature: requiredFeature,
        }
      }
    }

    // ── Resolve center name ───────────────────────────────────────────────────
    const center = await this.prisma.center.findUnique({
      where:  { id: dto.center_id },
      select: { name: true, code: true },
    })
    const centerName = center ? `${center.name} (${center.code})` : dto.center_id

    // ── Map severity ──────────────────────────────────────────────────────────
    const severity = (dto.severity as AlertSeverity) ?? 'HIGH'

    // ── Map anomaly → WS event name ───────────────────────────────────────────
    const wsEventMap: Record<string, string> = {
      WEAPON_DETECTED:  WS_EVENTS.WEAPON_DETECTED,
      FIGHT_DETECTED:   WS_EVENTS.AGGRESSION_DETECTED,
      FALL_DETECTED:    WS_EVENTS.FALL_DETECTED,
      FIRE_DETECTED:    WS_EVENTS.FIRE_DETECTED,
      CROWD_DETECTED:   WS_EVENTS.CROWD_DETECTED,
      SICK_DETECTED:    WS_EVENTS.SICK_DETECTED,
      IDLE_AGENT:       WS_EVENTS.IDLE_AGENT,
      GOSSIP_DETECTED:  WS_EVENTS.GOSSIP_DETECTED,
      LONG_SERVICE:     WS_EVENTS.LONG_SERVICE,
      LONG_STAY:        WS_EVENTS.LONG_STAY,
      VANDALISM:        WS_EVENTS.VANDALISM_DETECTED,
      IRATE_CUSTOMER:   WS_EVENTS.IRATE_CUSTOMER,
    }
    const wsEvent = wsEventMap[dto.anomaly_type] ?? WS_EVENTS.AI_RESULTS_UPDATE

    // ── Build envelope + broadcast ────────────────────────────────────────────
    const envelope = this.events.buildEnvelope(
      dto.center_id,
      centerName,
      severity,
      {
        source:       dto.source ?? 'ai-service',
        tech:         dto.tech   ?? 'CCTV',
        confidence:   dto.confidence ?? null,
        cameraId:     dto.camera_id,
        tableId:      dto.table_id,
        anomalyType:  dto.anomaly_type,
        primaryEvent: dto.primary_event,
        detections:   dto.detections,
        timestamp:    dto.timestamp,
      },
    )

    this.events.emitToCenterAndSuperAdmin(dto.center_id, wsEvent, envelope)

    this.logger.log(
      `🚨 AI alert broadcast  center=${centerName}  ` +
        `anomaly=${dto.anomaly_type}  severity=${severity}  ` +
        `confidence=${dto.confidence ?? '—'}  tech=${dto.tech ?? 'CCTV'}  ` +
        `detections=${dto.detections.length}`,
    )

    return {
      message: 'Alert received and broadcast',
      centerId: dto.center_id,
      wsEvent,
      severity,
      confidence: dto.confidence ?? null,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PATCH /ingest/agent-activity
  // Called by the Python agent_monitor every 60 s to persist running metrics
  // (active_minutes, gossip_count, avg_sentiment_score) into AgentActivity.
  // ───────────────────────────────────────────────────────────────────────────
  @Patch('agent-activity')
  @ApiOperation({
    summary: '📊 Upsert AgentActivity record from the monitoring engine',
    description:
      'Called by the Python `agent_monitor` every 60 s.  ' +
      'Finds the most recent AgentActivity row for (userId, tableId) today ' +
      'and updates it, or creates a new one if none exists.',
  })
  @ApiResponse({ status: 200, description: 'Activity record updated' })
  @ApiResponse({ status: 401, description: 'Invalid service key' })
  async upsertAgentActivity(
    @Body() dto: AgentActivityDto,
    @Headers('x-service-key') serviceKey: string,
  ) {
    const expected = this.config.get<string>('NESTJS_SERVICE_KEY') ?? ''
    if (!expected || serviceKey !== expected) throw new UnauthorizedException('Invalid service key')

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // Find the most recent record for today (createdAt >= midnight)
    const existing = await this.prisma.agentActivity.findFirst({
      where: {
        userId:  dto.user_id,
        tableId: dto.table_id,
        createdAt: { gte: todayStart },
      },
      orderBy: { createdAt: 'desc' },
    })

    const data = {
      ...(dto.active_minutes      != null && { activeMinutes:      dto.active_minutes }),
      ...(dto.gossip_count        != null && { gossipCount:        dto.gossip_count }),
      ...(dto.avg_sentiment_score != null && { avgSentimentScore:  dto.avg_sentiment_score }),
      lastSeen: new Date(),
    }

    let record
    if (existing) {
      record = await this.prisma.agentActivity.update({
        where: { id: existing.id },
        data,
      })
    } else {
      record = await this.prisma.agentActivity.create({
        data: {
          userId:  dto.user_id,
          tableId: dto.table_id,
          ...data,
        },
      })
    }

    this.logger.debug(
      `📊 AgentActivity upserted — user=${dto.user_id} table=${dto.table_id} ` +
      `active=${record.activeMinutes.toFixed(1)}m gossip=${record.gossipCount} ` +
      `shi=${((record.avgSentimentScore + 1) / 2 * 100).toFixed(1)}`,
    )

    return { message: 'Activity updated', record }
  }
}
