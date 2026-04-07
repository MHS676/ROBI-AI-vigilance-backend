import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  IsEnum,
  IsUrl,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { DeviceStatus } from '@prisma/client'

export class CreateCameraDto {
  @ApiProperty({ example: 'CAM-01 — Teller Row A' })
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty({ example: 'rtsp://admin:pass@192.168.1.10:554/stream1' })
  @IsString()
  @IsNotEmpty()
  rtspUrl: string

  @ApiPropertyOptional({ example: '192.168.1.10' })
  @IsString()
  @IsOptional()
  ipAddress?: string

  @ApiPropertyOptional({ example: 'Hikvision DS-2CD2143G2-I' })
  @IsString()
  @IsOptional()
  model?: string

  @ApiPropertyOptional({ enum: DeviceStatus, default: DeviceStatus.ONLINE })
  @IsEnum(DeviceStatus)
  @IsOptional()
  status?: DeviceStatus

  @ApiProperty({ example: 'clxyz...' })
  @IsString()
  @IsNotEmpty()
  centerId: string
}
