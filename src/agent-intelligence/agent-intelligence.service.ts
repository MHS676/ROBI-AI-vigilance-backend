import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { EventsGateway } from '../events/events.gateway'
import { WS_EVENTS, ROOM_SUPER_ADMIN, AlertSeverity } from '../mqtt/mqtt.constants'
import {
  UpsertActivityDto,
  RecordAttendanceDto,
  AttendanceAction,
  AgentProfileResponse,
  DailyActivitySummary,
  AttendanceSummary,
  TimeInChairBreakdown,
} from './dto/agent-intelligence.dto'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default idle-alert window in minutes — must match ai-service config default */
const IDLE_ALERT_MINUTES = 10

/** How many days of history to return in GET /agent/profile/:id */
const HISTORY_DAYS = 30

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the UTC midnight of the current calendar day */
function todayStart(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/** Returns the UTC end-of-day (23:59:59.999) */
function todayEnd(): Date {
  const d = new Date()
  d.setUTCHours(23, 59, 59, 999)
  return d
}

/** ISO date string (YYYY-MM-DD) from a Date object */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Convert avgSentimentScore [-1,+1] to SHI [0,100] */
function sentimentToShi(score: number): number {
  return Math.round(((score + 1) / 2) * 100 * 10) / 10
}

/** Compute shift duration in minutes between two timestamps */
function shiftMinutes(entry: Date, exit: Date | null): number | null {
  if (!exit) return null
  return Math.round((exit.getTime() - entry.getTime()) / 60_000)
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentIntelligenceService
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AgentIntelligenceService {
  private readonly logger = new Logger(AgentIntelligenceService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // POST /agent/activity
  // Upserts today's AgentActivity row and broadcasts the update.
  // ══════════════════════════════════════════════════════════════════════════

  async upsertActivity(dto: UpsertActivityDto) {
    const today = todayStart()

    // ── Resolve user + table to get centerId for broadcasting ────────────────
    const [user, table] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          centerId: true,
          center: { select: { name: true } },
        },
      }),
      this.prisma.table.findUnique({
        where: { id: dto.tableId },
        select: { id: true, tableNumber: true },
      }),
    ])

    if (!user) throw new NotFoundException(`User ${dto.userId} not found`)
    if (!table) throw new NotFoundException(`Table ${dto.tableId} not found`)

    // ── Find existing AgentActivity for today ────────────────────────────────
    const existing = await this.prisma.agentActivity.findFirst({
      where: {
        userId: dto.userId,
        tableId: dto.tableId,
        createdAt: { gte: today },
      },
    })

    const updated = existing
      ? await this.prisma.agentActivity.update({
          where: { id: existing.id },
          data: {
            ...(dto.activeMinutes !== undefined && { activeMinutes: dto.activeMinutes }),
            ...(dto.gossipCount !== undefined && { gossipCount: dto.gossipCount }),
            ...(dto.avgSentimentScore !== undefined && {
              avgSentimentScore: dto.avgSentimentScore,
            }),
            lastSeen: new Date(),
          },
        })
      : await this.prisma.agentActivity.create({
          data: {
            userId: dto.userId,
            tableId: dto.tableId,
            activeMinutes: dto.activeMinutes ?? 0,
            gossipCount: dto.gossipCount ?? 0,
            avgSentimentScore: dto.avgSentimentScore ?? 0,
            lastSeen: new Date(),
          },
        })

    // ── Compute time-in-chair for broadcast payload ───────────────────────────
    const todayAttendance = await this.getTodayAttendance(dto.userId)
    const timeInChair = todayAttendance
      ? this.calcTimeInChair(todayAttendance, updated.activeMinutes, dto.idleAlertCount ?? 0)
      : null

    // ── Broadcast to SUPER_ADMIN + center room ───────────────────────────────
    const centerId = user.centerId ?? 'unknown'
    const payload = this.events.buildEnvelope(
      centerId,
      user.center?.name ?? centerId,
      'INFO' as AlertSeverity,
      {
        agentId: dto.userId,
        agentName: `${user.firstName} ${user.lastName}`,
        tableId: dto.tableId,
        tableNumber: table.tableNumber,
        activeMinutes: updated.activeMinutes,
        gossipCount: updated.gossipCount,
        avgSentimentScore: updated.avgSentimentScore,
        shi: sentimentToShi(updated.avgSentimentScore),
        timeInChair,
        lastSeen: updated.lastSeen.toISOString(),
      },
    )

    this.events.emitToCenterAndSuperAdmin(centerId, WS_EVENTS.AGENT_ACTIVITY_UPDATED, payload)

    this.logger.log(
      `📊 Activity upserted — agent: ${user.firstName} ${user.lastName} | ` +
        `active: ${updated.activeMinutes}min | SHI: ${sentimentToShi(updated.avgSentimentScore)}`,
    )

    return {
      activity: updated,
      timeInChair,
      shi: sentimentToShi(updated.avgSentimentScore),
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // POST /agent/attendance
  // Punch-in / punch-out — idempotent.
  // ══════════════════════════════════════════════════════════════════════════

  async recordAttendance(dto: RecordAttendanceDto) {
    // Validate user + center exist
    const [user, center] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { id: true, firstName: true, lastName: true, centerId: true },
      }),
      this.prisma.center.findUnique({
        where: { id: dto.centerId },
        select: { id: true, name: true },
      }),
    ])

    if (!user) throw new NotFoundException(`User ${dto.userId} not found`)
    if (!center) throw new NotFoundException(`Center ${dto.centerId} not found`)

    let record: Awaited<ReturnType<typeof this.prisma.attendance.create>>

    if (dto.action === AttendanceAction.PUNCH_IN) {
      // ── Idempotent: return existing open session if one exists today ─────────
      const openSession = await this.prisma.attendance.findFirst({
        where: {
          userId: dto.userId,
          entryTime: { gte: todayStart() },
          exitTime: null,
        },
        orderBy: { entryTime: 'desc' },
      })

      if (openSession) {
        this.logger.log(
          `ℹ️  Punch-in idempotent — agent ${dto.userId} already has open session ${openSession.id}`,
        )
        record = openSession
      } else {
        record = await this.prisma.attendance.create({
          data: {
            userId: dto.userId,
            centerId: dto.centerId,
            entryImage: dto.faceImage,
          },
        })
        this.logger.log(
          `✅ Punch-in — agent: ${user.firstName} ${user.lastName} | record: ${record.id}`,
        )
      }
    } else {
      // ── Punch-out: close the most recent open session ────────────────────────
      const openSession = await this.prisma.attendance.findFirst({
        where: { userId: dto.userId, exitTime: null },
        orderBy: { entryTime: 'desc' },
      })

      if (!openSession) {
        throw new BadRequestException(
          `No open punch-in session found for agent ${dto.userId}`,
        )
      }

      record = await this.prisma.attendance.update({
        where: { id: openSession.id },
        data: {
          exitTime: new Date(),
          exitImage: dto.faceImage,
        },
      })

      this.logger.log(
        `✅ Punch-out — agent: ${user.firstName} ${user.lastName} | ` +
          `shift: ${shiftMinutes(record.entryTime, record.exitTime!)} min`,
      )
    }

    // ── Broadcast ─────────────────────────────────────────────────────────────
    const centerId = dto.centerId
    const shiftMins = shiftMinutes(record.entryTime, record.exitTime ?? null)
    const payload = this.events.buildEnvelope(
      centerId,
      center.name,
      'INFO' as AlertSeverity,
      {
        agentId: dto.userId,
        agentName: `${user.firstName} ${user.lastName}`,
        action: dto.action,
        attendanceId: record.id,
        entryTime: record.entryTime.toISOString(),
        exitTime: record.exitTime?.toISOString() ?? null,
        totalShiftMinutes: shiftMins,
      },
    )

    this.events.emitToCenterAndSuperAdmin(centerId, WS_EVENTS.AGENT_ATTENDANCE_UPDATED, payload)

    return {
      attendance: record,
      action: dto.action,
      totalShiftMinutes: shiftMins,
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GET /agent/profile/:id
  // Aggregates full agent intelligence profile and broadcasts to SUPER_ADMIN.
  // ══════════════════════════════════════════════════════════════════════════

  async getProfile(userId: string): Promise<AgentProfileResponse> {
    // ── Load base user ────────────────────────────────────────────────────────
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        center: { select: { id: true, name: true } },
        assignedTable: { select: { id: true, tableNumber: true } },
      },
    })

    if (!user) throw new NotFoundException(`User ${userId} not found`)

    const today = todayStart()
    const historyFrom = new Date(today)
    historyFrom.setDate(historyFrom.getDate() - HISTORY_DAYS)

    // ── Parallel data fetch ───────────────────────────────────────────────────
    const [todayAttendanceRow, recentActivities, allAttendances] = await Promise.all([
      // Today's open or closed session
      this.prisma.attendance.findFirst({
        where: {
          userId,
          entryTime: { gte: today },
        },
        orderBy: { entryTime: 'desc' },
      }),

      // Last 30 days of AgentActivity rows
      this.prisma.agentActivity.findMany({
        where: {
          userId,
          createdAt: { gte: historyFrom },
        },
        orderBy: { createdAt: 'desc' },
      }),

      // All attendance records for lifetime totals
      this.prisma.attendance.findMany({
        where: { userId },
        select: { id: true, entryTime: true, exitTime: true },
      }),
    ])

    // ── Today's activity row (most recent from today) ─────────────────────────
    const todayActivityRow = recentActivities.find(
      (a) => a.createdAt >= today,
    ) ?? null

    // ── Time-in-chair breakdown for today ─────────────────────────────────────
    const timeInChair: TimeInChairBreakdown | null = todayAttendanceRow && todayActivityRow
      ? this.calcTimeInChair(todayAttendanceRow, todayActivityRow.activeMinutes, 0)
      : null

    // ── Build daily summaries ─────────────────────────────────────────────────
    // Group activities by date (YYYY-MM-DD) and sum/avg
    const dailyMap = new Map<string, DailyActivitySummary>()
    for (const row of recentActivities) {
      const date = isoDate(row.createdAt)
      const existing = dailyMap.get(date)
      if (!existing) {
        dailyMap.set(date, {
          date,
          activeMinutes: row.activeMinutes,
          gossipCount: row.gossipCount,
          avgSentimentScore: row.avgSentimentScore,
          shi: sentimentToShi(row.avgSentimentScore),
          idleAlertCount: 0,
        })
      } else {
        // Multiple rows on same day — merge
        existing.activeMinutes += row.activeMinutes
        existing.gossipCount += row.gossipCount
        existing.avgSentimentScore = (existing.avgSentimentScore + row.avgSentimentScore) / 2
        existing.shi = sentimentToShi(existing.avgSentimentScore)
      }
    }
    const recentHistory = Array.from(dailyMap.values()).sort((a, b) =>
      b.date.localeCompare(a.date),
    )

    // ── Lifetime totals ───────────────────────────────────────────────────────
    const allActivities = await this.prisma.agentActivity.findMany({
      where: { userId },
      select: {
        activeMinutes: true,
        gossipCount: true,
        avgSentimentScore: true,
      },
    })

    const lifetimeTotals = (() => {
      if (allActivities.length === 0) {
        return {
          totalShifts: allAttendances.length,
          totalActiveMinutes: 0,
          totalGossipCount: 0,
          avgSentimentScore: 0,
          avgShi: 50,
          avgTimeInChairPct: 0,
        }
      }
      const totalActiveMinutes = allActivities.reduce((s, a) => s + a.activeMinutes, 0)
      const totalGossipCount = allActivities.reduce((s, a) => s + a.gossipCount, 0)
      const avgSentimentScore =
        allActivities.reduce((s, a) => s + a.avgSentimentScore, 0) / allActivities.length

      // Avg time-in-chair %: compare active minutes vs shift duration per attended day
      const shiftsWithExit = allAttendances.filter((a) => a.exitTime)
      const avgTimeInChairPct =
        shiftsWithExit.length > 0
          ? (() => {
              const pcts = shiftsWithExit.map((att) => {
                const shiftMins = shiftMinutes(att.entryTime, att.exitTime!) ?? 0
                if (shiftMins === 0) return 0
                // Find activities on that day
                const dayActs = allActivities // simplified: use full active / total ratio
                const dayActive = totalActiveMinutes / (allActivities.length || 1)
                return Math.min(100, (dayActive / shiftMins) * 100)
              })
              return Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length)
            })()
          : 0

      return {
        totalShifts: allAttendances.length,
        totalActiveMinutes: Math.round(totalActiveMinutes * 10) / 10,
        totalGossipCount,
        avgSentimentScore: Math.round(avgSentimentScore * 1000) / 1000,
        avgShi: sentimentToShi(avgSentimentScore),
        avgTimeInChairPct,
      }
    })()

    // ── Build response ────────────────────────────────────────────────────────
    const profile: AgentProfileResponse = {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      centerId: user.centerId ?? null,
      centerName: user.center?.name ?? null,
      assignedTableId: user.assignedTable?.id ?? null,
      assignedTableName: user.assignedTable
        ? `Table ${user.assignedTable.tableNumber}`
        : null,
      facePhotoPath: user.facePhotoPath ?? null,

      todayAttendance: todayAttendanceRow
        ? {
            id: todayAttendanceRow.id,
            entryTime: todayAttendanceRow.entryTime.toISOString(),
            exitTime: todayAttendanceRow.exitTime?.toISOString() ?? null,
            totalShiftMinutes: shiftMinutes(
              todayAttendanceRow.entryTime,
              todayAttendanceRow.exitTime,
            ),
            date: isoDate(todayAttendanceRow.entryTime),
          }
        : null,

      timeInChair,

      todayActivity: todayActivityRow
        ? {
            date: isoDate(todayActivityRow.createdAt),
            activeMinutes: todayActivityRow.activeMinutes,
            gossipCount: todayActivityRow.gossipCount,
            avgSentimentScore: todayActivityRow.avgSentimentScore,
            shi: sentimentToShi(todayActivityRow.avgSentimentScore),
            idleAlertCount: 0,
          }
        : null,

      recentHistory,
      lifetimeTotals,
    }

    // ── Broadcast profile update to SUPER_ADMIN ───────────────────────────────
    const centerId = user.centerId ?? 'unknown'
    const envelope = this.events.buildEnvelope(
      centerId,
      user.center?.name ?? centerId,
      'INFO' as AlertSeverity,
      { profile },
    )
    this.events.emitToSuperAdmin(WS_EVENTS.AGENT_PROFILE_UPDATED, envelope)

    return profile
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Private helpers
  // ══════════════════════════════════════════════════════════════════════════

  /** Retrieve today's most recent Attendance record for an agent */
  private async getTodayAttendance(userId: string) {
    return this.prisma.attendance.findFirst({
      where: { userId, entryTime: { gte: todayStart() } },
      orderBy: { entryTime: 'desc' },
    })
  }

  /**
   * Calculate the time-in-chair breakdown for a shift.
   *
   * Formula:
   *   totalShiftMinutes = exitTime - entryTime (or now if still open)
   *   activeMinutes     = minutes AI detected the agent at their desk
   *   idleMinutes       = totalShiftMinutes - activeMinutes
   *   alertDrivenIdle   = idleAlertCount * IDLE_ALERT_MINUTES
   *   timeInChairPct    = activeMinutes / totalShiftMinutes * 100
   */
  private calcTimeInChair(
    attendance: { entryTime: Date; exitTime: Date | null },
    activeMinutes: number,
    idleAlertCount: number,
  ): TimeInChairBreakdown {
    const exitOrNow = attendance.exitTime ?? new Date()
    const totalShiftMinutes = Math.max(
      0,
      Math.round((exitOrNow.getTime() - attendance.entryTime.getTime()) / 60_000),
    )
    const capped = Math.min(activeMinutes, totalShiftMinutes)
    const idleMinutes = Math.max(0, totalShiftMinutes - capped)
    const alertDrivenIdleMinutes = idleAlertCount * IDLE_ALERT_MINUTES
    const timeInChairPct =
      totalShiftMinutes > 0 ? Math.round((capped / totalShiftMinutes) * 1000) / 10 : 0

    return {
      totalShiftMinutes,
      activeMinutes: Math.round(capped * 10) / 10,
      idleMinutes: Math.round(idleMinutes * 10) / 10,
      alertDrivenIdleMinutes: Math.min(idleMinutes, alertDrivenIdleMinutes),
      timeInChairPct,
    }
  }
}
