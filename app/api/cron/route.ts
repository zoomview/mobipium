import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchOffers, parseLastConv, lastConvToDate, MobipiumOffer } from '@/lib/mobipium'
import { sendAlertEmail, AlertData } from '@/lib/alert'
import pLimit from 'p-limit'

const ALERT_THRESHOLD_MINUTES = parseInt(process.env.ALERT_THRESHOLD_MINUTES || '10', 10)
const ALERT_MULTIPLE_THRESHOLD = parseInt(process.env.ALERT_MULTIPLE_THRESHOLD || '5', 10)

// 告警类型
type AlertType = 
  | 'conv_time_surge'
  | 'conv_time_multiplied'
  | 'conv_disappeared'
  | 'status_changed'

interface AlertCheckResult {
  shouldAlert: boolean
  alertType?: AlertType
  alertData?: AlertData
  message?: string
}

// ============ 指数退避重试函数 ============
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = BASE_DELAY_MS
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (retries <= 0) throw error
    
    // 检查是否是限流错误
    const isRateLimit = error instanceof Error && 
      (error.message.includes('429') || 
       error.message.includes('rate limit') ||
       error.message.includes('Too Many Requests'))
    
    if (isRateLimit) {
      console.log(`[Retry] Rate limited, waiting ${delay}ms before retry...`)
      await new Promise(r => setTimeout(r, delay))
      return fetchWithRetry(fn, retries - 1, delay * 2) // 指数退避
    }
    
    throw error
  }
}

// ============ 检查是否需要告警 ============
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

  // 场景1: 转化突然消失
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

  // 场景2: 状态变化
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

  // 场景3: 转化时间激增
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

  // 场景4: 转化时间倍增
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

// ============ 处理单个Offer ============
interface ProcessedOffer {
  offer: MobipiumOffer
  payout: number
  dailyCap: number | null
  filledCap: number | null
  lastConvDate: Date | null
  lastConvMinutes: number | null
  previousSnapshot: { lastConvRaw: string | null; status: string } | null
  hasChanged: boolean
}

// 并发锁
let isCronRunning = false
const CRON_LOCK_TIMEOUT_MS = 10 * 60 * 1000 // 10 分钟超时

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const startTime = Date.now()
  console.log('[Cron] Starting optimized data fetch...')

  // 并发控制
  if (isCronRunning) {
    console.warn('[Cron] Another cron job is already running, skipping...')
    return NextResponse.json({
      success: false,
      error: 'Another cron job is already running',
      code: 'CRON_ALREADY_RUNNING',
    }, { status: 409 })
  }

  isCronRunning = true
  const lockTimeout = setTimeout(() => {
    console.warn('[Cron] Lock timeout reached, releasing lock...')
    isCronRunning = false
  }, CRON_LOCK_TIMEOUT_MS)

  try {
    // 参数
    const startPage = parseInt(searchParams.get('startPage') || '1', 10)
    const maxPages = parseInt(searchParams.get('maxPages') || '50', 10)
    const concurrency = parseInt(searchParams.get('concurrency') || '10', 10) // 默认10并发
    const usePerformanceSort = searchParams.get('usePerformanceSort') !== 'false'
    const maxTotalPages = 120
    
    // 业务分级参数
    const priority = searchParams.get('priority') || 'ALL' // HIGH / LOW / ALL
    const status = searchParams.get('status') || 'Active'
    
    // 新增：按offer ID列表抓取
    const offerIdsParam = searchParams.get('offerIds') // 逗号分隔的offer ID
    
    // 新增：自动按priority抓取 - 从数据库获取priority对应的offer ID列表
    const fetchByPriority = searchParams.get('fetchByPriority') // HIGH / LOW / ALL
    
    console.log(`[Cron] Priority mode: ${priority}, Status: ${status}, fetchByPriority: ${fetchByPriority}`)

    console.log(`[Cron] Config: pages=${maxPages}, concurrency=${concurrency}, sort=${usePerformanceSort ? 'Performance' : 'default'}`)

    let allOffers: MobipiumOffer[] = []

    // ============ 模式0: 从转化列表获取offer ============
    if (fetchByPriority === 'HIGH') {
      // 从转化列表获取有转化的offer ID
      const conversionList = await prisma.conversionList.findMany({
        select: { offerId: true }
      })
      const offerIdList = conversionList.map(c => c.offerId)
      console.log(`[Cron] Fetch from conversion list: ${offerIdList.length} offers`)
      
      if (offerIdList.length > 0) {
        const limit = pLimit(concurrency)
        
        // 分批查询，每批最多50个ID
        const BATCH_SIZE = 50
        const batches: string[][] = []
        for (let i = 0; i < offerIdList.length; i += BATCH_SIZE) {
          batches.push(offerIdList.slice(i, i + BATCH_SIZE))
        }
        
        const fetchBatch = async (batch: string[], index: number): Promise<MobipiumOffer[]> => {
          return limit(async () => {
            return fetchWithRetry(async () => {
              const offers = await fetchOffers({
                status,
                offers: batch.join(','),
              })
              console.log(`[Cron] Batch ${index + 1}/${batches.length}: got ${offers.length} offers`)
              return offers
            })
          })
        }
        
        const results = await Promise.all(batches.map((batch, i) => fetchBatch(batch, i)))
        allOffers = results.flat()
      }
    }
    // ============ 模式1: 按offer ID列表抓取（优先） ============
    else if (offerIdsParam) {
      const offerIdList = offerIdsParam.split(',').filter(id => id.trim())
      console.log(`[Cron] Fetching by offer IDs: ${offerIdList.length} offers`)
      
      const limit = pLimit(concurrency)
      
      // 分批查询，每批最多50个ID
      const BATCH_SIZE = 50
      const batches: string[][] = []
      for (let i = 0; i < offerIdList.length; i += BATCH_SIZE) {
        batches.push(offerIdList.slice(i, i + BATCH_SIZE))
      }
      
      const fetchBatch = async (batch: string[], index: number): Promise<MobipiumOffer[]> => {
        return limit(async () => {
          return fetchWithRetry(async () => {
            const offers = await fetchOffers({
              status,
              offers: batch.join(','),
            })
            console.log(`[Cron] Batch ${index + 1}/${batches.length}: got ${offers.length} offers`)
            return offers
          })
        })
      }
      
      const results = await Promise.all(batches.map((batch, i) => fetchBatch(batch, i)))
      allOffers = results.flat()
    } 
    // ============ 模式2: 按页数抓取（原有逻辑） ============
    else {
      const limit = pLimit(concurrency)
      
      const fetchPageWithRetry = async (pageNum: number): Promise<MobipiumOffer[]> => {
        return limit(async () => {
          return fetchWithRetry(async () => {
            const offers = await fetchOffers({
              status,
              limit: 100,
              page: pageNum,
              order_by: usePerformanceSort ? 'Performance' : undefined
            })
            console.log(`[Cron] Page ${pageNum}: got ${offers.length} offers`)
            return offers
          })
        })
      }

      // 生成所有页码
      const allPages = Array.from(
        { length: Math.min(maxPages, maxTotalPages - startPage + 1) },
        (_, i) => startPage + i
      ).filter(p => p <= maxTotalPages)

      console.log(`[Cron] Fetching ${allPages.length} pages with concurrency ${concurrency}...`)
      
      const results = await Promise.all(allPages.map(fetchPageWithRetry))
      allOffers = results.flat()
    }

    console.log(`[Cron] Fetched ${allOffers.length} offers total`)

    // ============ 2. 并发获取所有历史快照 ============
    console.log(`[Cron] Fetching previous snapshots for ${allOffers.length} offers...`)
    
    const offerIds = allOffers.map(o => o.offer_id)
    const existingSnapshots = await prisma.offerSnapshot.findMany({
      where: {
        offerId: { in: offerIds }
      },
      orderBy: { createdAt: 'desc' }
    })

    // 按offerId分组，只取最新的
    const latestSnapshots = new Map<string, { lastConvRaw: string | null; status: string }>()
    for (const snapshot of existingSnapshots) {
      if (!latestSnapshots.has(snapshot.offerId)) {
        latestSnapshots.set(snapshot.offerId, {
          lastConvRaw: snapshot.lastConvRaw,
          status: snapshot.status
        })
      }
    }

    // ============ 3. 并发处理所有Offer (解析数据) ============
    console.log(`[Cron] Processing ${allOffers.length} offers...`)
    
    const processOffer = async (offer: MobipiumOffer): Promise<ProcessedOffer> => {
      const payout = parseFloat(offer.payout) || 0
      const dailyCap = parseInt(offer.daily_cap, 10) || null
      const filledCap = parseInt(offer.filled_cap, 10) || null
      const lastConvDate = lastConvToDate(offer.last_conv)
      const lastConvMinutes = parseLastConv(offer.last_conv)
      const previousSnapshot = latestSnapshots.get(offer.offer_id) || null

      const hasChanged = !previousSnapshot || 
        previousSnapshot.lastConvRaw !== offer.last_conv ||
        previousSnapshot.status !== offer.status ||
        true // 简化：每次都创建快照用于追踪

      return {
        offer,
        payout,
        dailyCap,
        filledCap,
        lastConvDate,
        lastConvMinutes,
        previousSnapshot,
        hasChanged
      }
    }

    const processedOffers = await Promise.all(allOffers.map(processOffer))

    // ============ 4. 批量写入数据库 (分批) ============
    const BATCH_SIZE = 100
    let newSnapshots = 0
    
    console.log(`[Cron] Batch writing to database...`)
    
    for (let i = 0; i < processedOffers.length; i += BATCH_SIZE) {
      const batch = processedOffers.slice(i, i + BATCH_SIZE)
      
      // 分开处理：先更新 offers，再创建 snapshots
      // 不用 transaction 避免超时问题
      
      // 1. 批量 Upsert Offers (使用 for...of 串行，避免并发过高)
      for (const processed of batch) {
        const { offer, payout, dailyCap, filledCap, lastConvDate, lastConvMinutes } = processed
        
        // 业务分级：判断是否有转化
        const hasConversion = lastConvMinutes !== null
        
        // 判断是否24小时内有转化
        // lastConvDate是API返回的时间，需要和当前时间比较
        const now = new Date()
        let isRecentConversion = false
        if (lastConvDate && hasConversion) {
          const hoursDiff = (now.getTime() - lastConvDate.getTime()) / (1000 * 60 * 60)
          isRecentConversion = hoursDiff <= 24 // 24小时内
        }
        
        const newPriority = isRecentConversion ? 'HIGH' : 'LOW'
        
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
            hasConversion,
            lastConversionAt: hasConversion ? now : null,
            priority: newPriority,
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
            hasConversion,
            // 有转化时更新最后转化时间，无转化时清空
            lastConversionAt: hasConversion ? now : null,
            // 如果变成有转化或有新转化 → 提升为HIGH，24小时后无转化 → 降为LOW
            priority: newPriority,
          },
        })
      }

      // 2. 批量创建 Snapshots
      const snapshotsToCreate = batch
        .filter(p => p.hasChanged)
        .map(p => ({
          offerId: p.offer.offer_id,
          lastConv: p.lastConvDate,
          lastConvRaw: p.offer.last_conv,
          filledCap: p.filledCap,
          payout: p.payout,
          status: p.offer.status,
        }))

      if (snapshotsToCreate.length > 0) {
        await prisma.offerSnapshot.createMany({
          data: snapshotsToCreate,
        })
        newSnapshots += snapshotsToCreate.length
      }

      console.log(`[Cron] Written batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(processedOffers.length/BATCH_SIZE)}`)
    }

    // ============ 5. 批量处理告警 (限制并发) ============
    console.log(`[Cron] Checking alerts for ${processedOffers.length} offers...`)
    
    const offersWithChanges = processedOffers.filter(p => p.hasChanged && p.previousSnapshot)
    const alertLimit = pLimit(5) // 最多5个并发发送邮件
    
    let alertsSent = 0

    // 获取最近24小时已发送的告警
    const recentAlerts = await prisma.alertHistory.findMany({
      where: {
        sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      },
      select: { offerId: true }
    })
    const alertedOfferIds = new Set(recentAlerts.map(a => a.offerId))

    // 并发检查告警
    const alertResults = await Promise.all(
      offersWithChanges
        .filter(p => !alertedOfferIds.has(p.offer.offer_id))
        .map(processed => alertLimit(async () => {
          const result = checkAlertCondition(
            processed.offer,
            processed.previousSnapshot,
            processed.lastConvMinutes
          )
          return { ...result, processed }
        }))
    )

    // 发送告警邮件
    const alertsToSend = alertResults.filter(r => r.shouldAlert && r.alertData)
    
    if (alertsToSend.length > 0) {
      console.log(`[Cron] Sending ${alertsToSend.length} alert emails...`)
      
      await Promise.all(
        alertsToSend.map(async (alert) => {
          if (alert.alertData) {
            const sent = await sendAlertEmail(alert.alertData)
            if (sent) {
              await prisma.alertHistory.create({
                data: {
                  offerId: alert.alertData.offerId,
                  offerName: alert.alertData.offerName,
                  message: alert.message || '转化异常',
                },
              })
              alertsSent++
              console.log(`[Alert] ${alert.alertType}: ${alert.alertData.offerName}`)
            }
          }
        })
      )
    }

    // ============ 6. 更新转化列表 ============
    // 模式A: 全量抓取时 - 清空旧列表，插入新列表
    if (!offerIdsParam && !fetchByPriority && allOffers.length > 0) {
      const convertedOfferIds = allOffers
        .filter(o => o.last_conv && o.last_conv !== null)
        .map(o => o.offer_id)
      
      console.log(`[Cron] Updating conversion list with ${convertedOfferIds.length} offers...`)
      
      if (convertedOfferIds.length > 0) {
        await prisma.$transaction([
          prisma.conversionList.deleteMany({}),
          prisma.conversionList.createMany({
            data: convertedOfferIds.map(id => ({ offerId: id }))
          })
        ])
        console.log(`[Cron] Conversion list updated (full sync)`)
      }
    }
    
    // 模式B: HIGH priority抓取时 - 检查并移除无转化的offer
    if (fetchByPriority === 'HIGH' && allOffers.length > 0) {
      // 找出本次查询中无转化的offer
      const notConvertedOfferIds = allOffers
        .filter(o => !o.last_conv || o.last_conv === null)
        .map(o => o.offer_id)
      
      if (notConvertedOfferIds.length > 0) {
        console.log(`[Cron] Removing ${notConvertedOfferIds.length} offers without conversion from list...`)
        await prisma.conversionList.deleteMany({
          where: { offerId: { in: notConvertedOfferIds } }
        })
        console.log(`[Cron] Removed ${notConvertedOfferIds.length} offers from conversion list`)
      }
    }

    const elapsed = Date.now() - startTime
    console.log(`[Cron] Completed in ${elapsed}ms. Offers: ${allOffers.length}, Snapshots: ${newSnapshots}, Alerts: ${alertsSent}`)

    return NextResponse.json({
      success: true,
      offersProcessed: allOffers.length,
      offersFetched: allOffers.length,
      startPage,
      hasMore: false, // 按ID列表抓取时不确定是否有更多
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
    clearTimeout(lockTimeout)
    isCronRunning = false
    console.log('[Cron] Lock released')
  }
}
