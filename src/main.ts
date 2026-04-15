import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { MicroserviceOptions, Transport } from '@nestjs/microservices'
import { NestExpressApplication } from '@nestjs/platform-express'
import { join } from 'path'
import { AppModule } from './app.module'

async function bootstrap() {
  const logger = new Logger('Bootstrap')
  const app = await NestFactory.create<NestExpressApplication>(AppModule)

  // ── Static assets — serve uploaded center maps ─────────────
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' })

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
    .addTag('Provisioning', 'Zero-Config Hardware Provisioning — discovery, approval, ONVIF scan')
    .build()

  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  })

  // ── MQTT Microservice ──────────────────────────────────────
  // Connects to RabbitMQ MQTT plugin (rabbitmq_mqtt) on port 1883.
  // RabbitMQ credentials are encoded in the MQTT_URL as mqtt://user:pass@host:port
  // Enable MQTT plugin on RabbitMQ: rabbitmq-plugins enable rabbitmq_mqtt
  const mqttUrl  = process.env.MQTT_URL ?? 'mqtt://localhost:1883'
  const mqttUser = process.env.RABBITMQ_USER
  const mqttPass = process.env.RABBITMQ_PASS
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.MQTT,
    options: {
      url: mqttUrl,
      ...(mqttUser && mqttPass ? { username: mqttUser, password: mqttPass } : {}),
      clientId: `falcon-backend-${process.env.NODE_ENV ?? 'dev'}-${Date.now()}`,
      clean: true,
      connectTimeout: 4000,
      reconnectPeriod: 5000,
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
