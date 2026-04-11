import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsOptional, MaxLength } from 'class-validator'

/**
 * Payload for POST /provisioning/devices/:id/reject
 *
 * Super Admin may optionally provide a reason for the rejection.
 * The device stays in the inventory as REJECTED for audit purposes.
 */
export class RejectDeviceDto {
  @ApiPropertyOptional({
    description: 'Reason for rejection — stored for audit trail',
    example: 'Unrecognised MAC address — possible rogue device',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string
}
