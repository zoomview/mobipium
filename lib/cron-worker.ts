import { prisma } from '@/lib/prisma'
import { fetchOffers, parseLastConv, lastConvToDate, MobipiumOffer } from '@/lib/mobipium'
import { sendAlertEmail, AlertData } from '@/lib/alert'
import pLimit from 'p-limit'
import type { CronJobResult, CronJobData } from '@/lib/queue'

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
    
    const isRateLimit = error instanceof Error && 
      (error.message.includes('429') || 
       error.message.includes('rate limit') ||
       error.message.includes('Too Many Requests'))
    
    if (isRateLimit) {
      console.log(`[Retry] Rate limited, waiting ${delay}ms before retry...`)
      await new Promise(r => setTimeout(r, delay))
      return fetchWithRetry(fn, retries - 1, delay * 2)
    }
    
    throw error
  }
}

// ============ 检查告警条件 ============
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

// ============ 统一的数据处理和保存逻辑 ============
// createSnapshots: 是否创建快照（FULL任务跳过，HIGH任务保留）
async function processAndSaveOffers(
  allOffers: MobipiumOffer[], 
  startTime: number,
  jobType: 'HIGH' | 'FULL',
  createSnapshots: boolean = true
): Promise<CronJobResult> {
  console.log(`[Cron Worker] Processing ${allOffers.length} offers for ${jobType} job...`)

  // 1. 获取历史快照
  const offerIdsList = allOffers.map(o => o.offer_id)
  const existingSnapshots = await prisma.offerSnapshot.findMany({
    where: { offerId: { in: offerIdsList } },
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

  // 2. 处理所有 Offer
  const processOffer = async (offer: MobipiumOffer): Promise<ProcessedOffer> => {
    const payout = parseFloat(offer.payout) || 0
    const dailyCap = parseInt(offer.daily_cap, 10) || null
    const filledCap = parseInt(offer.filled_cap, 10) || null
    const lastConvDate = lastConvToDate(offer.last_conv)
    const lastConvMinutes = parseLastConv(offer.last_conv)
    const previousSnapshot = latestSnapshots.get(offer.offer_id) || null

    const hasChanged = !previousSnapshot || 
      previousSnapshot.lastConvRaw !== offer.last_conv ||
      previousSnapshot.status !== offer.status

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

  // 3. 批量写入数据库
  const BATCH_SIZE = 100
  let newSnapshots = 0
  
  console.log(`[Cron Worker] Batch writing to database...`)
  
  for (let i = 0; i < processedOffers.length; i += BATCH_SIZE) {
    const batch = processedOffers.slice(i, i + BATCH_SIZE)
    
    // Upsert Offers (并发执行)
    const upsertPromises = batch.map(async (processed) => {
      const { offer, payout, dailyCap, filledCap, lastConvDate, lastConvMinutes } = processed
      
      const hasConversion = lastConvMinutes !== null
      const now = new Date()
      let isRecentConversion = false
      if (lastConvDate && hasConversion) {
        const hoursDiff = (now.getTime() - lastConvDate.getTime()) / (1000 * 60 * 60)
        isRecentConversion = hoursDiff <= 24
      }
      
      const newPriority = isRecentConversion ? 'HIGH' : 'LOW'
      
      return prisma.offer.upsert({
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
          lastConversionAt: hasConversion ? now : null,
          priority: newPriority,
        },
      })
    })
    
    // 并发执行所有 upsert
    await Promise.all(upsertPromises)

    // 创建 Snapshots (仅 HIGH 任务创建，FULL 任务跳过)
    if (createSnapshots) {
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
    }

    console.log(`[Cron Worker] Written batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(processedOffers.length/BATCH_SIZE)}`)
  }

  // 4. 处理告警
  console.log(`[Cron Worker] Checking alerts for ${processedOffers.length} offers...`)
  
  const offersWithChanges = processedOffers.filter(p => p.hasChanged && p.previousSnapshot)
  const alertLimit = pLimit(5)
  
  let alertsSent = 0

  const recentAlerts = await prisma.offerSnapshot.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    },
    select: { offerId: true },
    distinct: ['offerId'],
  })
  const alertedOfferIds = new Set(recentAlerts.map(a => a.offerId))

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

  const alertsToSend = alertResults.filter(r => r.shouldAlert && r.alertData)
  
  if (alertsToSend.length > 0) {
    console.log(`[Cron Worker] Sending ${alertsToSend.length} alert emails...`)
    
    await Promise.all(
      alertsToSend.map(async (alert) => {
        if (alert.alertData) {
          const sent = await sendAlertEmail(alert.alertData)
          if (sent) {
            alertsSent++
            console.log(`[Alert] ${alert.alertType}: ${alert.alertData.offerName}`)
          }
        }
      })
    )
  }

  const elapsed = Date.now() - startTime
  console.log(`[Cron Worker] ${jobType} job completed in ${elapsed}ms. Offers: ${allOffers.length}, Snapshots: ${newSnapshots}, Alerts: ${alertsSent}`)

  return {
    success: true,
    offersProcessed: allOffers.length,
    offersFetched: allOffers.length,
    newSnapshots,
    alertsSent,
    elapsedMs: elapsed,
  }
}

// ============ 处理任务入口（根据 type 选择处理方式）============
export async function processCronJob(data: CronJobData): Promise<CronJobResult> {
  if (data.type === 'HIGH') {
    return processHighPriorityJob(data)
  } else {
    return processFullSyncJob(data)
  }
}

// ============ 处理 HIGH 优先级任务 ============
// 从 ConversionList 获取有转化的 offer，进行监控
async function processHighPriorityJob(data: CronJobData): Promise<CronJobResult> {
  const startTime = Date.now()
  console.log('[Cron Worker] Starting HIGH priority job...')

  try {
    const status = data.status || 'Active'
    const concurrency = data.concurrency || 10

    let allOffers: MobipiumOffer[] = []

    // 从 ConversionList 获取有转化的 offer ID
    const conversionList = await prisma.conversionList.findMany({
      select: { offerId: true },
    })
    const offerIdList = conversionList.map((c: { offerId: string }) => c.offerId)
    console.log(`[Cron Worker] HIGH: Got ${offerIdList.length} offers from ConversionList`)
    
    if (offerIdList.length > 0) {
      const limit = pLimit(concurrency)
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
            console.log(`[Cron Worker] HIGH: Batch ${index + 1}/${batches.length}: got ${offers.length} offers`)
            return offers
          })
        })
      }
      
      const results = await Promise.all(batches.map((batch, i) => fetchBatch(batch, i)))
      allOffers = results.flat()
    }

    console.log(`[Cron Worker] HIGH: Fetched ${allOffers.length} offers total`)

    // HIGH 任务需要创建快照（用于告警比对）
    const result = await processAndSaveOffers(allOffers, startTime, 'HIGH', true)
    
    // HIGH 任务完成后替换转化列表（使用 ConversionList 表）
    if (allOffers.length > 0) {
      const convertedOfferIds = allOffers
        .filter(o => o.last_conv && o.last_conv !== null)
        .map(o => o.offer_id)
      
      if (convertedOfferIds.length > 0) {
        await prisma.conversionList.deleteMany({})
        const uniqueIds = [...new Set(convertedOfferIds)]
        await prisma.conversionList.createMany({
          data: uniqueIds.map(id => ({ offerId: id })),
          skipDuplicates: true
        })
        console.log(`[Cron Worker] HIGH: Conversion list updated: ${uniqueIds.length} offers`)
      }
    }

    return result

  } catch (error) {
    console.error('[Cron Worker] HIGH Error:', error)
    throw error
  }
}

// ============ 处理 FULL 同步任务 ============
// 全量抓取，更新 Offer 表和 ConversionList
async function processFullSyncJob(data: CronJobData): Promise<CronJobResult> {
  const startTime = Date.now()
  const startPage = data.startPage || 1
  const endPage = data.endPage || 10
  console.log(`[Cron Worker] FULL: Starting sync job for pages ${startPage}-${endPage}...`)

  try {
    const concurrency = data.concurrency || 10
    const usePerformanceSort = data.usePerformanceSort ?? true
    const status = data.status || 'Active'

    let allOffers: MobipiumOffer[] = []
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
          console.log(`[Cron Worker] FULL: Page ${pageNum}: got ${offers.length} offers`)
          return offers
        })
      })
    }

    const pages = Array.from(
      { length: endPage - startPage + 1 },
      (_, i) => startPage + i
    )

    console.log(`[Cron Worker] FULL: Fetching ${pages.length} pages with concurrency ${concurrency}...`)
    
    const results = await Promise.all(pages.map(fetchPageWithRetry))
    allOffers = results.flat()

    console.log(`[Cron Worker] FULL: Fetched ${allOffers.length} offers total`)

    // FULL 任务跳过快照创建（只更新 Offer 表，提高性能）
    const result = await processAndSaveOffers(allOffers, startTime, 'FULL', false)

    // FULL 任务：累加到转化列表，删除已无转化的 offer
    if (allOffers.length > 0) {
      // 获取本次抓取中有转化的 offer ID
      const convertedOfferIds = allOffers
        .filter(o => o.last_conv && o.last_conv !== null)
        .map(o => o.offer_id)
      
      // 获取本次抓取中无转化的 offer ID（需要从 ConversionList 删除）
      const notConvertedOfferIds = allOffers
        .filter(o => !o.last_conv || o.last_conv === null)
        .map(o => o.offer_id)
      
      // 1. 添加新的有转化 offer
      if (convertedOfferIds.length > 0) {
        const uniqueIds = [...new Set(convertedOfferIds)]
        await prisma.conversionList.createMany({
          data: uniqueIds.map(id => ({ offerId: id })),
          skipDuplicates: true
        })
        console.log(`[Cron Worker] FULL: Added ${uniqueIds.length} offers to conversion list`)
      }
      
      // 2. 删除已无转化的 offer
      if (notConvertedOfferIds.length > 0) {
        const deleteResult = await prisma.conversionList.deleteMany({
          where: { offerId: { in: notConvertedOfferIds } }
        })
        if (deleteResult.count > 0) {
          console.log(`[Cron Worker] FULL: Removed ${deleteResult.count} offers without conversion`)
        }
      }
    }

    return result

  } catch (error) {
    console.error('[Cron Worker] FULL Error:', error)
    throw error
  }
}
