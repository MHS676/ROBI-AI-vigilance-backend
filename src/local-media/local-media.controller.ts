import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { JwtService } from '@nestjs/jwt'
import { LocalMediaService } from './local-media.service'
import { SearchMediaDto } from './dto/search-media.dto'
import { CreateMediaRecordDto } from './dto/create-media-record.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../auth/guards/roles.guard'
import { Roles } from '../auth/decorators/roles.decorator'
import { Role } from '@prisma/client'

@ApiTags('Local Media')
@ApiBearerAuth()
@Controller('local-media')
export class LocalMediaController {
  constructor(
    private readonly svc: LocalMediaService,
    private readonly jwt: JwtService,
  ) {}

  // ── Search ────────────────────────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Paginated search — filter by cameraNumber, micNumber, date, mediaType …' })
  search(@Query() dto: SearchMediaDto) {
    return this.svc.search(dto)
  }

  // ── Storage stats ─────────────────────────────────────────────────────────

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Total file count and size on disk' })
  stats(@Query('centerId') centerId?: string) {
    return this.svc.storageStats(centerId)
  }

  // ── Protected file stream (range-aware) ───────────────────────────────────
  //
  // Used by <video src> and <audio src> in the browser — these cannot send
  // custom headers, so we accept the JWT via ?token= query param.
  //
  // The token is verified inline (not via JwtAuthGuard) so we can still use
  // the @Res() decorator without disabling the global interceptors.

  @Get('stream/:id')
  @ApiOperation({ summary: 'Stream a media file from disk (supports HTTP Range)' })
  async stream(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // ── Verify JWT from query param or Authorization header ──────────────────
    const raw =
      token ??
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : undefined)

    if (!raw) {
      res.status(401).json({ message: 'Missing token' })
      return
    }
    try {
      this.jwt.verify(raw)
    } catch {
      res.status(401).json({ message: 'Invalid or expired token' })
      return
    }

    // ── Resolve the media record ──────────────────────────────────────────────
    const record = await this.svc.findOne(id).catch(() => null)
    if (!record) {
      res.status(404).json({ message: 'Media record not found' })
      return
    }

    const filePath = record.absolutePath as string
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ message: 'File not found on disk' })
      return
    }

    const stat = fs.statSync(filePath)
    const total = stat.size
    const ext = path.extname(filePath).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.wav': 'audio/wav',
      '.aac': 'audio/aac',
      '.mp3': 'audio/mpeg',
      '.webm': 'video/webm',
    }
    const mime = mimeMap[ext] ?? 'application/octet-stream'

    // ── Handle Range request (required for video seeking) ─────────────────────
    const rangeHeader = req.headers['range']
    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-')
      const start = parseInt(startStr, 10)
      const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1_048_576, total - 1)
      const chunkSize = end - start + 1

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mime,
        'Cache-Control': 'no-store',
      })
      fs.createReadStream(filePath, { start, end }).pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      })
      fs.createReadStream(filePath).pipe(res)
    }
  }

  // ── Single record ─────────────────────────────────────────────────────────

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Get one media record by ID' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id)
  }

  // ── Manual register (e.g. after external write) ───────────────────────────

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Register an existing file in the media index' })
  register(@Body() dto: CreateMediaRecordDto) {
    return this.svc.register(dto)
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a file from disk and remove its DB record' })
  remove(@Param('id') id: string) {
    return this.svc.remove(id)
  }
}
