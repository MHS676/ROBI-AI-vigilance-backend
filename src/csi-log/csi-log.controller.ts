import {
  Controller,
  Get,
  Query,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common'
import { CsiLogService } from './csi-log.service'
import { QueryCsiPlaybackDto, QueryCsiFilesDto } from './dto/query-csi-log.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'

// ─────────────────────────────────────────────────────────────────────────────
// CsiLogController
//
// REST API for WiFi Sensing (CSI) log file access.
//
// All endpoints require a valid JWT and ADMIN or SUPER_ADMIN role.
//
// Endpoints:
//   GET /api/v1/csi-logs/files
//     — Lists available .jsonl log files for a center (+ optional table/date filter)
//     — Returns file metadata: path, centerId, tableId, date, nodeId, sizeBytes
//
//   GET /api/v1/csi-logs/playback
//     — Returns up to 2000 CsiFrame records for a given center/table/node/time range
//     — Frames are ordered by `ts` ascending, ready for direct timeline playback
//
// ─────────────────────────────────────────────────────────────────────────────

@Controller('csi-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
export class CsiLogController {
  constructor(private readonly csiLog: CsiLogService) {}

  // ── GET /csi-logs/files ───────────────────────────────────────────────────

  /**
   * Lists available CSI log files for a center.
   *
   * Query params (QueryCsiFilesDto):
   *   centerId  (required)
   *   tableId   (optional) — filter to one table
   *   nodeId    (optional) — returned as-is in the meta (no server-side filter)
   *   dateFrom  (optional) — "YYYY-MM-DD"
   *   dateTo    (optional) — "YYYY-MM-DD"
   *
   * Response:
   *   { files: CsiLogFileMeta[] }
   */
  @Get('files')
  async listFiles(@Query() q: QueryCsiFilesDto) {
    const files = await this.csiLog.listFiles(
      q.centerId,
      q.tableId,
      q.dateFrom,
      q.dateTo,
    )

    return { files }
  }

  // ── GET /csi-logs/playback ────────────────────────────────────────────────

  /**
   * Retrieves CSI frames for timeline playback.
   *
   * Query params (QueryCsiPlaybackDto):
   *   centerId  (required)
   *   tableId   (required) — use "_center" when no table
   *   nodeId    (required) — ESP32 MAC address e.g. "AA:BB:CC:DD:EE:01"
   *   from      (required) — ISO 8601 start timestamp
   *   to        (required) — ISO 8601 end timestamp
   *   limit     (optional) — max frames, default 2000, max 2000
   *
   * Response:
   *   {
   *     frames:       CsiFrame[],    // sorted by ts ascending
   *     count:        number,
   *     totalScanned: number,        // lines read from disk (for debugging)
   *     rangeMs:      number,        // query time range width in milliseconds
   *   }
   */
  @Get('playback')
  async playback(@Query() q: QueryCsiPlaybackDto) {
    const fromTs = new Date(q.from).getTime() / 1_000
    const toTs = new Date(q.to).getTime() / 1_000

    if (isNaN(fromTs) || isNaN(toTs)) {
      throw new BadRequestException('Invalid `from` or `to` date')
    }
    if (fromTs >= toTs) {
      throw new BadRequestException('`from` must be before `to`')
    }
    if (toTs - fromTs > 86_400 * 7) {
      throw new BadRequestException('Playback range cannot exceed 7 days')
    }

    const { frames, totalScanned } = await this.csiLog.queryRange(
      q.centerId,
      q.tableId,
      q.nodeId,
      fromTs,
      toTs,
      q.limit,
    )

    if (frames.length === 0) {
      // Return empty rather than 404 — caller decides how to handle
      return {
        frames: [],
        count: 0,
        totalScanned,
        rangeMs: (toTs - fromTs) * 1_000,
      }
    }

    // Sort ascending by timestamp (files should already be in order but
    // merging across multiple daily files can produce minor out-of-order runs)
    frames.sort((a, b) => a.ts - b.ts)

    return {
      frames,
      count: frames.length,
      totalScanned,
      rangeMs: (toTs - fromTs) * 1_000,
    }
  }
}
