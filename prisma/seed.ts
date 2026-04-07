import { PrismaClient, Role, MicrophoneChannel, DeviceStatus } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding Falcon Security Limited database...')

  // ── Super Admin ──────────────────────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@falconsecurity.ng' },
    update: {},
    create: {
      email: 'superadmin@falconsecurity.ng',
      password: await bcrypt.hash('Falcon@SuperAdmin2024!', 12),
      firstName: 'Super',
      lastName: 'Admin',
      role: Role.SUPER_ADMIN,
      isActive: true,
    },
  })
  console.log(`✅ Super Admin created: ${superAdmin.email}`)

  // ── Seed Center (Branch 001) ─────────────────────────────────
  const center = await prisma.center.upsert({
    where: { code: 'FAL-LGS-001' },
    update: {},
    create: {
      name: 'Falcon Branch — Lagos Island',
      code: 'FAL-LGS-001',
      address: '14 Broad Street',
      city: 'Lagos Island',
      state: 'Lagos',
      country: 'Nigeria',
      phone: '+234-800-FALCON-1',
      isActive: true,
    },
  })
  console.log(`✅ Center created: ${center.name}`)

  // ── Local Admin ──────────────────────────────────────────────
  const localAdmin = await prisma.user.upsert({
    where: { email: 'admin.lgs001@falconsecurity.ng' },
    update: {},
    create: {
      email: 'admin.lgs001@falconsecurity.ng',
      password: await bcrypt.hash('Falcon@Admin2024!', 12),
      firstName: 'Lagos',
      lastName: 'Admin',
      role: Role.ADMIN,
      centerId: center.id,
      isActive: true,
    },
  })
  console.log(`✅ Local Admin created: ${localAdmin.email}`)

  // ── Agent ────────────────────────────────────────────────────
  const agent = await prisma.user.upsert({
    where: { email: 'agent.t1@falconsecurity.ng' },
    update: {},
    create: {
      email: 'agent.t1@falconsecurity.ng',
      password: await bcrypt.hash('Falcon@Agent2024!', 12),
      firstName: 'John',
      lastName: 'Doe',
      role: Role.AGENT,
      centerId: center.id,
      isActive: true,
    },
  })
  console.log(`✅ Agent created: ${agent.email}`)

  // ── Camera ───────────────────────────────────────────────────
  const camera = await prisma.camera.upsert({
    where: { id: 'cam-seed-001' },
    update: {},
    create: {
      id: 'cam-seed-001',
      name: 'CAM-01 — Teller Row A',
      rtspUrl: 'rtsp://admin:falcon123@192.168.1.101:554/stream1',
      ipAddress: '192.168.1.101',
      model: 'Hikvision DS-2CD2143G2-I',
      status: DeviceStatus.ONLINE,
      centerId: center.id,
    },
  })
  console.log(`✅ Camera created: ${camera.name}`)

  // ── ESP Node ─────────────────────────────────────────────────
  const espNode = await prisma.espNode.upsert({
    where: { macAddress: 'AA:BB:CC:DD:EE:01' },
    update: {},
    create: {
      name: 'ESP-NODE-LGS-001-01',
      macAddress: 'AA:BB:CC:DD:EE:01',
      ipAddress: '192.168.1.201',
      firmwareVer: 'v2.1.4',
      status: DeviceStatus.ONLINE,
      centerId: center.id,
    },
  })
  console.log(`✅ EspNode created: ${espNode.name}`)

  // ── Microphone ───────────────────────────────────────────────
  const microphone = await prisma.microphone.upsert({
    where: { id: 'mic-seed-001' },
    update: {},
    create: {
      id: 'mic-seed-001',
      name: 'MIC-TABLE-01-LEFT',
      channel: MicrophoneChannel.LEFT,
      ipAddress: '192.168.1.151',
      model: 'Rode NT-USB Mini',
      status: DeviceStatus.ONLINE,
      centerId: center.id,
    },
  })
  console.log(`✅ Microphone created: ${microphone.name}`)

  // ── Table (Core entity) ──────────────────────────────────────
  const table = await prisma.table.upsert({
    where: { cameraId: 'cam-seed-001' },
    update: {},
    create: {
      name: 'Table 01 — Teller A',
      tableNumber: 1,
      centerId: center.id,
      cameraId: camera.id,
      boundingBox: { x: 120, y: 80, w: 320, h: 240 },
      microphoneId: microphone.id,
      agentId: agent.id,
      isActive: true,
    },
  })
  console.log(`✅ Table created: ${table.name}`)
  console.log('   └── Camera     →', camera.name)
  console.log('   └── BoundingBox →', JSON.stringify(table.boundingBox))
  console.log('   └── Microphone →', microphone.name, `(${microphone.channel})`)
  console.log('   └── Agent      →', agent.firstName, agent.lastName)

  console.log('\n🎉 Seed complete!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
