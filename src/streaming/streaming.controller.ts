import {
  Controller,
  Get,
  Param,
  Res,
  NotFoundException,
  Post,
  HttpCode,
  HttpStatus,
  Body,
  InternalServerErrorException,
} from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { Response } from 'express'
import { StreamingService } from './streaming.service'
import * as path from 'path'
import * as fs from 'fs'
import { spawn } from 'child_process'
import { ConfigService } from '@nestjs/config'

/**
 * StreamingController — serves HLS segments transcoded from RTSP by ffmpeg.
 * These endpoints are intentionally public (no JWT) so the browser's
 * HLS.js player can fetch .m3u8 manifests and .ts segments directly.
 */
@ApiTags('Streaming')
@Controller('streaming')
export class StreamingController {
  constructor(
    private readonly streamingService: StreamingService,
    private readonly config: ConfigService,
  ) {}

  // ── Status ──────────────────────────────────────────────────────────────

  @Get(':cameraId/status')
  @ApiOperation({ summary: 'Check if HLS transcoding is running for a camera' })
  getStatus(@Param('cameraId') cameraId: string) {
    return this.streamingService.getStatus(cameraId)
  }

  // ── Snapshot ─────────────────────────────────────────────────────────────

  @Get(':cameraId/snapshot.jpg')
  @ApiOperation({ summary: 'Grab a JPEG snapshot from the latest HLS segment' })
  async getSnapshot(@Param('cameraId') cameraId: string, @Res() res: Response) {
    const hlsDir = this.streamingService.getHlsDir(cameraId)
    const manifest = path.join(hlsDir, 'index.m3u8')

    if (!fs.existsSync(manifest)) {
      throw new NotFoundException('Stream not ready yet')
    }

    // Find the latest .ts segment in the HLS dir
    const segments = fs.readdirSync(hlsDir)
      .filter(f => f.endsWith('.ts'))
      .sort()
    if (segments.length === 0) {
      throw new NotFoundException('No segments available yet')
    }
    const latestSeg = path.join(hlsDir, segments[segments.length - 1])

    const ffmpegBin = this.config.get<string>('FFMPEG_PATH') ?? 'ffmpeg'

    // Extract one JPEG frame from the latest segment
    const jpeg = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      const proc = spawn(ffmpegBin, [
        '-i', latestSeg,
        '-vframes', '1',
        '-f', 'image2',
        '-vcodec', 'mjpeg',
        'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'ignore'] })

      proc.stdout.on('data', (d: Buffer) => chunks.push(d))
      proc.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks))
        } else {
          reject(new Error(`ffmpeg exited ${code}`))
        }
      })
      proc.on('error', reject)

      // Timeout after 5s
      setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 5000)
    }).catch(() => null)

    if (!jpeg) {
      throw new InternalServerErrorException('Could not extract frame')
    }

    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'no-cache, no-store')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(jpeg)
  }

  // ── Start / Stop ─────────────────────────────────────────────────────────

  @Post(':cameraId/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start HLS transcoding for a camera (admin use)' })
  async startStream(
    @Param('cameraId') cameraId: string,
    @Body('rtspUrl') rtspUrl?: string,
  ) {
    if (rtspUrl) {
      this.streamingService.startCamera(cameraId, rtspUrl)
    } else {
      await this.streamingService.startAll()
    }
    return { started: true }
  }

  // ── HLS manifest ─────────────────────────────────────────────────────────

  @Get(':cameraId/index.m3u8')
  @ApiOperation({ summary: 'HLS playlist (.m3u8) — consumed by HLS.js in browser' })
  getManifest(@Param('cameraId') cameraId: string, @Res() res: Response) {
    const filePath = path.join(
      this.streamingService.getHlsDir(cameraId),
      'index.m3u8',
    )
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('HLS stream not ready yet — please retry in a moment')
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.sendFile(filePath)
  }

  // ── HLS segments ──────────────────────────────────────────────────────────

  @Get(':cameraId/:segment')
  @ApiOperation({ summary: 'HLS video segment (.ts file)' })
  getSegment(
    @Param('cameraId') cameraId: string,
    @Param('segment') segment: string,
    @Res() res: Response,
  ) {
    if (!segment.endsWith('.ts')) {
      throw new NotFoundException('Only .ts segments are served here')
    }
    const filePath = path.join(
      this.streamingService.getHlsDir(cameraId),
      segment,
    )
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Segment not found or already deleted')
    }
    res.setHeader('Content-Type', 'video/MP2T')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.sendFile(filePath)
  }
}
