// ─────────────────────────────────────────────────────────────────────────────
// CsiLogService
//
// Writes raw CSI payloads from the RuViewEngineService to daily JSONL log files
// on the local disk, and provides fast time-range queries for playback.
//
// Storage layout:
//   {CSI_LOG_ROOT}/
//     {centerId}/
//       {tableId}/          ← "_center" when no table is resolved
//         {YYYY-MM-DD}/
//           csi_{safeNodeId}.jsonl   ← one JSON line per CSI frame
//
// Query strategy:
//   • `append()` is called ~10 Hz per node — uses a simple append-file write.
//     Each line is a single JSON object terminated by '\n'.
//   • `queryRange()` streams lines using Node's readline module — never loads
//     the full file into memory; filters by timestamp in O(n) time.
//   • When a query spans multiple days, all relevant files are read in sequence.
//   • `listFiles()` walks the tree to build file metadata listings.
//
// Configuration (env vars read via ConfigService):
//   CSI_LOG_ROOT   — root directory for CSI logs
//                    default: {RECORDINGS_ROOT}/csi-logs  (or /tmp/falcon-csi)
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as path from 'path'
import * as readline from 'readline'
import * as fs from 'fs'
import * as fse from 'fs-extra'
import type { CsiPayload } from '../ruview/interfaces/csi-payload.interface'
import type { CsiFrame, CsiLogFileMeta } from './interfaces/csi-frame.interface'

// ── Max frames returned from a single playback query ─────────────────────────
const MAX_FRAMES = 2_000

// ── Fallback table key when no table is resolved ─────────────────────────────
const NO_TABLE_KEY = '_center'

@Injectable()
export class CsiLogService implements OnModuleInit {
  private readonly logger = new Logger(CsiLogService.name)
  private readonly logRoot: string

  constructor(private readonly config: ConfigService) {
    // Determine root: CSI_LOG_ROOT > {RECORDINGS_ROOT}/csi-logs > /tmp/falcon-c
    const recordingsRoot =
      this.config.get<string>('RECORDINGS_ROOT') ?? '/tmp/falcon-recordings'

    this.logRoot =
      this.config.get<string>('CSI_LOG_ROOT') ??
      path.join(recordingsRoot, 'csi-logs')
  }

  async onModuleInit(): Promise<void> {
    await fse.ensureDir(this.logRoot)
    this.logger.log(`📡 CsiLog root: ${this.logRoot}`)
  }

  // ── Public: append one CSI frame ─────────────────────────────────────────

  /**
   * Appends one CSI frame to the appropriate daily .jsonl file.
   *
   * Called by RuViewEngineService for every valid payload (~10 Hz per node).
   * The write is fire-and-forget — errors are logged but never thrown so the
   * fall-detection pipeline is never blocked by disk I/O.
   *
   * @param payload   Raw CsiPayload from MQTT
   * @param centerId  Resolved center ID
   * @param tableId   Resolved table ID (or null if none)
   */
  async append(
    payload: CsiPayload,
    centerId: string,
    tableId: string | null,
  ): Promise<void> {
    try {
      const frame: CsiFrame = {
        ts: payload.timestamp ?? Date.now() / 1_000,
        nodeId: payload.nodeId,
        tableId: tableId ?? NO_TABLE_KEY,
        centerId,
        csi: payload.csi,
        ...(payload.estimatedX !== undefined && { estimatedX: payload.estimatedX }),
        ...(payload.estimatedY !== undefined && { estimatedY: payload.estimatedY }),
        ...(payload.firmwareVersion && { firmwareVersion: payload.firmwareVersion }),
      }

      const filePath = this.resolveFilePath(centerId, tableId, payload.nodeId, frame.ts)
      await fse.ensureDir(path.dirname(filePath))
      await fse.appendFile(filePath, JSON.stringify(frame) + '\n', 'utf8')
    } catch (err: any) {
      this.logger.error(`❌ CsiLog append failed: ${err?.message}`)
    }
  }

  // ── Public: query time range for playback ────────────────────────────────

  /**
   * Returns up to MAX_FRAMES CSI frames in the given time range.
   *
   * The query may span multiple daily log files — all relevant files for the
   * date range are read in order and frames are merged chronologically.
   *
   * @param centerId  Required
   * @param tableId   Required — use "_center" if no specific table
   * @param nodeId    Required — MAC address as stored
   * @param fromTs    Start Unix timestamp (seconds, inclusive)
   * @param toTs      End Unix timestamp (seconds, inclusive)
   * @param limit     Max frames to return (default MAX_FRAMES)
   */
  async queryRange(
    centerId: string,
    tableId: string,
    nodeId: string,
    fromTs: number,
    toTs: number,
    limit = MAX_FRAMES,
  ): Promise<{ frames: CsiFrame[]; totalScanned: number }> {
    const safeNodeId = this.safeNodeId(nodeId)
    const dates = this.datesBetween(fromTs, toTs)

    const frames: CsiFrame[] = []
    let totalScanned = 0

    for (const date of dates) {
      if (frames.length >= limit) break

      const filePath = path.join(
        this.logRoot,
        centerId,
        tableId,
        date,
        `csi_${safeNodeId}.jsonl`,
      )

      if (!(await fse.pathExists(filePath))) continue

      const { frames: dayFrames, scanned } = await this.readFileRange(
        filePath,
        fromTs,
        toTs,
        limit - frames.length,
      )

      frames.push(...dayFrames)
      totalScanned += scanned
    }

    return { frames, totalScanned }
  }

  // ── Public: list available log files ─────────────────────────────────────

  /**
   * Walks the log directory tree and returns metadata for each .jsonl file.
   *
   * @param centerId  Required — scopes the walk to one center
   * @param tableId   Optional — further scopes to one table
   * @param dateFrom  Optional ISO date "YYYY-MM-DD" inclusive lower bound
   * @param dateTo    Optional ISO date "YYYY-MM-DD" inclusive upper bound
   */
  async listFiles(
    centerId: string,
    tableId?: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<CsiLogFileMeta[]> {
    const centerDir = path.join(this.logRoot, centerId)
    if (!(await fse.pathExists(centerDir))) return []

    const results: CsiLogFileMeta[] = []

    // Determine which table subdirs to scan
    const tableDirs = tableId
      ? [path.join(centerDir, tableId)]
      : (await fse.readdir(centerDir)).map((d) => path.join(centerDir, d))

    for (const tableDir of tableDirs) {
      const tableName = path.basename(tableDir)
      if (!(await fse.stat(tableDir).then((s) => s.isDirectory()).catch(() => false))) {
        continue
      }

      const dateDirs = await fse.readdir(tableDir).catch(() => [] as string[])

      for (const dateDir of dateDirs) {
        // Apply date filter
        if (dateFrom && dateDir < dateFrom) continue
        if (dateTo && dateDir > dateTo) continue

        const dateDirPath = path.join(tableDir, dateDir)
        const files = await fse.readdir(dateDirPath).catch(() => [] as string[])

        for (const file of files) {
          if (!file.startsWith('csi_') || !file.endsWith('.jsonl')) continue

          const filePath = path.join(dateDirPath, file)
          const stat = await fse.stat(filePath).catch(() => null)
          if (!stat) continue

          // Decode nodeId from filename: csi_{safeNodeId}.jsonl
          const rawNodeId = file.slice(4, -6) // strip "csi_" prefix and ".jsonl"

          results.push({
            path: filePath,
            centerId,
            tableId: tableName,
            date: dateDir,
            nodeId: rawNodeId.replace(/_/g, ':'),
            sizeBytes: stat.size,
            frameCount: null, // lazy — populated only when requested
          })
        }
      }
    }

    // Sort by date desc, then tableId, then nodeId
    results.sort((a, b) =>
      b.date.localeCompare(a.date) ||
      a.tableId.localeCompare(b.tableId) ||
      a.nodeId.localeCompare(b.nodeId),
    )

    return results
  }

  /**
   * Returns the approximate frame count for a single log file by counting
   * newline characters. Fast but counts trailing newlines as empty lines.
   */
  async countFrames(filePath: string): Promise<number> {
    try {
      const content = await fse.readFile(filePath, 'utf8')
      return content.split('\n').filter((l) => l.trim().length > 0).length
    } catch {
      return 0
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Reads a single .jsonl file, parses each line, filters by [fromTs, toTs],
   * and returns up to `limit` frames.
   *
   * Uses Node's readline for streaming — never loads the full file into memory.
   */
  private readFileRange(
    filePath: string,
    fromTs: number,
    toTs: number,
    limit: number,
  ): Promise<{ frames: CsiFrame[]; scanned: number }> {
    return new Promise((resolve, reject) => {
      const frames: CsiFrame[] = []
      let scanned = 0

      const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' })
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

      rl.on('line', (line) => {
        if (!line.trim()) return
        scanned++

        if (frames.length >= limit) {
          rl.close()
          fileStream.destroy()
          return
        }

        try {
          const frame = JSON.parse(line) as CsiFrame
          if (frame.ts >= fromTs && frame.ts <= toTs) {
            frames.push(frame)
          }
        } catch {
          // Malformed line — skip silently
        }
      })

      rl.on('close', () => resolve({ frames, scanned }))
      rl.on('error', reject)
      fileStream.on('error', reject)
    })
  }

  /**
   * Builds the absolute path for a CSI log file.
   * File rolls daily — a new file is created each calendar day (UTC).
   */
  private resolveFilePath(
    centerId: string,
    tableId: string | null,
    nodeId: string,
    tsSeconds: number,
  ): string {
    const date = new Date(tsSeconds * 1_000).toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
    const safeNode = this.safeNodeId(nodeId)
    const tableKey = tableId ?? NO_TABLE_KEY
    return path.join(this.logRoot, centerId, tableKey, date, `csi_${safeNode}.jsonl`)
  }

  /**
   * Replaces colons with underscores so MAC addresses are safe as filename
   * components on all operating systems.
   * e.g. "AA:BB:CC:DD:EE:01" → "AA_BB_CC_DD_EE_01"
   */
  private safeNodeId(nodeId: string): string {
    return nodeId.replace(/:/g, '_')
  }

  /**
   * Returns all UTC calendar date strings ("YYYY-MM-DD") between two Unix
   * timestamps, inclusive. Used to find which daily log files to read.
   */
  private datesBetween(fromTs: number, toTs: number): string[] {
    const dates: string[] = []
    const ONE_DAY = 86_400_000
    // Align to start of UTC day
    let cursor = Math.floor(fromTs * 1_000 / ONE_DAY) * ONE_DAY
    const end = toTs * 1_000

    while (cursor <= end) {
      dates.push(new Date(cursor).toISOString().slice(0, 10))
      cursor += ONE_DAY
    }
    return dates
  }
}
