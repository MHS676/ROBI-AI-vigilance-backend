import { IsString, IsInt, IsEnum, IsOptional, IsNumber, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { MediaType } from '@prisma/client'

/**
 * Passed by internal services (StreamingService, AudioService, etc.)
 * to register a completed or in-progress recording file in the DB.
 */
export class CreateMediaRecordDto {
  @ApiProperty({ enum: MediaType })
  @IsEnum(MediaType)
  mediaType: MediaType

  @ApiProperty({ description: 'Absolute path on the Linux server' })
  @IsString()
  absolutePath: string

  @ApiProperty()
  @IsString()
  centerId: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tableId?: string

  @ApiPropertyOptional({ description: 'DVR camera channel number' })
  @IsOptional()
  @IsInt()
  @Min(1)
  cameraNumber?: number

  @ApiPropertyOptional({ description: 'Microphone number' })
  @IsOptional()
  @IsInt()
  @Min(1)
  micNumber?: number

  @ApiPropertyOptional({ description: 'ISO date string YYYY-MM-DD' })
  @IsOptional()
  @IsString()
  recordingDate?: string

  @ApiPropertyOptional({ description: 'Duration in seconds' })
  @IsOptional()
  @IsNumber()
  durationSec?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string
}
