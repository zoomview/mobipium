import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchOffers, parseLastConv, lastConvToDate, MobipiumOffer } from '@/lib/mobipium'
import { sendAlertEmail, AlertData } from '@/lib/alert'

const ALERT_THRESHOLD_MINUTES = parseInt(process.env.ALERT_THRESHOLD_MINUTES || '10', 10)
const ALERT_MULTIPLE_THRESHOLD = parseInt(process.env.ALERT_MULTIPLE_THRESHOLD || '5', 10) // 增长倍数告警阈值

// 告警类型
type AlertType = 
  | 'conv_time_surge'      // 转化时间突然变长（从<1分钟变成>阈值）
  | 'conv_time_multiplied' // 转化时间倍数增长
  | 'conv_disappeared'     // 转化突然消失（之前有，现在没了）
  | 'status_changed'       // 状态变化

interface AlertCheckResult {
  shouldAlert: boolean
  alertType?: AlertType
  alertData?: AlertData
  message?: string
}

/**
 * 检查是否需要发送告警
 */
function checkAlertCondition(
  offer: MobipiumOffer,
  previousSnapshot: { lastConvRaw: string | null; status: string } | null,
  currentMinutes: number | null
): AlertCheckResult {
  if (!previousSnapshot) {
    return { shouldAlert: false }
  }

  const prevMinutes = parseLastConv(previousSnapshot.lastConvRaw)
  const prevStatus = previousSnapshot.status

  // 场景1: 转化突然消失 (之前有转化，现在变成 null 或无法解析)
  if (prevMinutes !== null && prevMinutes < 30 && currentMinutes === null) {
    return {
      shouldAlert: true,
      alertType: 'conv_disappeared',
      alertData: {
        offerId: offer.offer_id,
        offerName: offer.offer_name,
        previousLastConv: previousSnapshot.lastConvRaw,
        currentLastConv: offer.last_conv,
        previousMinutes: prevMinutes,
        currentMinutes: null,
      },
      message: `转化突然消失: 从 ${previousSnapshot.lastConvRaw} 变成无`,
    }
  }

  // 场景2: 状态从 Active 变成非 Active
  if (prevStatus === 'Active' && offer.status !== 'Active') {
    return {
      shouldAlert: true,
      alertType: 'status_changed',
      alertData: {
        offerId: offer.offer_id,
        offerName: offer.offer_name,
        previousLastConv: previousSnapshot.lastConvRaw,
        currentLastConv: offer.last_conv,
        previousMinutes: prevMinutes,
        currentMinutes: currentMinutes,
      },
      message: `状态变更: ${prevStatus} -> ${offer.status}`,
    }
  }

  // 场景3: 转化时间突然变长 (从 <1分钟 变成 >阈值)
  if (prevMinutes !== null && prevMinutes < 1 && currentMinutes !== null && currentMinutes > ALERT_THRESHOLD_MINUTES) {
    return {
      shouldAlert: true,
      alertType: 'conv_time_surge',
      alertData: {
        offerId: offer.offer_id,
        offerName: offer.offer_name,
        previousLastConv: previousSnapshot.lastConvRaw,
        currentLastConv: offer.last_conv,
        previousMinutes: prevMinutes,
        currentMinutes: currentMinutes,
      },
      message: `转化时间激增: ${prevMinutes}分钟 -> ${currentMinutes}分钟`,
    }
  }

  // 场景4: 转化时间倍数增长 (增长超过 ALERT_MULTIPLE_THRESHOLD 倍)
  if (
    prevMinutes !== null && 
    prevMinutes >= 1 && 
    currentMinutes !== null && 
    currentMinutes > prevMinutes * ALERT_MULTIPLE_THRESHOLD &&
    currentMinutes > ALERT_THRESHOLD_MINUTES
  ) {
    return {
      shouldAlert: true,
      alertType: 'conv_time_multiplied',
      alertData: {
        offerId: offer.offer_id,
        offerName: offer.offer_name,
        previousLastConv: previousSnapshot.lastConvRaw,
        currentLastConv: offer.last_conv,
        previousMinutes: prevMinutes,
        currentMinutes: currentMinutes,
      },
      message: `转化时间倍增: ${prevMinutes}分钟 -> ${currentMinutes}分钟 (${(currentMinutes / prevMinutes).toFixed(1)}倍)`,
    }
  }

  return { shouldAlert: false }
}

// 并发锁 - 防止多个 cron 同时执行
let isCronRunning = false
const CRON_LOCK_TIMEOUT_MS = 5 * 60 * 1000 // 5 分钟超时

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const startTime = Date.now()
  console.log('[Cron] Starting data fetch...')

  // 并发控制: 如果已经有 cron 在运行，直接返回
  if (isCronRunning) {
    console.warn('[Cron] Another cron job is already running, skipping...')
    return NextResponse.json({
      success: false,
      error: 'Another cron job is already running',
      code: 'CRON_ALREADY_RUNNING',
    }, { status: 409 })
  }

  // 设置锁
  isCronRunning = true

  // 设置超时释放锁
  const lockTimeout = setTimeout(() => {
    console.warn('[Cron] Lock timeout reached, releasing lock...')
    isCronRunning = false
  }, CRON_LOCK_TIMEOUT_MS)

  try {
    // 获取分页参数
    const { searchParams } = new URL(request.url)
    const startPage = parseInt(searchParams.get('startPage') || '1', 10)
    const maxPages = parseInt(searchParams.get('maxPages') || '10', 10)
    const concurrency = parseInt(searchParams.get('concurrency') || '3', 10) // 并发数，默认3
    
    // Fetch offers (并发抓取) - 大幅提升速度
    const maxTotalPages = 120 // Mobipium API 最多 120 页
    
    console.log(`[Cron] Starting fetch from page ${startPage}, max ${maxPages} pages, concurrency ${concurrency}`)

    // 并发抓取函数
    const fetchPage = async (pageNum: number): Promise<MobipiumOffer[]> => {
      try {
        const offers = await fetchOffers({
          status: 'Active',
          limit: 100,
          page: pageNum,
          order_by: 'Performance'
        })
        console.log(`[Cron] Fetched page ${pageNum}, got ${offers.length} offers`)
        return offers
      } catch (error) {
        console.error(`[Cron] Error fetching page ${pageNum}:`, error)
        return []
      }
    }

    // 分批并发抓取
    const allOffers: MobipiumOffer[] = []
    let totalFetched = 0
    
    while (totalFetched < maxPages) {
      const batchSize = Math.min(concurrency, maxPages - totalFetched)
      const pagesToFetch = Array.from(
        { length: batchSize }, 
        (_, i) => startPage + totalFetched + i
      ).filter(p => p <= maxTotalPages)
      
      if (pagesToFetch.length === 0) break
      
      // 并发请求
      const results = await Promise.all(pagesToFetch.map(fetchPage))
      
      for (const offers of results) {
        allOffers.push(...offers)
      }
      
      totalFetched += pagesToFetch.length
      
      console.log(`[Cron] Batch done, total: ${allOffers.length} offers`)
      
      // 如果不需要继续，提前退出
      if (totalFetched >= maxPages || startPage + totalFetched > maxTotalPages) break
    }

    console.log(`[Cron] Fetched ${allOffers.length} offers from ${totalFetched} pages`)

    // Process each offer
    let newSnapshots = 0
    let alertsSent = 0

    for (const offer of allOffers) {
      const payout = parseFloat(offer.payout) || 0
      const dailyCap = parseInt(offer.daily_cap, 10) || null
      const filledCap = parseInt(offer.filled_cap, 10) || null
      const lastConvDate = lastConvToDate(offer.last_conv)
      const lastConvMinutes = parseLastConv(offer.last_conv)

      // Upsert offer
      await prisma.offer.upsert({
        where: { id: offer.offer_id },
        create: {
          id: offer.offer_id,
          offerName: offer.offer_name,
          status: offer.status,
          country: offer.country,
          countryName: offer.country_name,
          carrier: offer.carrier,
          vertical: offer.vertical,
          flow: offer.flow,
          payout,
          currency: offer.currency,
          dailyCap,
          typeTraffic: offer.type_traffic,
          filledCap,
          lastConv: lastConvDate,
          lastConvRaw: offer.last_conv,
        },
        update: {
          offerName: offer.offer_name,
          status: offer.status,
          country: offer.country,
          countryName: offer.country_name,
          carrier: offer.carrier,
          vertical: offer.vertical,
          flow: offer.flow,
          payout,
          currency: offer.currency,
          dailyCap,
          typeTraffic: offer.type_traffic,
          filledCap,
          lastConv: lastConvDate,
          lastConvRaw: offer.last_conv,
        },
      })

      // 检查数据是否有变化，只在变化时创建快照
      const previousSnapshot = await prisma.offerSnapshot.findFirst({
        where: { offerId: offer.offer_id },
        orderBy: { createdAt: 'desc' },
      })

      const hasChanged = !previousSnapshot || 
        previousSnapshot.lastConvRaw !== offer.last_conv ||
        previousSnapshot.payout !== payout ||
        previousSnapshot.status !== offer.status ||
        previousSnapshot.filledCap !== filledCap

      // 只有数据变化时才创建快照，并检查告警
      if (hasChanged) {
        await prisma.offerSnapshot.create({
          data: {
            offerId: offer.offer_id,
            lastConv: lastConvDate,
            lastConvRaw: offer.last_conv,
            filledCap,
            payout,
            status: offer.status,
          },
        })
        newSnapshots++

        // 告警检测 - 使用变化前的快照
        const alertResult = checkAlertCondition(offer, previousSnapshot, lastConvMinutes)

        if (alertResult.shouldAlert && alertResult.alertData) {
          // Check if we already sent an alert in the last 24 hours
          const recentAlert = await prisma.alertHistory.findFirst({
            where: {
              offerId: offer.offer_id,
              sentAt: {
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // last 24 hours
              },
            },
          })

          if (!recentAlert) {
            const sent = await sendAlertEmail(alertResult.alertData)

            if (sent) {
              await prisma.alertHistory.create({
                data: {
                  offerId: offer.offer_id,
                  offerName: offer.offer_name,
                  message: alertResult.message || '转化异常',
                },
              })
              alertsSent++
              console.log(`[Alert] ${alertResult.alertType}: ${offer.offer_name} - ${alertResult.message}`)
            }
          }
        }
      }
    }

    const elapsed = Date.now() - startTime
    console.log(`[Cron] Completed in ${elapsed}ms. New snapshots: ${newSnapshots}, Alerts: ${alertsSent}`)

    return NextResponse.json({
      success: true,
      offersProcessed: allOffers.length,
      pagesFetched: totalFetched,
      startPage: startPage,
      hasMore: startPage + totalFetched < maxTotalPages,
      newSnapshots,
      alertsSent,
      elapsedMs: elapsed,
    })
  } catch (error) {
    console.error('[Cron] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  } finally {
    // 释放锁
    clearTimeout(lockTimeout)
    isCronRunning = false
    console.log('[Cron] Lock released')
  }
}
