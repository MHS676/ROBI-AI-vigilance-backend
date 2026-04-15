import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { AlertsController } from './alerts.controller'
import { AlertsService } from './alerts.service'

/**
 * AlertsModule
 *
 * Exposes the persisted Alert records via REST for the
 * Historical Evidence Dashboard in the Next.js frontend.
 *
 * Routes registered:
 *   GET /api/v1/alerts             — paginated list with filters
 *   GET /api/v1/alerts/:id         — single alert detail
 *
 * Dependencies:
 *   PrismaModule — Alert + center + table + camera queries
 */
@Module({
  imports: [PrismaModule],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
