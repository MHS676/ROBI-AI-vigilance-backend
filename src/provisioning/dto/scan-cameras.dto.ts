import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  Matches,
} from 'class-validator'
import { Type } from 'class-transformer'

/**
 * Payload for POST /provisioning/cameras/scan
 *
 * Triggers an ONVIF WS-Discovery UDP multicast scan + HTTP port probe
 * on the given branch subnet to find Tiandy / Hikvision cameras.
 */
export class ScanCamerasDto {
  @ApiProperty({
    description:
      'Network subnet prefix (first 3 octets) to scan. ' +
      'The service will probe .1–.254 on this subnet.',
    example: '192.168.1',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/, {
    message: 'subnet must be the first 3 octets, e.g. "192.168.1"',
  })
  subnet: string

  @ApiPropertyOptional({
    description: 'TCP probe timeout in milliseconds (default 2000)',
    example: 2000,
    default: 2000,
  })
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(10_000)
  @Type(() => Number)
  timeoutMs?: number = 2000

  @ApiPropertyOptional({
    description: 'Maximum concurrent TCP probes (default 50)',
    example: 50,
    default: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  concurrency?: number = 50
}
