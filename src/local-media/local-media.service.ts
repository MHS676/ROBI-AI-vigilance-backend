import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MediaType } from '@prisma/client'
import * as fse from 'fs-extra'
import * as path from 'path'
import * as fs from 'fs'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateMediaRecordDto } from './dto/create-media-record.dto'
import type { SearchMediaDto } from './dto/search-media.dto'

// ─── Storage root ────────────────────────────────────────────────────────────
// Configurable via RECORDINGS_ROOT env var; falls back to /mnt/data/records
// for a standard Linux surveillance server or /tmp/falcon-recordings for dev.

function getStorageRoot(config: ConfigService): string {
  return (
    config.get<string>('RECORDINGS_ROOT') ??
    (process.env.NODE_ENV === 'production'
      ? '/mnt/data/records'
      : '/tmp/falcon-recordings')
  )
}

// ─── Date helper ─────────────────────────────────────────────────────────────
function todayIso(): string {
  return new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"
}

/**
 * LocalMediaService
 *
 * Responsibilities:
 *  1. Build the on-disk directory tree on module init:
 *       {root}/{centerId}/{tableId}/{YYYY-MM-DD}/{mediaType}/
 *
 *  2. Accept raw buffers / readable streams and write them to disk via
 *     fse.outputFile / fs.createWriteStream.
 *
 *  3. Register every completed file in the `local_media` PostgreSQL table so
 *     it is searchable by cameraNumber, micNumber, date, center, table, etc.
 *
 *  4. Provide a paginated search API used by the REST controller.
 */
@Injectable()
export class LocalMediaService implements OnModuleInit {
  private readonly logger = new Logger(LocalMediaService.name)
  private storageRoot: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.storageRoot = getStorageRoot(this.config)
    fse.ensureDirSync(this.storageRoot)
    this.logger.log(`📼  LocalMedia root: ${this.storageRoot}`)
  }

  // ── Directory helpers ─────────────────────────────────────────────────────

  /**
   * Returns the absolute directory path for a recording, creating it
   * if it does not already exist.
   *
   * Layout: {root}/{centerId}/{tableId|_no_table}/{YYYY-MM-DD}/{mediaType}/
   */
  async ensureDir(
    centerId: string,
    tableId: string | null | undefined,
    date: string,
    mediaType: MediaType,
  ): Promise<string> {
    const dir = path.join(
      this.storageRoot,
      centerId,
      tableId ?? '_no_table',
      date,
      mediaType,
    )
    await fse.ensureDir(dir)
    return dir
  }

  // ── File writers ──────────────────────────────────────────────────────────

  /**
   * Write a video segment (Buffer or ReadableStream) to disk and register it.
   * `cameraNumber` is the physical DVR channel (1, 2, 3 …).
   *
   * Returns the new LocalMedia record.
   */
  async saveVideo(opts: {
    centerId: string
    tableId?: string
    cameraNumber: number
    data: Buffer | NodeJS.ReadableStream
    extension?: string   // default: 'mp4'
    durationSec?: number
    notes?: string
  }) {
    const date = todayIso()
    const ext = opts.extension ?? 'mp4'
    const dir = await this.ensureDir(opts.centerId, opts.tableId, date, MediaType.VIDEO)
    const { createId } = await import('@paralleldrive/cuid2')
    const fileName = `${createId()}_cam${opts.cameraNumber}.${ext}`
    const absolutePath = path.join(dir, fileName)

    await this.writeData(absolutePath, opts.data)
    const fileSize = await this.getFileSize(absolutePath)

    return this.register({
      mediaType: MediaType.VIDEO,
      absolutePath,
      centerId: opts.centerId,
      tableId: opts.tableId,
      cameraNumber: opts.cameraNumber,
      recordingDate: date,
      fileSize,
      durationSec: opts.durationSec,
      notes: opts.notes,
    })
  }

  /**
   * Write an audio segment (Buffer or ReadableStream) to disk and register it.
   * `micNumber` is the physical microphone number in the center.
   */
  async saveAudio(opts: {
    centerId: string
    tableId?: string
    micNumber: number
    data: Buffer | NodeJS.ReadableStream
    extension?: string   // default: 'wav'
    durationSec?: number
    notes?: string
  }) {
    const date = todayIso()
    const ext = opts.extension ?? 'wav'
    const dir = await this.ensureDir(opts.centerId, opts.tableId, date, MediaType.AUDIO)
    const { createId } = await import('@paralleldrive/cuid2')
    const fileName = `${createId()}_mic${opts.micNumber}.${ext}`
    const absolutePath = path.join(dir, fileName)

    await this.writeData(absolutePath, opts.data)
    const fileSize = await this.getFileSize(absolutePath)

    return this.register({
      mediaType: MediaType.AUDIO,
      absolutePath,
      centerId: opts.centerId,
      tableId: opts.tableId,
      micNumber: opts.micNumber,
      recordingDate: date,
      fileSize,
      durationSec: opts.durationSec,
      notes: opts.notes,
    })
  }

  /**
   * Append a WiFi CSI frame (JSON string) to the table's daily JSONL log.
   * Each call appends one line — no re-registration if the file already exists.
   */
  async appendWifiSensing(opts: {
    centerId: string
    tableId?: string
    nodeId: string
    payload: object
  }) {
    const date = todayIso()
    const dir = await this.ensureDir(
      opts.centerId,
      opts.tableId,
      date,
      MediaType.WIFI_SENSING,
    )
    const fileName = `${date}_${opts.nodeId}.jsonl`
    const absolutePath = path.join(dir, fileName)

    // Append a single JSON line
    await fse.appendFile(absolutePath, JSON.stringify(opts.payload) + '\n')

    // Register only if this is a new file (first append of the day)
    const existing = await this.prisma.localMedia.findUnique({
      where: { absolutePath },
    })
    if (!existing) {
      return this.register({
        mediaType: MediaType.WIFI_SENSING,
        absolutePath,
        centerId: opts.centerId,
        tableId: opts.tableId,
        recordingDate: date,
        notes: `ESP node: ${opts.nodeId}`,
        fileSize: 0n,
      })
    }
    return existing
  }

  // ── DB Registration ───────────────────────────────────────────────────────

  /**
   * Low-level: create (or upsert) a LocalMedia record.
   * Internal callers use saveVideo / saveAudio / appendWifiSensing instead.
   */
  async register(dto: CreateMediaRecordDto & { fileSize?: bigint | number }) {
    const date = todayIso()
    return this.prisma.localMedia.create({
      data: {
        mediaType:    dto.mediaType,
        absolutePath: dto.absolutePath,
        fileSize:     dto.fileSize != null ? BigInt(dto.fileSize) : 0n,
        cameraNumber: dto.cameraNumber ?? null,
        micNumber:    dto.micNumber ?? null,
        centerId:     dto.centerId,
        tableId:      dto.tableId ?? null,
        recordingDate: dto.recordingDate ?? date,
        durationSec:  dto.durationSec ?? null,
        notes:        dto.notes ?? null,
      },
    })
  }

  // ── Update file size / duration after finalisation ────────────────────────

  async finalise(id: string, opts: { fileSize?: number; durationSec?: number }) {
    return this.prisma.localMedia.update({
      where: { id },
      data: {
        ...(opts.fileSize != null && { fileSize: BigInt(opts.fileSize) }),
        ...(opts.durationSec != null && { durationSec: opts.durationSec }),
      },
    })
  }

  // ── Paginated search ──────────────────────────────────────────────────────

  async search(dto: SearchMediaDto) {
    const page  = dto.page  ?? 1
    const limit = dto.limit ?? 50
    const skip  = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (dto.centerId)     where.centerId     = dto.centerId
    if (dto.tableId)      where.tableId      = dto.tableId
    if (dto.cameraNumber) where.cameraNumber = dto.cameraNumber
    if (dto.micNumber)    where.micNumber    = dto.micNumber
    if (dto.mediaType)    where.mediaType    = dto.mediaType

    // Date range on the denormalised recordingDate string
    if (dto.dateFrom || dto.dateTo) {
      where.recordingDate = {
        ...(dto.dateFrom && { gte: dto.dateFrom }),
        ...(dto.dateTo   && { lte: dto.dateTo   }),
      }
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.localMedia.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          center: { select: { id: true, name: true, code: true } },
          table:  { select: { id: true, name: true, tableNumber: true } },
        },
      }),
      this.prisma.localMedia.count({ where }),
    ])

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    }
  }

  // ── Single record ─────────────────────────────────────────────────────────

  async findOne(id: string) {
    const record = await this.prisma.localMedia.findUnique({
      where: { id },
      include: {
        center: true,
        table:  true,
      },
    })
    if (!record) throw new NotFoundException(`LocalMedia ${id} not found`)
    return record
  }

  // ── Delete from disk + DB ─────────────────────────────────────────────────

  async remove(id: string) {
    const record = await this.findOne(id)
    try {
      await fse.remove(record.absolutePath)
    } catch {
      this.logger.warn(`Could not delete file: ${record.absolutePath}`)
    }
    await this.prisma.localMedia.delete({ where: { id } })
    return { deleted: true, path: record.absolutePath }
  }

  // ── Storage stats ─────────────────────────────────────────────────────────

  async storageStats(centerId?: string) {
    const where = centerId ? { centerId } : {}
    const agg = await this.prisma.localMedia.aggregate({
      where,
      _sum: { fileSize: true },
      _count: { id: true },
    })
    return {
      totalFiles:   agg._count.id,
      totalBytes:   Number(agg._sum.fileSize ?? 0),
      totalMB:      Number((agg._sum.fileSize ?? 0n) / 1_048_576n),
      storageRoot:  this.storageRoot,
    }
  }

  // ── Internal utils ────────────────────────────────────────────────────────

  private async writeData(
    filePath: string,
    data: Buffer | NodeJS.ReadableStream,
  ): Promise<void> {
    if (Buffer.isBuffer(data)) {
      await fse.outputFile(filePath, data)
    } else {
      // Pipe stream to file
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(filePath)
        data.pipe(ws)
        ws.on('finish', resolve)
        ws.on('error', reject)
        ;(data as NodeJS.ReadableStream).on('error', reject)
      })
    }
  }

  private async getFileSize(filePath: string): Promise<bigint> {
    try {
      const stat = await fse.stat(filePath)
      return BigInt(stat.size)
    } catch {
      return 0n
    }
  }
}
