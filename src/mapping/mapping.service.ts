import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { LinkTableDto } from './dto/link-table.dto'
import { RelinkTableDto } from './dto/relink-table.dto'
import { RequestUser } from '../auth/interfaces/jwt-payload.interface'
import { Role } from '@prisma/client'

// ─── include shape re-used for all responses ───────────────────────────────────
const TABLE_INCLUDE = {
  center: { select: { id: true, name: true, code: true } },
  camera: { select: { id: true, name: true, rtspUrl: true, ipAddress: true, status: true } },
  microphone: { select: { id: true, name: true, channel: true, ipAddress: true, status: true } },
  agent: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
    },
  },
} as const

@Injectable()
export class MappingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── linkTable ───────────────────────────────────────────────────────────────
  /**
   * The core "hardware mapping" operation.
   *
   * Pre-flight checks (all throw before opening a transaction):
   *   1. Center exists and is active
   *   2. Table exists, belongs to the given center, and is NOT yet fully linked
   *   3. Camera belongs to center and has no table assignment
   *   4. Microphone belongs to center and has no table assignment
   *   5. Agent belongs to center, has role AGENT, is active, and has no assigned table
   *
   * Then executes a single `prisma.$transaction` to atomically write the link.
   */
  async linkTable(dto: LinkTableDto, caller: RequestUser) {
    const { centerId, tableId, cameraId, boundingBox, microphoneId, agentId } = dto

    // ── 1. Center ─────────────────────────────────────────────────────────────
    const center = await this.prisma.center.findUnique({ where: { id: centerId } })
    if (!center) throw new NotFoundException(`Center ${centerId} not found`)
    if (!center.isActive)
      throw new BadRequestException(`Center "${center.name}" is not active`)

    // ── 2. Table ──────────────────────────────────────────────────────────────
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      include: { camera: true, microphone: true, agent: true },
    })
    if (!table) throw new NotFoundException(`Table ${tableId} not found`)
    if (table.centerId !== centerId)
      throw new BadRequestException(`Table ${tableId} does not belong to center ${centerId}`)
    if (table.cameraId || table.microphoneId || table.agentId)
      throw new ConflictException(
        `Table "${table.name}" is already fully (or partially) linked. ` +
          `Use PATCH /mapping/relink-table/${tableId} to swap hardware.`,
      )

    // ── 3. Camera ─────────────────────────────────────────────────────────────
    const camera = await this.prisma.camera.findUnique({ where: { id: cameraId } })
    if (!camera) throw new NotFoundException(`Camera ${cameraId} not found`)
    if (camera.centerId !== centerId)
      throw new BadRequestException(`Camera ${cameraId} does not belong to center ${centerId}`)
    const cameraInUse = await this.prisma.table.findFirst({ where: { cameraId } })
    if (cameraInUse)
      throw new ConflictException(
        `Camera "${camera.name}" is already assigned to table "${cameraInUse.name}". ` +
          `A camera can only monitor one table at a time.`,
      )

    // ── 4. Microphone ─────────────────────────────────────────────────────────
    const mic = await this.prisma.microphone.findUnique({ where: { id: microphoneId } })
    if (!mic) throw new NotFoundException(`Microphone ${microphoneId} not found`)
    if (mic.centerId !== centerId)
      throw new BadRequestException(
        `Microphone ${microphoneId} does not belong to center ${centerId}`,
      )
    const micInUse = await this.prisma.table.findFirst({ where: { microphoneId } })
    if (micInUse)
      throw new ConflictException(
        `Microphone "${mic.name}" (${mic.channel} channel) is already linked to ` +
          `table "${micInUse.name}". Each microphone can only be linked to one table.`,
      )

    // ── 5. Agent ──────────────────────────────────────────────────────────────
    const agent = await this.prisma.user.findUnique({
      where: { id: agentId },
      include: { assignedTable: true },
    })
    if (!agent) throw new NotFoundException(`Agent (user) ${agentId} not found`)
    if (agent.centerId !== centerId)
      throw new BadRequestException(`Agent ${agentId} does not belong to center ${centerId}`)
    if (agent.role !== Role.AGENT)
      throw new BadRequestException(
        `User ${agentId} has role "${agent.role}" — only users with role AGENT can be assigned to a table`,
      )
    if (!agent.isActive)
      throw new BadRequestException(`Agent "${agent.firstName} ${agent.lastName}" is inactive`)
    if (agent.assignedTable)
      throw new ConflictException(
        `Agent "${agent.firstName} ${agent.lastName}" is already assigned to table "${agent.assignedTable.name}". ` +
          `An agent can only monitor one table at a time.`,
      )

    // ── Atomic write ──────────────────────────────────────────────────────────
    try {
      const linked = await this.prisma.$transaction(async (tx) => {
        return tx.table.update({
          where: { id: tableId },
          data: {
            cameraId,
            boundingBox: boundingBox as unknown as Prisma.InputJsonValue,
            microphoneId,
            agentId,
          },
          include: TABLE_INCLUDE,
        })
      })

      return {
        message: `Table "${linked.name}" in center "${center.name}" has been successfully linked`,
        table: linked,
      }
    } catch (err: any) {
      // Prisma unique constraint violation (P2002) — double-safety catch
      if (err.code === 'P2002') {
        const target: string[] = err.meta?.target ?? []
        if (target.includes('cameraId'))
          throw new ConflictException('Camera was linked to another table between validation and write — please retry')
        if (target.includes('microphoneId'))
          throw new ConflictException('Microphone was linked to another table between validation and write — please retry')
        if (target.includes('agentId'))
          throw new ConflictException('Agent was assigned to another table between validation and write — please retry')
      }
      throw err
    }
  }

  // ── relinkTable ─────────────────────────────────────────────────────────────
  /**
   * Swap one or more hardware components on a table that is already linked.
   * Only the fields provided in the DTO are changed.
   */
  async relinkTable(tableId: string, dto: RelinkTableDto, caller: RequestUser) {
    // Load current table state
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      include: TABLE_INCLUDE,
    })
    if (!table) throw new NotFoundException(`Table ${tableId} not found`)

    const { cameraId, boundingBox, microphoneId, agentId } = dto
    const centerId = table.centerId

    // Validate each new component if provided
    if (cameraId !== undefined && cameraId !== table.cameraId) {
      const cam = await this.prisma.camera.findUnique({ where: { id: cameraId } })
      if (!cam) throw new NotFoundException(`Camera ${cameraId} not found`)
      if (cam.centerId !== centerId)
        throw new BadRequestException(`Camera ${cameraId} does not belong to the same center`)
      const inUse = await this.prisma.table.findFirst({ where: { cameraId } })
      if (inUse)
        throw new ConflictException(
          `Camera "${cam.name}" is already assigned to table "${inUse.name}"`,
        )
    }

    if (microphoneId !== undefined && microphoneId !== table.microphoneId) {
      const mic = await this.prisma.microphone.findUnique({ where: { id: microphoneId } })
      if (!mic) throw new NotFoundException(`Microphone ${microphoneId} not found`)
      if (mic.centerId !== centerId)
        throw new BadRequestException(`Microphone ${microphoneId} does not belong to the same center`)
      const inUse = await this.prisma.table.findFirst({ where: { microphoneId } })
      if (inUse)
        throw new ConflictException(
          `Microphone "${mic.name}" is already linked to table "${inUse.name}"`,
        )
    }

    if (agentId !== undefined && agentId !== table.agentId) {
      const agent = await this.prisma.user.findUnique({
        where: { id: agentId },
        include: { assignedTable: true },
      })
      if (!agent) throw new NotFoundException(`Agent (user) ${agentId} not found`)
      if (agent.centerId !== centerId)
        throw new BadRequestException(`Agent ${agentId} does not belong to the same center`)
      if (agent.role !== Role.AGENT)
        throw new BadRequestException(`User ${agentId} is not an AGENT`)
      if (!agent.isActive)
        throw new BadRequestException(`Agent "${agent.firstName} ${agent.lastName}" is inactive`)
      if (agent.assignedTable && agent.assignedTable.id !== tableId)
        throw new ConflictException(
          `Agent "${agent.firstName} ${agent.lastName}" is already assigned to table "${agent.assignedTable.name}"`,
        )
    }

    const updateData: Prisma.TableUpdateInput = {}
    if (cameraId !== undefined) updateData.camera = { connect: { id: cameraId } }
    if (boundingBox !== undefined) updateData.boundingBox = boundingBox as unknown as Prisma.InputJsonValue
    if (microphoneId !== undefined) updateData.microphone = { connect: { id: microphoneId } }
    if (agentId !== undefined) updateData.agent = { connect: { id: agentId } }
    if (dto.notes !== undefined) updateData.name = table.name

    const updated = await this.prisma.table.update({
      where: { id: tableId },
      data: updateData,
      include: TABLE_INCLUDE,
    })

    return {
      message: `Table "${updated.name}" hardware mapping updated`,
      table: updated,
    }
  }

  // ── unlinkTable ─────────────────────────────────────────────────────────────
  /**
   * Remove all hardware assignments from a table (camera, mic, agent, bounding box).
   * The table record itself is NOT deleted — just unlinked.
   */
  async unlinkTable(tableId: string, caller: RequestUser) {
    const table = await this.prisma.table.findUnique({ where: { id: tableId } })
    if (!table) throw new NotFoundException(`Table ${tableId} not found`)

    const unlinked = await this.prisma.table.update({
      where: { id: tableId },
      data: {
        cameraId: null,
        boundingBox: null,
        microphoneId: null,
        agentId: null,
      },
      include: TABLE_INCLUDE,
    })

    return {
      message: `Table "${unlinked.name}" has been fully unlinked — all hardware assignments removed`,
      table: unlinked,
    }
  }

  // ── getCenterMapping ────────────────────────────────────────────────────────
  /**
   * Full mapping view for a center — shows all tables with their hardware,
   * plus unassigned cameras, microphones, and available agents.
   */
  async getCenterMapping(centerId: string, caller: RequestUser) {
    const center = await this.prisma.center.findUnique({ where: { id: centerId } })
    if (!center) throw new NotFoundException(`Center ${centerId} not found`)

    const [tables, unassignedCameras, unassignedMicrophones, availableAgents] =
      await Promise.all([
        this.prisma.table.findMany({
          where: { centerId },
          include: TABLE_INCLUDE,
          orderBy: { tableNumber: 'asc' },
        }),
        this.prisma.camera.findMany({
          where: { centerId, table: { is: null } },
          orderBy: { name: 'asc' },
        }),
        this.prisma.microphone.findMany({
          where: { centerId, table: { is: null } },
          orderBy: { name: 'asc' },
        }),
        this.prisma.user.findMany({
          where: { centerId, role: Role.AGENT, isActive: true, assignedTable: { is: null } },
          select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
          orderBy: { firstName: 'asc' },
        }),
      ])

    const linkedTables = tables.filter((t) => t.cameraId && t.microphoneId && t.agentId)
    const partialTables = tables.filter(
      (t) => !!(t.cameraId || t.microphoneId || t.agentId) && !(t.cameraId && t.microphoneId && t.agentId),
    )
    const emptyTables = tables.filter((t) => !t.cameraId && !t.microphoneId && !t.agentId)

    return {
      center: { id: center.id, name: center.name, code: center.code },
      summary: {
        totalTables: tables.length,
        linkedTables: linkedTables.length,
        partialTables: partialTables.length,
        emptyTables: emptyTables.length,
        unassignedCameras: unassignedCameras.length,
        unassignedMicrophones: unassignedMicrophones.length,
        availableAgents: availableAgents.length,
      },
      tables: {
        linked: linkedTables,
        partial: partialTables,
        empty: emptyTables,
      },
      available: {
        cameras: unassignedCameras,
        microphones: unassignedMicrophones,
        agents: availableAgents,
      },
    }
  }

  // ── getTableMapping ─────────────────────────────────────────────────────────
  /**
   * Detailed mapping view for a single table.
   */
  async getTableMapping(tableId: string, caller: RequestUser) {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      include: TABLE_INCLUDE,
    })
    if (!table) throw new NotFoundException(`Table ${tableId} not found`)

    return {
      table,
      isFullyLinked: !!(table.cameraId && table.microphoneId && table.agentId),
      isPartiallyLinked:
        !!(table.cameraId || table.microphoneId || table.agentId) &&
        !(table.cameraId && table.microphoneId && table.agentId),
      isUnlinked: !table.cameraId && !table.microphoneId && !table.agentId,
    }
  }
}
