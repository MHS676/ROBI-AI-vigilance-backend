import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  IsEnum,
  Matches,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { DeviceStatus } from '@prisma/client'

export class CreateEspNodeDto {
  @ApiProperty({ example: 'ESP-NODE-LGS-001-01' })
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty({ example: 'AA:BB:CC:DD:EE:01' })
  @IsString()
  @Matches(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, {
    message: 'macAddress must be a valid MAC address (e.g. AA:BB:CC:DD:EE:FF)',
  })
  macAddress: string

  @ApiPropertyOptional({ example: '192.168.1.201' })
  @IsString()
  @IsOptional()
  ipAddress?: string

  @ApiPropertyOptional({ example: 'v2.1.4' })
  @IsString()
  @IsOptional()
  firmwareVer?: string

  @ApiPropertyOptional({ enum: DeviceStatus, default: DeviceStatus.ONLINE })
  @IsEnum(DeviceStatus)
  @IsOptional()
  status?: DeviceStatus

  @ApiProperty({ example: 'clxyz...' })
  @IsString()
  @IsNotEmpty()
  centerId: string
}
