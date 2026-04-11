import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, IsIn } from 'class-validator'
import { InventoryStatus, InventoryDeviceType } from '@prisma/client'

/**
 * Query filters for GET /provisioning/devices
 */
export class DeviceInventoryQueryDto {
  @ApiPropertyOptional({
    enum: InventoryStatus,
    description: 'Filter by lifecycle status',
    example: 'PENDING',
  })
  @IsOptional()
  @IsString()
  @IsIn(Object.values(InventoryStatus))
  status?: InventoryStatus

  @ApiPropertyOptional({
    enum: InventoryDeviceType,
    description: 'Filter by hardware type',
    example: 'ESP32',
  })
  @IsOptional()
  @IsString()
  @IsIn(Object.values(InventoryDeviceType))
  deviceType?: InventoryDeviceType

  @ApiPropertyOptional({
    description: 'Filter by assigned center ID',
    example: 'clxyz123abc',
  })
  @IsOptional()
  @IsString()
  centerId?: string
}
