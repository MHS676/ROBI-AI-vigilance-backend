import path from 'node:path'
import { defineConfig } from 'prisma/config'
import 'dotenv/config'

// ============================================================
// FALCON SECURITY LIMITED — Prisma 7 Configuration
// Separates the connection URL from schema.prisma (Prisma 7+)
// ============================================================

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  migrate: {
    async adapter() {
      const { PrismaPg } = await import('@prisma/adapter-pg')
      const { Pool } = await import('pg')

      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl:
          process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: false }
            : false,
      })

      return new PrismaPg(pool)
    },
  },
})
