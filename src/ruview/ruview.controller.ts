import { Controller, Logger } from '@nestjs/common'
import { EventPattern, Payload, Ctx, MqttContext } from '@nestjs/microservices'
import { MQTT_TOPICS } from '../mqtt/mqtt.constants'
import { CsiPayload } from './interfaces/csi-payload.interface'
import { RuViewEngineService } from './ruview.service'
import { WifiAnomalyService } from './wifi-anomaly.service'

// ─────────────────────────────────────────────────────────────────────────────
// RuViewController
//
// Thin MQTT subscriber — receives raw CSI payloads on falcon/esp/wifi-sensing
// and delegates ALL processing to RuViewEngineService.
//
// This controller intentionally contains no business logic. It exists solely
// to bridge the NestJS microservice transport layer into the service.
//
// Topic:    falcon/esp/wifi-sensing
// Payload:  CsiPayload { nodeId, csi[], estimatedX?, estimatedY?, ... }
// ─────────────────────────────────────────────────────────────────────────────

@Controller()
export class RuViewController {
  private readonly logger = new Logger(RuViewController.name)

  constructor(
    private readonly ruviewService: RuViewEngineService,
    private readonly anomalyService: WifiAnomalyService,
  ) {}

  /**
   * Handles raw CSI payloads published by RuView-compatible ESP32 nodes.
   *
   * Subscribed to: `falcon/esp/wifi-sensing`
   *
   * The topic is NOT center-scoped (unlike `falcon/center/+/wifi-sensing`).
   * The RuViewEngineService resolves the center by looking up the EspNode
   * record that matches `nodeId` (the ESP32 MAC address).
   *
   * @param data     Decoded CSI payload from the MQTT broker
   * @param context  MQTT context — used here only for diagnostic logging
   */
  @EventPattern(MQTT_TOPICS.WIFI_SENSING_RAW)
  async handleWifiSensingRaw(
    @Payload() data: CsiPayload,
    @Ctx() context: MqttContext,
  ): Promise<void> {
    this.logger.debug(
      `📡 CSI payload — topic=${context.getTopic()} ` +
        `node=${data?.nodeId} ` +
        `csiLen=${Array.isArray(data?.csi) ? data.csi.length : 'N/A'} ` +
        `pos=${data?.estimatedX !== undefined ? `(${data.estimatedX},${data.estimatedY})` : 'none'}`,
    )

    await this.ruviewService.process(data)
    await this.anomalyService.process(data)
  }
}
