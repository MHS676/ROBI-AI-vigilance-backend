import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { AppService } from './app.service'
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard'
import { Roles } from './auth/decorators/roles.decorator'
import { RolesGuard } from './auth/guards/roles.guard'
import { Role } from '@prisma/client'

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  health() {
    return this.appService.getHealth()
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'System-wide statistics (SUPER_ADMIN only)' })
  stats() {
    return this.appService.getStats()
  }
}
