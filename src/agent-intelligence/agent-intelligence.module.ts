import { Module } from '@nestjs/common'
import { AgentIntelligenceService } from './agent-intelligence.service'
import { AgentIntelligenceController } from './agent-intelligence.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { EventsModule } from '../events/events.module'
import { AuthModule } from '../auth/auth.module'

/**
 * AgentIntelligenceModule
 *
 * Provides the Agent Intelligence feature — desk-presence activity tracking,
 * gate attendance punch-in/out, time-in-chair calculation, and aggregated
 * profile queries with real-time Socket.io broadcasting.
 *
 * Endpoints:
 *   POST /agent/activity     — upsert activity metrics (AI service)
 *   POST /agent/attendance   — punch-in / punch-out (gate service)
 *   GET  /agent/profile/:id  — aggregated intelligence profile (SUPER_ADMIN / ADMIN)
 */
@Module({
  imports: [
    PrismaModule,   // Provides PrismaService
    EventsModule,   // Provides EventsGateway for real-time broadcasts
    AuthModule,     // Provides JwtAuthGuard, RolesGuard, ApiKeyGuard
  ],
  providers: [AgentIntelligenceService],
  controllers: [AgentIntelligenceController],
  exports: [AgentIntelligenceService],
})
export class AgentIntelligenceModule {}
