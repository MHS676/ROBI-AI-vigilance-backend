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

  const agent2 = await prisma.user.upsert({
    where: { email: 'agent.t2@falconsecurity.ng' },
    update: {},
    create: {
      email: 'agent.t2@falconsecurity.ng',
      password: await bcrypt.hash('Falcon@Agent2024!', 12),
      firstName: 'Jane',
      lastName: 'Smith',
      role: Role.AGENT,
      centerId: center.id,
      isActive: true,
    },
  })
  console.log(`✅ Agent 2 created: ${agent2.email}`)

  const agent3 = await prisma.user.upsert({
    where: { email: 'agent.t3@falconsecurity.ng' },
    update: {},
    create: {
      email: 'agent.t3@falconsecurity.ng',
      password: await bcrypt.hash('Falcon@Agent2024!', 12),
      firstName: 'Aminu',
      lastName: 'Bello',
      role: Role.AGENT,
      centerId: center.id,
      isActive: true,
    },
  })
  console.log(`✅ Agent 3 created: ${agent3.email}`)

  // -- Camera 1 ------------------------------------------
  const camera1 = await prisma.camera.upsert({
    where: { id: 'cam-seed-001' },
    update: {
      name: 'CAM-01 — Channel 1',
      rtspUrl: 'rtsp://admin:Admin0123@192.168.0.29:554/cam/realmonitor?channel=1&subtype=0',
      ipAddress: '192.168.0.29',
      model: 'Dahua DVR — Channel 1',
      status: DeviceStatus.ONLINE,
    },
    create: {
      id: 'cam-seed-001',
      name: 'CAM-01 — Channel 1',
      rtspUrl: 'rtsp://admin:Admin0123@192.168.0.29:554/cam/realmonitor?channel=1&subtype=0',
      ipAddress: '192.168.0.29',
      model: 'Dahua DVR — Channel 1',
      status: DeviceStatus.ONLINE,
      centerId: center.id,
    },
  })
  console.log(`✅ Camera 1 created: ${camera1.name}`)

  // ── Camera 2 ───────────────────────────────────────────
  const camera2 = await prisma.camera.upsert({
    where: { id: 'cam-seed-002' },
    update: {
      name: 'CAM-02 — Channel 2',
      rtspUrl: 'rtsp://admin:Admin0123@192.168.0.29:554/cam/realmonitor?channel=2&subtype=0',
      ipAddress: '192.168.0.29',
      model: 'Dahua DVR — Channel 2',
      status: DeviceStatus.ONLINE,
    },
    create: {
      id: 'cam-seed-002',
      name: 'CAM-02 — Channel 2',
      rtspUrl: 'rtsp://admin:Admin0123@192.168.0.29:554/cam/realmonitor?channel=2&subtype=0',
      ipAddress: '192.168.0.29',
      model: 'Dahua DVR — Channel 2',
      status: DeviceStatus.ONLINE,
      centerId: center.id,
    },
  })
  console.log(`✅ Camera 2 created: ${camera2.name}`)

  // ── Camera 3 ───────────────────────────────────────────
  const camera3 = await prisma.camera.upsert({
    where: { id: 'cam-seed-003' },
    update: {
      name: 'CAM-03 — Channel 3',
      rtspUrl: 'rtsp://admin:Admin0123@192.168.0.29:554/cam/realmonitor?channel=3&subtype=0',
      ipAddress: '192.168.0.29',
      model: 'Dahua DVR — Channel 3',
      status: DeviceStatus.ONLINE,
    },
    create: {
      id: 'cam-seed-003',
      name: 'CAM-03 — Channel 3',
      rtspUrl: 'rtsp://admin:Admin0123@192.168.0.29:554/cam/realmonitor?channel=3&subtype=0',
      ipAddress: '192.168.0.29',
      model: 'Dahua DVR — Channel 3',
      status: DeviceStatus.ONLINE,
      centerId: center.id,
    },
  })
  console.log(`✅ Camera 3 created: ${camera3.name}`)

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

  const microphone2 = await prisma.microphone.upsert({
    where: { id: 'mic-seed-002' },
    update: {},
    create: {
      id: 'mic-seed-002',
      name: 'MIC-TABLE-02-RIGHT',
      channel: MicrophoneChannel.RIGHT,
      ipAddress: '192.168.1.152',
      model: 'Rode NT-USB Mini',
      status: DeviceStatus.ONLINE,
      centerId: center.id,
    },
  })
  console.log(`✅ Microphone 2 created: ${microphone2.name}`)

  const microphone3 = await prisma.microphone.upsert({
    where: { id: 'mic-seed-003' },
    update: {},
    create: {
      id: 'mic-seed-003',
      name: 'MIC-TABLE-03-LEFT',
      channel: MicrophoneChannel.LEFT,
      ipAddress: '192.168.1.153',
      model: 'Rode NT-USB Mini',
      status: DeviceStatus.ONLINE,
      centerId: center.id,
    },
  })
  console.log(`✅ Microphone 3 created: ${microphone3.name}`)

  // -- Tables (Core entities) ----------------------------------------
  const table = await prisma.table.upsert({
    where: { cameraId: 'cam-seed-001' },
    update: {},
    create: {
      name: 'Table 01 - Teller A',
      tableNumber: 1,
      centerId: center.id,
      cameraId: camera1.id,
      boundingBox: { x: 120, y: 80, w: 320, h: 240 },
      microphoneId: microphone.id,
      agentId: agent.id,
      isActive: true,
    },
  })
  console.log(`✅ Table 1 created: ${table.name}`)
  console.log('   └── Camera     →', camera1.name)
  console.log('   └── BoundingBox →', JSON.stringify(table.boundingBox))
  console.log('   └── Microphone →', microphone.name, `(${microphone.channel})`)
  console.log('   └── Agent      →', agent.firstName, agent.lastName)

  const table2 = await prisma.table.upsert({
    where: { cameraId: 'cam-seed-002' },
    update: {},
    create: {
      name: 'Table 02 - Teller B',
      tableNumber: 2,
      centerId: center.id,
      cameraId: camera2.id,
      boundingBox: { x: 120, y: 80, w: 320, h: 240 },
      microphoneId: microphone2.id,
      agentId: agent2.id,
      isActive: true,
    },
  })
  console.log(`✅ Table 2 created: ${table2.name}`)
  console.log('   └── Camera     →', camera2.name)
  console.log('   └── Microphone →', microphone2.name, `(${microphone2.channel})`)
  console.log('   └── Agent      →', agent2.firstName, agent2.lastName)

  const table3 = await prisma.table.upsert({
    where: { cameraId: 'cam-seed-003' },
    update: {},
    create: {
      name: 'Table 03 - Teller C',
      tableNumber: 3,
      centerId: center.id,
      cameraId: camera3.id,
      boundingBox: { x: 120, y: 80, w: 320, h: 240 },
      microphoneId: microphone3.id,
      agentId: agent3.id,
      isActive: true,
    },
  })
  console.log(`✅ Table 3 created: ${table3.name}`)
  console.log('   └── Camera     →', camera3.name)
  console.log('   └── Microphone →', microphone3.name, `(${microphone3.channel})`)
  console.log('   └── Agent      →', agent3.firstName, agent3.lastName)

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
