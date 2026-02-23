import Queue from 'bull'

// ============ 任务类型定义 ============

// 统一任务类型
export interface CronJobData {
  type: 'HIGH' | 'FULL'  // HIGH: 监控有转化的 offer, FULL: 全量抓取
  // HIGH 任务参数
  status?: string
  concurrency?: number
  // FULL 任务参数
  startPage?: number
  endPage?: number
  usePerformanceSort?: boolean
}

// 任务结果类型
export interface CronJobResult {
  success: boolean
  offersProcessed: number
  offersFetched: number
  newSnapshots: number
  alertsSent: number
  elapsedMs: number
  error?: string
}

// ============ 单一队列（支持优先级）============
export const cronJobQueue = new Queue<CronJobData>('cron-job', process.env.REDIS_URL!, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    timeout: 15 * 60 * 1000, // 15分钟超时
    removeOnComplete: false,
    removeOnFail: false,
  },
  settings: {
    lockDuration: 30000,
    lockRenewTime: 10000,
  },
})

// ============ 队列事件监听 ============
cronJobQueue.on('completed', (job, result) => {
  console.log(`[Queue] Job ${job.id} completed`, {
    type: job.data.type,
    processed: result.offersProcessed,
    elapsed: result.elapsedMs,
  })
})

cronJobQueue.on('failed', (job, err) => {
  console.error(`[Queue] Job ${job?.id} failed:`, err.message)
})

cronJobQueue.on('error', (error) => {
  console.error('[Queue] Error:', error.message)
})

// ============ 便捷函数 ============

/**
 * 添加任务（统一接口，根据 type 自动设置优先级）
 * HIGH 任务 priority = 1 (高优先级)
 * FULL 任务 priority = 2 (普通优先级)
 */
export async function addCronJob(data: CronJobData) {
  const priority = data.type === 'HIGH' ? 1 : 2
  return cronJobQueue.add(data, { priority })
}

// 导出默认队列
export default cronJobQueue
