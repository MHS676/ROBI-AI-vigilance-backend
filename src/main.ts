import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { MicroserviceOptions, Transport } from '@nestjs/microservices'
import { AppModule } from './app.module'

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  const app = await NestFactory.create(AppModule)

  // ── Global validation pipe ─────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,         // strip unknown fields
      forbidNonWhitelisted: true,
      transform: true,         // auto-transform payloads to DTO types
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  // ── CORS ───────────────────────────────────────────────────
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',') ?? ['*']
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
  })

  // ── Global prefix ──────────────────────────────────────────
  app.setGlobalPrefix('api/v1')

  // ── Swagger / OpenAPI ──────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('Falcon Security Limited API')
    .setDescription(
      'Enterprise AI Surveillance System — Multi-Tenant Backend\n\n' +
      '**Roles:** SUPER_ADMIN (global) · ADMIN (center-scoped) · AGENT (table-scoped)\n\n' +
      '**Core Flow:** Center → Camera + EspNode + Microphone → Table (links all hardware to 1 Agent)',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('Auth', 'Authentication & JWT')
    .addTag('System', 'Health & Statistics')
    .addTag('Users', 'User management with RBAC')
    .addTag('Centers', '105 physical branches')
    .addTag('Cameras', 'RTSP stream cameras')
    .addTag('ESP Nodes', 'WiFi sensing devices')
    .addTag('Microphones', 'Audio capture — LEFT/RIGHT channels')
    .addTag('Tables', 'Core: Camera + BoundingBox + Microphone + Agent')
    .addTag('Mapping', 'Hardware mapping — link tables to camera/mic/agent')
    .build()

  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  })

  // ── MQTT Microservice ──────────────────────────────────────
  // Connect the MQTT transport so @EventPattern decorators in MqttController
  // can receive messages from the 525 ESP32 nodes.
  // The broker URL defaults to localhost:1883 for local dev (e.g. Mosquitto).
  // In production, set MQTT_URL=mqtt://your-broker:1883 in .env
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.MQTT,
    options: {
      url: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
      clientId: `falcon-backend-${process.env.NODE_ENV ?? 'dev'}-${Date.now()}`,
      clean: true,
      connectTimeout: 4000,
      reconnectPeriod: 1000,
      // Subscribe to all falcon topics with QoS 1 for at-least-once delivery
      subscribeOptions: { qos: 1 as const },
    },
  })

  // ── Start server ───────────────────────────────────────────
  const port = process.env.PORT ?? 3000
  await app.startAllMicroservices()
  await app.listen(port)

  logger.log(`🦅 Falcon Security API running on: http://localhost:${port}/api/v1`)
  logger.log(`📚 Swagger docs at:               http://localhost:${port}/api/docs`)
  logger.log(`🔌 WebSocket (Socket.io) at:       ws://localhost:${port}/events`)
  logger.log(`📡 MQTT broker:                    ${process.env.MQTT_URL ?? 'mqtt://localhost:1883'}`)
}

bootstrap()
