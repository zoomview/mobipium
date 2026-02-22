import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(request.url)
  
  // Get offer ID from URL
  const offerId = params.id
  
  // Time range filter (hours)
  const hours = parseInt(searchParams.get('hours') || '24', 10)
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)

  // Limit snapshots
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500)

  // First check if offer exists
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
  })

  if (!offer) {
    return NextResponse.json(
      { success: false, error: 'Offer not found' },
      { status: 404 }
    )
  }

  // Get historical snapshots
  const snapshots = await prisma.offerSnapshot.findMany({
    where: {
      offerId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      lastConv: true,
      lastConvRaw: true,
      filledCap: true,
      payout: true,
      status: true,
      createdAt: true,
    },
  })

  // Transform data for chart
  const chartData = snapshots.map((snapshot) => {
    // Parse last_conv to minutes
    let minutes: number | null = null
    if (snapshot.lastConvRaw) {
      const match = snapshot.lastConvRaw.match(/^(\d+)([mhd])$/i)
      if (match) {
        const value = parseInt(match[1], 10)
        const unit = match[2].toLowerCase()
        switch (unit) {
          case 'm': minutes = value; break
          case 'h': minutes = value * 60; break
          case 'd': minutes = value * 1440; break
        }
      }
    }

    return {
      time: snapshot.createdAt.toISOString(),
      lastConvRaw: snapshot.lastConvRaw,
      lastConvMinutes: minutes,
      filledCap: snapshot.filledCap,
      payout: snapshot.payout,
    }
  })

  return NextResponse.json({
    success: true,
    offer: {
      id: offer.id,
      offerName: offer.offerName,
    },
    data: chartData,
    meta: {
      hours,
      snapshotsCount: snapshots.length,
    },
  })
}
