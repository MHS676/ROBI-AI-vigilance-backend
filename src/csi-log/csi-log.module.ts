import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { CsiLogService } from './csi-log.service'
import { CsiLogController } from './csi-log.controller'

/**
 * CsiLogModule
 *
 * Encapsulates the WiFi CSI (Channel State Information) log persistence layer.
 *
 * # Responsibilities
 *   • Write raw CSI frames to daily .jsonl files on the local disk
 *   • Provide time-range queries for timeline playback (via CsiLogController)
 *   • Provide file listing with metadata for the playback UI
 *
 * # Storage Layout
 *   {CSI_LOG_ROOT}/{centerId}/{tableId}/{YYYY-MM-DD}/csi_{nodeId}.jsonl
 *
 * # Dependencies
 *   • ConfigModule (global) — reads CSI_LOG_ROOT / RECORDINGS_ROOT from .env
 *
 * # Exported providers
 *   • CsiLogService — consumed by RuViewModule to append frames on every
 *     valid CSI payload from the MQTT topic `falcon/esp/wifi-sensing`.
 */
@Module({
  imports: [ConfigModule],
  controllers: [CsiLogController],
  providers: [CsiLogService],
  exports: [CsiLogService],
})
export class CsiLogModule {}
