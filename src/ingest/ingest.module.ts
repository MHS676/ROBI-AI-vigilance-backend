import { Module } from '@nestjs/common'
import { IngestController } from './ingest.controller'
import { EventsModule } from '../events/events.module'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [EventsModule, PrismaModule],
  controllers: [IngestController],
})
export class IngestModule {}
