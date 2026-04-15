import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { Role } from '@prisma/client'
import { RequestUser } from '../auth/interfaces/jwt-payload.interface'

export interface AlertsQuery {
  centerId?: string
  type?: string
  severity?: string
  dateFrom?: string
  dateTo?: string
  page?: string
  limit?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// AlertsService
//
// Queries the Alert table with optional filters.
//
// Access control:
//   SUPER_ADMIN — can query across all centers; optional centerId filter
//   ADMIN       — scope-locked to their own centerId; centerId param ignored
//   AGENT       — not permitted (enforced at controller level via @Roles)
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Include shape returned with every alert ───────────────────────────────
  private readonly include = {
    center: { select: { id: true, name: true, code: true } },
    table:  { select: { id: true, name: true, tableNumber: true } },
    camera: { select: { id: true, name: true } },
  } as const

  async findAll(query: AlertsQuery, caller: RequestUser) {
    const pageNum  = Math.max(1,   parseInt(query.page  ?? '1',  10))
    const pageSize = Math.min(100, parseInt(query.limit ?? '50', 10))
    const skip     = (pageNum - 1) * pageSize

    // ── Resolve effective centerId ────────────────────────────────────────
    const effectiveCenterId =
      caller.role === Role.SUPER_ADMIN
        ? (query.centerId ?? undefined) // honour optional filter from SUPER_ADMIN
        : caller.centerId ?? undefined  // ADMIN is always locked to their center

    // ── Build where clause ────────────────────────────────────────────────
    const where: Parameters<typeof this.prisma.alert.findMany>[0]['where'] = {
      ...(effectiveCenterId ? { centerId: effectiveCenterId } : {}),
      ...(query.type     ? { type:     query.type     } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
    }

    // Date range filter on timestamp
    if (query.dateFrom || query.dateTo) {
      where.timestamp = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo   ? { lte: new Date(query.dateTo)   } : {}),
      }
    }

    // ── Execute with pagination ───────────────────────────────────────────
    const [alerts, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where,
        include: this.include,
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.alert.count({ where }),
    ])

    return {
      data: alerts,
      meta: {
        total,
        page:       pageNum,
        limit:      pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    }
  }

  async findOne(id: string) {
    return this.prisma.alert.findUnique({
      where:   { id },
      include: this.include,
    })
  }
}
