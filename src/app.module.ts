import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { CentersModule } from './centers/centers.module'
import { CamerasModule } from './cameras/cameras.module'
import { EspNodesModule } from './esp-nodes/esp-nodes.module'
import { MicrophonesModule } from './microphones/microphones.module'
import { TablesModule } from './tables/tables.module'
import { MappingModule } from './mapping/mapping.module'
import { EventsModule } from './events/events.module'
import { MqttModule } from './mqtt/mqtt.module'
import { IngestModule } from './ingest/ingest.module'
import { ProvisioningModule } from './provisioning/provisioning.module'
import { RuViewModule } from './ruview/ruview.module'
import { AlertsModule } from './alerts/alerts.module'
import { StreamingModule } from './streaming/streaming.module'
import { LocalMediaModule } from './local-media/local-media.module'

@Module({
  imports: [
    // Config — load .env globally
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Task scheduling (required for @Cron in CameraPollerService)
    ScheduleModule.forRoot(),

    // Database
    PrismaModule,

    // Feature modules
    AuthModule,
    UsersModule,
    CentersModule,
    CamerasModule,
    EspNodesModule,
    MicrophonesModule,
    TablesModule,
    MappingModule,
    EventsModule,
    MqttModule,
    IngestModule,
    ProvisioningModule,
    RuViewModule,
    AlertsModule,
    StreamingModule,
    LocalMediaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
