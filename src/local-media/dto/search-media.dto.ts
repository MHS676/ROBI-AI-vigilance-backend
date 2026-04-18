import { IsOptional, IsString, IsInt, IsEnum, IsDateString, Min, Max } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { MediaType } from '@prisma/client'

export class SearchMediaDto {
  @ApiPropertyOptional({ description: 'Filter by center ID' })
  @IsOptional()
  @IsString()
  centerId?: string

  @ApiPropertyOptional({ description: 'Filter by table ID' })
  @IsOptional()
  @IsString()
  tableId?: string

  @ApiPropertyOptional({ description: 'DVR camera channel number (1, 2, 3 …)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cameraNumber?: number

  @ApiPropertyOptional({ description: 'Microphone number (1, 2, 3 …)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  micNumber?: number

  @ApiPropertyOptional({ enum: MediaType, description: 'VIDEO | AUDIO | WIFI_SENSING' })
  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType

  @ApiPropertyOptional({ description: 'ISO date string, e.g. "2026-04-18"' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string

  @ApiPropertyOptional({ description: 'ISO date string, e.g. "2026-04-20"' })
  @IsOptional()
  @IsDateString()
  dateTo?: string

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number = 50
}
