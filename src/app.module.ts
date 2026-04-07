import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
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

@Module({
  imports: [
    // Config — load .env globally
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
