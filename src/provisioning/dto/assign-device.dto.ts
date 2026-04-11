import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsString,
  IsOptional,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator'

/**
 * Payload for POST /provisioning/devices/:id/assign
 *
 * The Super Admin provides:
 *  - centerId   — which branch the device belongs to
 *  - tableId    — optional, pre-links the device to a specific table
 *  - wifiSsid   — branch WiFi SSID to push via MQTT provisioning config
 *  - wifiPassword — branch WiFi password
 *  - notes      — optional admin comment
 */
export class AssignDeviceDto {
  @ApiProperty({
    description: 'The Center (branch) this device should be provisioned to',
    example: 'clxyz123abc',
  })
  @IsString()
  @IsNotEmpty()
  centerId: string

  @ApiPropertyOptional({
    description: 'Pre-assign to a specific Table at this center (optional)',
    example: 'cltable456def',
  })
  @IsOptional()
  @IsString()
  tableId?: string

  @ApiProperty({
    description: 'WiFi SSID at the branch — sent to device via MQTT provisioning config',
    example: 'FalconBranch-LGS001',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  wifiSsid: string

  @ApiProperty({
    description: 'WiFi password at the branch — sent to device via MQTT provisioning config',
    example: 'SecureWifi2024!',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(64)
  wifiPassword: string

  @ApiPropertyOptional({
    description: 'Admin notes / comments about this provisioning decision',
    example: 'Deployed at Teller Row A, left side',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string
}
