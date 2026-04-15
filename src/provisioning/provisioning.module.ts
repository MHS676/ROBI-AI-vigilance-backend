// ─────────────────────────────────────────────────────────────────────────────
// ProvisioningModule
//
// Wires together:
//  • DiscoveryMqttController  — @EventPattern handlers for birth/ack MQTT messages
//  • ProvisioningController   — REST API (SUPER_ADMIN guarded)
//  • ProvisioningService      — business logic + DB
//  • OnvifScannerService      — ONVIF UDP multicast + TCP port scan
//
//  • ClientsModule (MQTT_CLIENT) — publishes provisioning configs back to devices
//    Uses a separate MQTT client so publishing doesn't block the microservice consumer.
// ─────────────────────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common'
import { ClientsModule, Transport } from '@nestjs/microservices'
import { ConfigService } from '@nestjs/config'
import { PrismaModule } from '../prisma/prisma.module'
import { EventsModule } from '../events/events.module'
import { DiscoveryMqttController } from './discovery.controller'
import { ProvisioningController } from './provisioning.controller'
import { ProvisioningService } from './provisioning.service'
import { OnvifScannerService } from './onvif-scanner.service'

@Module({
  imports: [
    PrismaModule,
    EventsModule,

    // MQTT publisher client — separate from the microservice consumer
    // Inject as 'MQTT_CLIENT' in ProvisioningService
    ClientsModule.registerAsync([
      {
        name: 'MQTT_CLIENT',
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.MQTT,
          options: {
            url:      config.get<string>('MQTT_URL') ?? 'mqtt://localhost:1883',
            username: config.get<string>('RABBITMQ_USER'),
            password: config.get<string>('RABBITMQ_PASS'),
            clientId: `falcon-provisioner-${Date.now()}`,
            clean:    true,
            connectTimeout: 4000,
            reconnectPeriod: 5000,
          },
        }),
      },
    ]),
  ],
  controllers: [
    DiscoveryMqttController,  // MQTT microservice consumer (birth + ack)
    ProvisioningController,   // HTTP REST API
  ],
  providers: [
    ProvisioningService,
    OnvifScannerService,
  ],
  exports: [ProvisioningService],
})
export class ProvisioningModule {}
