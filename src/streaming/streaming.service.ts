import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { DeviceStatus } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const HLS_BASE = '/tmp/falcon-hls'

@Injectable()
export class StreamingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreamingService.name)

  /** Map of cameraId → running ffmpeg process */
  private readonly processes = new Map<
    string,
    { proc: ChildProcessWithoutNullStreams; rtspUrl: string }
  >()

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async onModuleInit() {
    // Give NestJS 3 seconds to finish booting, then start all ONLINE cameras
    setTimeout(() => this.startAll(), 3_000)
  }

  onModuleDestroy() {
    for (const [id] of this.processes) {
      this.stopCamera(id)
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Start HLS transcoding for all ONLINE cameras in the DB */
  async startAll(): Promise<void> {
    const cameras = await this.prisma.camera.findMany({
      where: {
        isActive: true,
        status: DeviceStatus.ONLINE,
        ipAddress: { not: null },
      },
    })
    this.logger.log(`Starting HLS transcoding for ${cameras.length} cameras…`)
    for (const cam of cameras) {
      this.startCamera(cam.id, cam.rtspUrl!)
    }
  }

  /** Start (or restart) a single camera's HLS stream */
  startCamera(cameraId: string, rtspUrl: string): void {
    if (this.isRunning(cameraId)) return

    const dir = this.getHlsDir(cameraId)
    fs.mkdirSync(dir, { recursive: true })

    // Clean stale segments so HLS.js doesn't load old data
    try {
      fs.readdirSync(dir).forEach((f) => {
        if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
          fs.unlinkSync(path.join(dir, f))
        }
      })
    } catch { /* ignore */ }

    const ffmpegBin =
      this.config.get<string>('FFMPEG_PATH') ?? 'ffmpeg'

    const args = [
      // Input
      '-rtsp_transport', 'tcp',
      '-i',              rtspUrl,
      // Video codec — ultra-low-latency H.264
      '-c:v',            'libx264',
      '-preset',         'ultrafast',
      '-tune',           'zerolatency',
      '-g',              '15',          // keyframe every 15 frames (0.5s at 30fps)
      '-sc_threshold',   '0',
      // No audio (surveillance cameras rarely have sync'd audio)
      '-an',
      // HLS output
      '-f',              'hls',
      '-hls_time',       '2',           // 2-second segments
      '-hls_list_size',  '5',           // rolling window of 5 segments
      '-hls_flags',      'delete_segments+independent_segments',
      '-hls_segment_filename', path.join(dir, 'seg%03d.ts'),
      path.join(dir, 'index.m3u8'),
    ]

    const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.processes.set(cameraId, { proc, rtspUrl })
    this.logger.log(`▶  ffmpeg started — camera ${cameraId}`)

    proc.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString()
      // Only log actual errors, not ffmpeg's normal verbose output
      if (/error|failed|invalid/i.test(msg) && !/past duration/i.test(msg)) {
        this.logger.warn(`[${cameraId}] ${msg.slice(0, 200).trim()}`)
      }
    })

    proc.on('close', (code) => {
      this.processes.delete(cameraId)
      if (code !== null && code !== 0) {
        this.logger.warn(
          `ffmpeg exited (code ${code}) for ${cameraId} — retrying in 5s`,
        )
        setTimeout(() => this.startCamera(cameraId, rtspUrl), 5_000)
      }
    })
  }

  /** Kill an ffmpeg process */
  stopCamera(cameraId: string): void {
    const entry = this.processes.get(cameraId)
    if (entry) {
      entry.proc.kill('SIGTERM')
      this.processes.delete(cameraId)
      this.logger.log(`■  ffmpeg stopped — camera ${cameraId}`)
    }
  }

  isRunning(cameraId: string): boolean {
    const entry = this.processes.get(cameraId)
    return !!entry && entry.proc.exitCode === null
  }

  getHlsDir(cameraId: string): string {
    return path.join(HLS_BASE, cameraId)
  }

  getStatus(cameraId: string) {
    return {
      running: this.isRunning(cameraId),
      hlsDir: this.getHlsDir(cameraId),
    }
  }

  /** Called by CameraPollerService when a camera comes back ONLINE */
  async onCameraOnline(cameraId: string, rtspUrl: string) {
    this.startCamera(cameraId, rtspUrl)
  }

  /** Called by CameraPollerService when a camera goes OFFLINE */
  async onCameraOffline(cameraId: string) {
    this.stopCamera(cameraId)
  }
}
