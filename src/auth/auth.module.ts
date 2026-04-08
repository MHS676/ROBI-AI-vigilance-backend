import { Module } from '@nestjs/common'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtStrategy } from './strategies/jwt.strategy'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { RolesGuard } from './guards/roles.guard'

@Module({
  imports: [
    // Register Passport with 'jwt' as the default strategy so that
    // AuthGuard() (without arguments) automatically uses JWT.
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // Async JWT module — reads secret + expiry from ConfigService so
    // the values come from .env and are never hardcoded.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          // Cast required: @nestjs/jwt@11 uses branded 'StringValue' from ms
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          expiresIn: config.get('JWT_EXPIRES_IN', '7d') as any,
          issuer: 'falcon-security-limited',
          audience: 'falcon-api',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,

    // Passport strategy — registered as a provider so NestJS
    // Dependency Injection handles ConfigService + PrismaService injection.
    JwtStrategy,

    // Guards exported so AppModule or individual modules can reference
    // them without re-declaring. Use APP_GUARD in AppModule for global registration.
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [
    // JwtModule exported so other modules can call JwtService.sign() if needed
    JwtModule,
    PassportModule,
    AuthService,
    // Export guards so they can be injected in other modules or used as APP_GUARD
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
