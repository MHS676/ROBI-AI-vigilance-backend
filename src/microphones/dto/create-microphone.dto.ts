import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  IsEnum,
} from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { DeviceStatus, MicrophoneChannel } from '@prisma/client'

export class CreateMicrophoneDto {
  @ApiProperty({ example: 'MIC-TABLE-03-LEFT' })
  @IsString()
  @IsNotEmpty()
  name: string

  @ApiProperty({ enum: MicrophoneChannel })
  @IsEnum(MicrophoneChannel)
  channel: MicrophoneChannel

  @ApiPropertyOptional({ example: '192.168.1.151' })
  @IsString()
  @IsOptional()
  ipAddress?: string

  @ApiPropertyOptional({ example: 'Rode NT-USB Mini' })
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
