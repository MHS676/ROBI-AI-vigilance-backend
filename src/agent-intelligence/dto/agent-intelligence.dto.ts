import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsEnum,
  Min,
  Max,
  IsBoolean,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

// ─────────────────────────────────────────────────────────────────────────────
// POST /agent/activity
// Sent by the AI inference pipeline to update desk-presence metrics for
// a running session.  All numeric fields are optional — only the provided
// fields are merged into today's AgentActivity row.
// ─────────────────────────────────────────────────────────────────────────────
export class UpsertActivityDto {
  @ApiProperty({ description: 'CUID of the agent (User)' })
  @IsString()
  @IsNotEmpty()
  userId: string

  @ApiProperty({ description: 'CUID of the table the agent is assigned to' })
  @IsString()
  @IsNotEmpty()
  tableId: string

  /** Minutes the agent was detected as physically present at their desk */
  @ApiPropertyOptional({ minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  activeMinutes?: number

  /** Number of gossip/off-topic conversation events detected this session */
  @ApiPropertyOptional({ minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  gossipCount?: number

  /**
   * Rolling average sentiment / SHI score for this session.
   * Normalised to [-1, +1]; front-end converts to SHI % via (score+1)/2*100.
   */
  @ApiPropertyOptional({ minimum: -1, maximum: 1 })
  @IsNumber()
  @Min(-1)
  @Max(1)
  @IsOptional()
  avgSentimentScore?: number

  /** Number of IDLE_AGENT alerts fired during this session */
  @ApiPropertyOptional({ minimum: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  idleAlertCount?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /agent/attendance
// Used by the gate_attendance service to record punch-in / punch-out events.
// If action === 'punch_in'  → creates a new open Attendance record (idempotent).
// If action === 'punch_out' → closes the most recent open Attendance record.
// ─────────────────────────────────────────────────────────────────────────────
export enum AttendanceAction {
  PUNCH_IN = 'punch_in',
  PUNCH_OUT = 'punch_out',
}

export class RecordAttendanceDto {
  @ApiProperty({ description: 'CUID of the agent (User)' })
  @IsString()
  @IsNotEmpty()
  userId: string

  @ApiProperty({ description: 'CUID of the center (branch)' })
  @IsString()
  @IsNotEmpty()
  centerId: string

  @ApiProperty({ enum: AttendanceAction })
  @IsEnum(AttendanceAction)
  action: AttendanceAction

  /** Absolute local path to the JPEG snapshot taken at the gate */
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  faceImage?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Response shapes
// ─────────────────────────────────────────────────────────────────────────────

/** Aggregated activity metrics for a single day */
export interface DailyActivitySummary {
  date: string              // ISO date string "2026-04-19"
  activeMinutes: number
  gossipCount: number
  avgSentimentScore: number
  shi: number               // (avgSentimentScore+1)/2 * 100 — [0,100]
  idleAlertCount: number
}

/** A single attendance session (one shift) */
export interface AttendanceSummary {
  id: string
  entryTime: string         // ISO
  exitTime: string | null   // ISO | null (open session)
  totalShiftMinutes: number | null  // null if session is still open
  date: string              // ISO date of entryTime
}

/** Time-in-chair breakdown for a shift */
export interface TimeInChairBreakdown {
  totalShiftMinutes: number
  activeMinutes: number     // Minutes AI detected agent at desk
  idleMinutes: number       // totalShiftMinutes - activeMinutes
  /** Idle minutes attributable to fired IDLE_AGENT alerts (10 min each by default) */
  alertDrivenIdleMinutes: number
  timeInChairPct: number    // activeMinutes / totalShiftMinutes * 100
}

/** Full GET /agent/profile/:id response */
export interface AgentProfileResponse {
  userId: string
  firstName: string
  lastName: string
  email: string
  role: string
  centerId: string | null
  centerName: string | null
  assignedTableId: string | null
  assignedTableName: string | null
  facePhotoPath: string | null

  /** Today's attendance session */
  todayAttendance: AttendanceSummary | null

  /** Time-in-chair breakdown for today */
  timeInChair: TimeInChairBreakdown | null

  /** Today's desk-presence metrics */
  todayActivity: DailyActivitySummary | null

  /** Last 30 days of daily summaries */
  recentHistory: DailyActivitySummary[]

  /** Lifetime totals since account creation */
  lifetimeTotals: {
    totalShifts: number
    totalActiveMinutes: number
    totalGossipCount: number
    avgSentimentScore: number
    avgShi: number
    avgTimeInChairPct: number
  }
}
