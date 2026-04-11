// ─────────────────────────────────────────────────────────────────────────────
// OnvifScannerService
//
// Discovers IP cameras on a local branch network using two parallel strategies:
//
//  1. WS-Discovery UDP multicast (RFC 5023 / ONVIF spec)
//     Sends a SOAP Probe to 239.255.255.250:3702
//     Hikvision, Tiandy, Dahua — all respond to this probe.
//
//  2. TCP port scan + HTTP fingerprinting
//     Scans the given subnet (.1–.254) for open ports 80, 8080, 554.
//     If port 80/8080 is open, probes the HTTP response headers / body
//     to detect "HIKVISION" or "TIANDY" brand strings.
//
// Both strategies return `DiscoveredCamera[]` merged by IP address.
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable, Logger } from '@nestjs/common'
import * as dgram from 'dgram'
import * as net from 'net'
import * as http from 'http'

export interface DiscoveredCamera {
  ipAddress: string
  manufacturer?: string  // 'Hikvision' | 'Tiandy' | 'Dahua' | 'Unknown'
  model?: string
  onvifXAddr?: string    // ONVIF device service endpoint
  rtspUrl?: string       // Best-guess RTSP URL
  ports: number[]        // Open ports found by TCP probe
  discoveryMethod: 'onvif' | 'tcp-scan' | 'both'
}

// ── ONVIF WS-Discovery SOAP Probe ─────────────────────────────────────────────
const WS_DISCOVERY_PROBE = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <s:Header>
    <a:Action s:mustUnderstand="1">
      http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe
    </a:Action>
    <a:MessageID>uuid:${generateUuid()}</a:MessageID>
    <a:To s:mustUnderstand="1">
      urn:schemas-xmlsoap-org:ws:2005:04:discovery
    </a:To>
  </s:Header>
  <s:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </s:Body>
</s:Envelope>`

function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Extract a value from SOAP XML by simple regex — avoids a full XML parser dep */
function extractXml(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\/(?:[^:>]+:)?${tag}>`, 'i')
  const m = xml.match(re)
  return m ? m[1].trim() : undefined
}

/** Detect manufacturer from device type string or XAddrs URL */
function detectManufacturer(xml: string): string {
  const lower = xml.toLowerCase()
  if (lower.includes('hikvision') || lower.includes('hikvision')) return 'Hikvision'
  if (lower.includes('tiandy')) return 'Tiandy'
  if (lower.includes('dahua')) return 'Dahua'
  if (lower.includes('axis')) return 'Axis'
  if (lower.includes('bosch')) return 'Bosch'
  return 'Unknown'
}

/** TCP probe: resolve if port is open, otherwise reject after timeout */
function tcpProbe(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error',   () => { socket.destroy(); resolve(false) })
    socket.connect(port, host)
  })
}

/** HTTP GET probe — returns response body (truncated) + Server header */
function httpProbe(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ server?: string; body: string } | null> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: host, port, path: '/', method: 'GET', timeout: timeoutMs },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
          if (body.length > 4096) {
            req.destroy()
            const serverHeader = Array.isArray(res.headers.server)
              ? res.headers.server[0]
              : res.headers.server
            resolve({ server: serverHeader, body })
          }
        })
        res.on('end', () => {
          const serverHeader = Array.isArray(res.headers.server)
            ? res.headers.server[0]
            : res.headers.server
          resolve({ server: serverHeader, body })
        })
      },
    )
    req.on('error',   () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}

function detectManufacturerFromHttp(server?: string, body?: string): string | undefined {
  const s = `${server ?? ''} ${body ?? ''}`.toLowerCase()
  if (s.includes('hikvision'))  return 'Hikvision'
  if (s.includes('tiandy'))     return 'Tiandy'
  if (s.includes('dahua'))      return 'Dahua'
  if (s.includes('axis'))       return 'Axis'
  if (s.includes('bosch'))      return 'Bosch'
  return undefined
}

@Injectable()
export class OnvifScannerService {
  private readonly logger = new Logger(OnvifScannerService.name)
  private readonly ONVIF_MULTICAST_ADDR = '239.255.255.250'
  private readonly ONVIF_MULTICAST_PORT = 3702
  private readonly CAMERA_PORTS = [80, 8080, 554, 8554]

  /**
   * Main entry point.
   * Runs WS-Discovery + TCP scan in parallel, merges by IP, returns results.
   */
  async scan(
    subnet: string,
    timeoutMs = 2000,
    concurrency = 50,
  ): Promise<DiscoveredCamera[]> {
    this.logger.log(`📡 Starting camera scan on subnet ${subnet}.0/24 …`)

    const [onvifCameras, tcpCameras] = await Promise.all([
      this.wsDiscovery(timeoutMs).catch(() => [] as DiscoveredCamera[]),
      this.tcpScan(subnet, timeoutMs, concurrency),
    ])

    // Merge: if a camera appears in both lists (same IP), combine into 'both'
    const merged = new Map<string, DiscoveredCamera>()

    for (const cam of tcpCameras) {
      merged.set(cam.ipAddress, cam)
    }

    for (const cam of onvifCameras) {
      const existing = merged.get(cam.ipAddress)
      if (existing) {
        merged.set(cam.ipAddress, {
          ...existing,
          ...cam,
          ports: [...new Set([...existing.ports, ...cam.ports])],
          discoveryMethod: 'both',
        })
      } else {
        merged.set(cam.ipAddress, cam)
      }
    }

    const results = Array.from(merged.values())
    this.logger.log(`✅ Camera scan complete: ${results.length} device(s) found`)
    return results
  }

  // ── WS-Discovery (ONVIF UDP Multicast) ────────────────────────────────────

  private wsDiscovery(timeoutMs: number): Promise<DiscoveredCamera[]> {
    return new Promise((resolve) => {
      const cameras: DiscoveredCamera[] = []
      const seen = new Set<string>()

      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

      socket.bind(() => {
        socket.setBroadcast(true)
        try { socket.addMembership(this.ONVIF_MULTICAST_ADDR) } catch { /* already member */ }

        const probe = Buffer.from(WS_DISCOVERY_PROBE)
        socket.send(
          probe,
          0,
          probe.length,
          this.ONVIF_MULTICAST_PORT,
          this.ONVIF_MULTICAST_ADDR,
        )

        this.logger.debug('📡 WS-Discovery probe sent to 239.255.255.250:3702')
      })

      socket.on('message', (msg, rinfo) => {
        const xml = msg.toString('utf8')
        const ip  = rinfo.address

        if (seen.has(ip)) return
        seen.add(ip)

        const xAddrs = extractXml(xml, 'XAddrs')
        const types  = extractXml(xml, 'Types') ?? ''

        // Only accept network video transmitters
        if (!types.toLowerCase().includes('networkvideo') &&
            !types.toLowerCase().includes('networkvideoTransmitter') &&
            !xAddrs) {
          return
        }

        const manufacturer = detectManufacturer(xml + (xAddrs ?? ''))
        const cam: DiscoveredCamera = {
          ipAddress: ip,
          manufacturer,
          onvifXAddr: xAddrs,
          rtspUrl: `rtsp://admin:admin@${ip}:554/stream1`,
          ports: [3702],
          discoveryMethod: 'onvif',
        }

        cameras.push(cam)
        this.logger.debug(`🎥 ONVIF: found ${ip} (${manufacturer})`)
      })

      socket.on('error', (err) => {
        this.logger.warn(`WS-Discovery socket error: ${err.message}`)
      })

      // Close socket after timeout
      setTimeout(() => {
        try { socket.close() } catch { /* already closed */ }
        resolve(cameras)
      }, timeoutMs + 500)
    })
  }

  // ── TCP Port Scan ──────────────────────────────────────────────────────────

  private async tcpScan(
    subnet: string,
    timeoutMs: number,
    concurrency: number,
  ): Promise<DiscoveredCamera[]> {
    // Build all {ip, port} probes
    const targets: Array<{ ip: string; port: number }> = []
    for (let i = 1; i <= 254; i++) {
      const ip = `${subnet}.${i}`
      for (const port of this.CAMERA_PORTS) {
        targets.push({ ip, port })
      }
    }

    const results = new Map<string, DiscoveredCamera>()

    // Process in batches (concurrency limit)
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency)
      const probes = batch.map(({ ip, port }) =>
        tcpProbe(ip, port, timeoutMs).then(async (open) => {
          if (!open) return

          let entry = results.get(ip)
          if (!entry) {
            entry = {
              ipAddress: ip,
              ports: [],
              discoveryMethod: 'tcp-scan',
            }
            results.set(ip, entry)
          }
          entry.ports.push(port)

          // If HTTP port, do further fingerprinting
          if ((port === 80 || port === 8080) && !entry.manufacturer) {
            const resp = await httpProbe(ip, port, timeoutMs).catch(() => null)
            if (resp) {
              const mfr = detectManufacturerFromHttp(resp.server, resp.body)
              if (mfr) {
                entry.manufacturer = mfr
                // Build best-guess RTSP URL based on manufacturer
                if (mfr === 'Hikvision') {
                  entry.rtspUrl = `rtsp://admin:admin@${ip}:554/Streaming/Channels/101`
                } else if (mfr === 'Tiandy') {
                  entry.rtspUrl = `rtsp://admin:admin@${ip}:554/stream1`
                } else {
                  entry.rtspUrl = `rtsp://admin:admin@${ip}:554/stream1`
                }
              }
            }
          }

          // RTSP port open — ensure RTSP URL is set
          if ((port === 554 || port === 8554) && !entry.rtspUrl) {
            entry.rtspUrl = `rtsp://admin:admin@${ip}:${port}/stream1`
          }
        }),
      )
      await Promise.all(probes)
    }

    return Array.from(results.values())
  }
}
