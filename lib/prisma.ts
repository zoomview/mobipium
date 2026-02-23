import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

// 定期保持连接活跃
setInterval(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    // 静默重连
    await prisma.$connect()
  }
}, 30000) // 每30秒检查一次

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
