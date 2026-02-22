import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const offers = await prisma.offer.count()
    const snapshots = await prisma.offerSnapshot.count()
    
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const alertsLast24h = await prisma.alertHistory.count({
      where: { sentAt: { gte: oneDayAgo } }
    })
    
    const oldestSnapshot = await prisma.offerSnapshot.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true }
    })
    
    const newestSnapshot = await prisma.offerSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    })
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const activeOffers = await prisma.offer.count({
      where: { lastConv: { gte: oneHourAgo } }
    })
    
    // 业务分级统计
    const highPriorityOffers = await prisma.offer.count({
      where: { priority: 'HIGH' }
    })
    
    const lowPriorityOffers = await prisma.offer.count({
      where: { priority: 'LOW' }
    })
    
    const offersWithConversion = await prisma.offer.count({
      where: { hasConversion: true }
    })
    
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: { 
        offers, 
        snapshots, 
        alertsLast24h, 
        activeOffersLast1h: activeOffers,
        oldestSnapshot: oldestSnapshot?.createdAt || null,
        newestSnapshot: newestSnapshot?.createdAt || null,
        // 业务分级统计
        priority: {
          high: highPriorityOffers,
          low: lowPriorityOffers
        },
        hasConversion: offersWithConversion
      }
    })
  } catch (error) {
    return NextResponse.json({ 
      status: 'error', 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}
