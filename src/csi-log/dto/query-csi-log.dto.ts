import { IsString, IsOptional, IsNumber, Min, Max, IsDateString } from 'class-validator'
import { Type } from 'class-transformer'

// ── Playback query ────────────────────────────────────────────────────────────

export class QueryCsiPlaybackDto {
  @IsString()
  centerId!: string

  @IsString()
  tableId!: string

  @IsString()
  nodeId!: string

  /**
   * Start of the playback window — ISO 8601 string.
   * e.g. "2026-04-18T06:00:00.000Z"
   */
  @IsDateString()
  from!: string

  /**
   * End of the playback window — ISO 8601 string.
   */
  @IsDateString()
  to!: string

  /**
   * Maximum frames to return. Capped server-side at 2000.
   * Omit to use the server default.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(2_000)
  limit?: number
}

// ── File listing query ────────────────────────────────────────────────────────

export class QueryCsiFilesDto {
  @IsString()
  centerId!: string

  @IsOptional()
  @IsString()
  tableId?: string

  @IsOptional()
  @IsString()
  nodeId?: string

  /** ISO date "YYYY-MM-DD" — inclusive lower bound for date filter. */
  @IsOptional()
  @IsString()
  dateFrom?: string

  /** ISO date "YYYY-MM-DD" — inclusive upper bound for date filter. */
  @IsOptional()
  @IsString()
  dateTo?: string
}
