import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { EventsModule } from '../events/events.module'
import { CsiLogModule } from '../csi-log/csi-log.module'
import { RuViewController } from './ruview.controller'
import { RuViewEngineService } from './ruview.service'
import { WifiAnomalyService } from './wifi-anomaly.service'

/**
 * RuViewModule
 *
 * Encapsulates the WiFi CSI sensing pipeline for "Sudden Sick / Fall" detection.
 *
 * # Responsibilities
 *   • Subscribe to MQTT topic `falcon/esp/wifi-sensing` via RuViewController
 *   • Resolve ESP32 nodeId → EspNode → center → Tables (RuViewEngineService)
 *   • Apply spatial gating against each Table's WiFi zone rectangle
 *   • Run the CSI variance-based fall detection algorithm
 *   • Persist CRITICAL `WIFI_FALL` alerts to the Alert model
 *   • Broadcast `alert:wifi_csi_fall` events via EventsGateway to:
 *       - `room:super_admin`       (global dashboard)
 *       - `room:center:{centerId}` (local center dashboard)
 *
 * # Dependencies
 *   • PrismaModule  — EspNode + Table lookups + Alert creation
 *   • EventsModule  — EventsGateway for Socket.io WebSocket broadcast
 *
 * # Exported providers
 *   • RuViewEngineService — exported so ProvisioningModule can call
 *     `evictNodeCache(nodeId)` after a device is re-provisioned, ensuring
 *     the RuView engine uses the updated Table/zone configuration immediately.
 */
@Module({
  imports: [PrismaModule, EventsModule, CsiLogModule],
  controllers: [RuViewController],
  providers: [RuViewEngineService, WifiAnomalyService],
  exports: [RuViewEngineService, WifiAnomalyService],
})
export class RuViewModule {}
