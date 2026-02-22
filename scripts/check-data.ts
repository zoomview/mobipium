import { prisma } from './lib/prisma'

async function main() {
  const result = await prisma.offer.aggregate({
    _max: {
      updatedAt: true,
    },
    _count: {
      id: true,
    }
  })
  console.log('Last update:', result._max.updatedAt)
  console.log('Total offers:', result._count.id)
  
  await prisma.$disconnect()
}

main().catch(console.error)
