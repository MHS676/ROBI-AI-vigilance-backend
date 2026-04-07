import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets'
import { Logger, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Server, Socket } from 'socket.io'
import { Role } from '@prisma/client'
import {
  ROOM_SUPER_ADMIN,
  roomForCenter,
  WS_EVENTS,
  WS_CLIENT_EVENTS,
  AlertSeverity,
} from '../mqtt/mqtt.constants'
import {
  WsEventEnvelope,
  WifiSensingPayload,
  AiResultsPayload,
  AudioLevelPayload,
  DeviceStatusPayload,
} from '../mqtt/interfaces/mqtt-payload.interface'

// ─────────────────────────────────────────────────────────────────────────────
// EventsGateway
//
// Socket.io gateway mounted at namespace `/events`.
// Clients authenticate by passing their JWT in the socket handshake:
//
//   const socket = io('/events', {
//     auth: { token: '<access_token>' }
//     // OR: extraHeaders: { authorization: 'Bearer <access_token>' }
//   })
//
// On connect, the server validates the JWT, extracts role + centerId, and
// automatically joins the socket to the correct rooms:
//
//   SUPER_ADMIN  → room:super_admin
//   ADMIN/AGENT  → room:center:{centerId}
//
// The MqttController uses the emit* helpers below to broadcast events to
// exactly the right audience — SUPER_ADMIN room + the affected center's room.
// ─────────────────────────────────────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string
    email: string
    role: Role
    centerId: string | null
  }
}

@Injectable()
@WebSocketGateway({
  namespace: '/events',
  cors: {
    origin: (process.env.CORS_ORIGINS ?? '*').split(','),
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server

  private readonly logger = new Logger(EventsGateway.name)

  constructor(private readonly jwtService: JwtService) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  afterInit(server: Server) {
    this.logger.log('🔌 EventsGateway initialised — Socket.io namespace /events ready')
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      // ── 1. Extract token ────────────────────────────────────────────────
      const raw =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.headers?.authorization as string | undefined)

      if (!raw) throw new Error('No token provided')

      const token = raw.startsWith('Bearer ') ? raw.slice(7) : raw

      // ── 2. Verify JWT ───────────────────────────────────────────────────
      const payload = this.jwtService.verify<{
        sub: string
        email: string
        role: Role
        centerId: string | null
      }>(token)

      // ── 3. Store user data on socket ────────────────────────────────────
      client.data = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        centerId: payload.centerId ?? null,
      }

      // ── 4. Join rooms ────────────────────────────────────────────────────
      if (payload.role === Role.SUPER_ADMIN) {
        await client.join(ROOM_SUPER_ADMIN)
        this.logger.log(
          `✅ [SUPER_ADMIN] ${payload.email} connected → joined ${ROOM_SUPER_ADMIN} (socket: ${client.id})`,
        )
      } else if (payload.centerId) {
        const centerRoom = roomForCenter(payload.centerId)
        await client.join(centerRoom)
        this.logger.log(
          `✅ [${payload.role}] ${payload.email} connected → joined ${centerRoom} (socket: ${client.id})`,
        )
      } else {
        // ADMIN/AGENT without centerId — should never happen but guard anyway
        this.logger.warn(
          `⚠️  [${payload.role}] ${payload.email} has no centerId — no room joined (socket: ${client.id})`,
        )
      }

      // ── 5. Acknowledge connection ────────────────────────────────────────
      client.emit(WS_EVENTS.CONNECTED, {
        message: 'Connected to Falcon Security real-time events',
        userId: payload.sub,
        role: payload.role,
        centerId: payload.centerId,
        rooms: Array.from(client.rooms),
        serverTime: new Date().toISOString(),
      })
    } catch (err: any) {
      this.logger.warn(`❌ Socket connection rejected — ${err?.message} (socket: ${client.id})`)
      client.emit(WS_EVENTS.ERROR, {
        message: 'Authentication failed — connection will be closed',
        reason: err?.message ?? 'Unknown error',
      })
      client.disconnect(true)
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const user = client.data?.email ?? 'unknown'
    this.logger.log(`🔌 Client disconnected: ${user} (socket: ${client.id})`)
  }

  // ── Client-initiated room management ─────────────────────────────────────
  // SUPER_ADMINs may join additional center rooms to narrow their feed.

  @SubscribeMessage(WS_CLIENT_EVENTS.JOIN_ROOM)
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { room: string },
  ) {
    if (!body?.room) throw new WsException('room is required')

    // Only SUPER_ADMIN can manually join arbitrary rooms
    if (client.data?.role !== Role.SUPER_ADMIN) {
      throw new WsException('Only SUPER_ADMIN can join arbitrary rooms')
    }

    await client.join(body.room)
    this.logger.log(`🚪 ${client.data.email} joined room: ${body.room}`)
    return { joined: body.room }
  }

  @SubscribeMessage(WS_CLIENT_EVENTS.LEAVE_ROOM)
  async handleLeaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { room: string },
  ) {
    if (!body?.room) throw new WsException('room is required')

    // Prevent leaving the auto-joined room
    const autoRoom =
      client.data?.role === Role.SUPER_ADMIN
        ? ROOM_SUPER_ADMIN
        : client.data?.centerId
          ? roomForCenter(client.data.centerId)
          : null

    if (body.room === autoRoom) {
      throw new WsException(`Cannot leave your primary room: ${autoRoom}`)
    }

    await client.leave(body.room)
    this.logger.log(`🚪 ${client.data?.email} left room: ${body.room}`)
    return { left: body.room }
  }

  // ── Public emit helpers (called by MqttController) ────────────────────────

  /**
   * Emit to the SUPER_ADMIN room only.
   * Used when an event concerns global oversight (all 105 centers).
   */
  emitToSuperAdmin<T>(event: string, payload: WsEventEnvelope<T>): void {
    this.server.to(ROOM_SUPER_ADMIN).emit(event, payload)
  }

  /**
   * Emit to a specific center's room only.
   * Used when ADMIN/AGENT of that center need the update.
   */
  emitToCenter<T>(centerId: string, event: string, payload: WsEventEnvelope<T>): void {
    this.server.to(roomForCenter(centerId)).emit(event, payload)
  }

  /**
   * THE CORE EMIT METHOD — broadcasts to both:
   *   1. `room:super_admin` — so the global SUPER_ADMIN dashboard updates
   *   2. `room:center:{centerId}` — so the local ADMIN for that center sees it
   *
   * This is used for every sensor / AI event arriving from MQTT.
   */
  emitToCenterAndSuperAdmin<T>(
    centerId: string,
    event: string,
    payload: WsEventEnvelope<T>,
  ): void {
    this.server
      .to(ROOM_SUPER_ADMIN)
      .to(roomForCenter(centerId))
      .emit(event, payload)

    this.logger.debug(
      `📡 ${event} → [${ROOM_SUPER_ADMIN}] + [${roomForCenter(centerId)}] ` +
        `| center: ${payload.centerName} | severity: ${payload.severity}`,
    )
  }

  /**
   * Build a typed envelope ready for emission.
   * Adds serverTime + severity so callers don't have to repeat boilerplate.
   */
  buildEnvelope<T>(
    centerId: string,
    centerName: string,
    severity: AlertSeverity,
    data: T,
  ): WsEventEnvelope<T> {
    return {
      serverTime: new Date().toISOString(),
      severity,
      centerId,
      centerName,
      data,
    }
  }

  // ── Diagnostic helpers ────────────────────────────────────────────────────

  /** Returns the number of sockets currently in a room */
  async roomSize(room: string): Promise<number> {
    const sockets = await this.server.in(room).fetchSockets()
    return sockets.length
  }

  /** Returns all active rooms and their socket counts */
  async getRoomStats(): Promise<Record<string, number>> {
    const rooms = this.server.sockets.adapter.rooms
    const stats: Record<string, number> = {}
    for (const [room, set] of rooms.entries()) {
      // Skip individual socket rooms (which equal the socket ID)
      if (!room.startsWith('room:')) continue
      stats[room] = set.size
    }
    return stats
  }
}
