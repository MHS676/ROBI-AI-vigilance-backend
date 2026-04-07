import { NestFactory } from '@nestjs/core'
import { ValidationPipe, Logger } from '@nestjs/common'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
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
    .build()

  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  })

  // ── Start server ───────────────────────────────────────────
  const port = process.env.PORT ?? 3000
  await app.listen(port)

  logger.log(`🦅 Falcon Security API running on: http://localhost:${port}/api/v1`)
  logger.log(`📚 Swagger docs at:               http://localhost:${port}/api/docs`)
}

bootstrap()
