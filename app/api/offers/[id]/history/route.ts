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

  // Parse last_conv to minutes (supports multiple Mobipium formats)
  const parseLastConvToMinutes = (raw: string | null): number | null => {
    if (!raw) return null
    
    const trimmed = raw.trim().toLowerCase()
    
    // 格式1: "1h18min", "6h18min" (小时+分钟)
    const hourMinMatch = trimmed.match(/^(\d+)h(\d+)min$/i)
    if (hourMinMatch) {
      const hours = parseInt(hourMinMatch[1], 10)
      const minutes = parseInt(hourMinMatch[2], 10)
      return hours * 60 + minutes
    }
    
    // 格式2: "11min", "58min", "5min" (纯分钟，min后缀)
    const minOnlyMatch = trimmed.match(/^(\d+)min$/i)
    if (minOnlyMatch) {
      return parseInt(minOnlyMatch[1], 10)
    }
    
    // 格式3: "5m", "2h", "1d" (单个字母单位)
    const simpleMatch = trimmed.match(/^(\d+)([mhd])$/i)
    if (simpleMatch) {
      const value = parseInt(simpleMatch[1], 10)
      const unit = simpleMatch[2].toLowerCase()
      switch (unit) {
        case 'm': return value
        case 'h': return value * 60
        case 'd': return value * 1440
      }
    }
    
    // 格式4: "just now", "now"
    if (trimmed === 'just now' || trimmed === 'now') {
      return 0.5
    }
    
    // 格式5: "< 1m"
    const lessThanMatch = trimmed.match(/^<\s*(\d+)([mhd])$/i)
    if (lessThanMatch) {
      const value = parseInt(lessThanMatch[1], 10)
      return value === 1 ? 0.5 : value * 0.5
    }
    
    return null
  }

  // Transform data for chart
  const chartData = snapshots.map((snapshot) => {
    const minutes = parseLastConvToMinutes(snapshot.lastConvRaw)

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
