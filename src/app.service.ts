import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma/prisma.service'

@Injectable()
export class AppService {
  constructor(private prisma: PrismaService) {}

  getHealth() {
    return {
      status: 'ok',
      app: 'Falcon Security Limited — AI Surveillance API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    }
  }

  async getStats() {
    const [centers, cameras, espNodes, microphones, tables, users] =
      await Promise.all([
        this.prisma.center.count({ where: { isActive: true } }),
        this.prisma.camera.count({ where: { isActive: true } }),
        this.prisma.espNode.count({ where: { isActive: true } }),
        this.prisma.microphone.count({ where: { isActive: true } }),
        this.prisma.table.count({ where: { isActive: true } }),
        this.prisma.user.count({ where: { isActive: true } }),
      ])

    return {
      centers,
      cameras,
      espNodes,
      microphones,
      tables,
      users,
    }
  }
}
