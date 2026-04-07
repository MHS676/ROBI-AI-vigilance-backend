import { Module } from '@nestjs/common'
import { MqttController } from './mqtt.controller'
import { EventsModule } from '../events/events.module'
import { PrismaModule } from '../prisma/prisma.module'

/**
 * MqttModule
 *
 * Registers the MQTT message-pattern controller.
 * The actual MQTT transport is connected in main.ts via app.connectMicroservice()
 * — this module only wires the controller's dependencies.
 *
 * Dependencies:
 *  - PrismaModule  → center / device lookups + DB status updates
 *  - EventsModule  → EventsGateway for emitting WebSocket events
 */
@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [MqttController],
})
export class MqttModule {}
