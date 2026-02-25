/**
 * Cron Job Worker
 * 
 * 运行方式:
 * - 本地开发: npx tsx scripts/cron-worker.ts
 * - 生产环境: 使用独立的 Node.js 进程或服务
 * 
 * 自动执行:
 * - 每 2 分钟执行一次 HIGH 任务
 * - 每 2 分钟执行一次 FULL 任务（分页抓取）
 */

// 必须在所有 import 之前加载环境变量
import dotenv from 'dotenv'
dotenv.config()

import { cronJobQueue, addCronJob } from '../lib/queue'
import { processCronJob } from '../lib/cron-worker'

console.log('[Worker] Starting cron job worker...')

// 配置
const SCHEDULE_INTERVAL_MS = 2 * 60 * 1000 // 2分钟
const FULL_PAGES_PER_RUN = 10 // 每次抓取10页（1000条）
const MAX_FULL_PAGE = 120 // 最多120页

let currentFullStartPage = 1
let isScheduleRunning = false

// ============ 处理队列任务 ============
cronJobQueue.process(async (job) => {
  console.log(`[Worker] Job ${job.id}`, job.data)
  
  const result = await processCronJob(job.data)
  
  console.log(`[Worker] Job ${job.id} completed`, {
    type: job.data.type,
    offers: result.offersProcessed,
    snapshots: result.newSnapshots,
    alerts: result.alertsSent,
  })
  
  return result
})

// ============ 定时任务 ============
async function runScheduledJobs() {
  if (isScheduleRunning) {
    console.log('[Worker] Schedule: previous run still executing, skip...')
    return
  }
  
  isScheduleRunning = true
  console.log('[Worker] ========== Scheduled run started ==========')
  
  try {
    // 1. HIGH 任务 - 获取有转化的 offer
    console.log('[Worker] Schedule: Adding HIGH job...')
    await addCronJob({
      type: 'HIGH',
      status: 'Active',
      concurrency: 10,
    })
    
    // 2. FULL 任务 - 抓取当前页码范围
    const endPage = Math.min(currentFullStartPage + FULL_PAGES_PER_RUN - 1, MAX_FULL_PAGE)
    console.log(`[Worker] Schedule: Adding FULL job (pages ${currentFullStartPage}-${endPage})...`)
    await addCronJob({
      type: 'FULL',
      startPage: currentFullStartPage,
      endPage,
      concurrency: 10,
      usePerformanceSort: true,
      status: 'Active',
    })
    
    // 更新下次抓取页码
    currentFullStartPage = endPage + 1
    if (currentFullStartPage > MAX_FULL_PAGE) {
      currentFullStartPage = 1 // 循环重新开始
      console.log('[Worker] Schedule: FULL cycle completed, restarting from page 1')
    }
    
  } catch (error) {
    console.error('[Worker] Schedule error:', error)
  } finally {
    isScheduleRunning = false
    console.log('[Worker] ========== Scheduled run queued ==========')
  }
}

// 启动定时任务
console.log(`[Worker] Schedule: Will run every ${SCHEDULE_INTERVAL_MS / 1000 / 60} minutes`)
setInterval(runScheduledJobs, SCHEDULE_INTERVAL_MS)

// 立即执行一次
runScheduledJobs()

// 优雅关闭
const shutdown = async () => {
  console.log('[Worker] Shutting down...')
  await cronJobQueue.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

console.log('[Worker] Worker is ready and waiting for jobs')
console.log('[Worker] Listening on: cron-job queue')
