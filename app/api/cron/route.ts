import { NextResponse } from 'next/server'
import { cronJobQueue, addCronJob, type CronJobData } from '@/lib/queue'
import { createLock } from '@/lib/lock'

// 分布式锁
const cronLock = createLock('cron-job', 10 * 60 * 1000)

// 分片大小
const CHUNK_SIZE = 10

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const startTime = Date.now()
  console.log('[Cron API] Received request, adding to queue...')

  // 解析参数
  const startPage = parseInt(searchParams.get('startPage') || '1', 10)
  const maxPages = parseInt(searchParams.get('maxPages') || '50', 10)
  const concurrency = parseInt(searchParams.get('concurrency') || '10', 10)
  const usePerformanceSort = searchParams.get('usePerformanceSort') !== 'false'
  const status = searchParams.get('status') || 'Active'
  const fetchByPriority = searchParams.get('fetchByPriority') // HIGH / undefined

  try {
    // 获取分布式锁
    const lockValue = `cron-${Date.now()}`
    const lockAcquired = await cronLock.acquire(lockValue)
    
    if (!lockAcquired) {
      return NextResponse.json({
        success: false,
        error: 'Another cron job is already in progress',
        code: 'CRON_JOB_ALREADY_RUNNING',
      }, { status: 409 })
    }

    try {
      let jobData: CronJobData
      
      // HIGH 任务：从 ConversionList 获取有转化的 offer 进行监控
      if (fetchByPriority === 'HIGH') {
        jobData = {
          type: 'HIGH',
          status,
          concurrency,
        }
        
        const job = await addCronJob(jobData)
        
        console.log(`[Cron API] HIGH job ${job.id} added to queue`)

        return NextResponse.json({
          success: true,
          message: 'HIGH job added to queue',
          type: 'HIGH',
          jobId: job.id,
          jobStatus: 'waiting',
          params: jobData,
          elapsedMs: Date.now() - startTime,
        })
      } 
      
      // FULL 任务：全量抓取，支持自动分片
      else {
        const maxTotalPages = 120
        const actualMaxPages = Math.min(maxPages, maxTotalPages - startPage + 1)
        
        // 计算需要多少个分片
        const totalChunks = Math.ceil(actualMaxPages / CHUNK_SIZE)
        
        // 创建所有分片任务
        const jobs: CronJobData[] = []
        
        for (let i = 0; i < totalChunks; i++) {
          const chunkStartPage = startPage + (i * CHUNK_SIZE)
          const chunkEndPage = Math.min(chunkStartPage + CHUNK_SIZE - 1, startPage + actualMaxPages - 1)
          
          jobs.push({
            type: 'FULL',
            startPage: chunkStartPage,
            endPage: chunkEndPage,
            concurrency,
            usePerformanceSort,
            status,
          })
        }
        
        // 添加所有分片任务到队列
        const addedJobs = await Promise.all(
          jobs.map(job => addCronJob(job))
        )
        
        console.log(`[Cron API] FULL job added: ${jobs.length} chunks, pages ${startPage}-${startPage + actualMaxPages - 1}`)

        return NextResponse.json({
          success: true,
          message: `FULL job added - ${jobs.length} chunks`,
          type: 'FULL',
          chunks: jobs.length,
          jobIds: addedJobs.map(j => j.id),
          jobStatus: 'waiting',
          params: {
            startPage,
            maxPages: actualMaxPages,
            chunkSize: CHUNK_SIZE,
            chunks: jobs.length,
            concurrency,
            status,
          },
          elapsedMs: Date.now() - startTime,
        })
      }
    } finally {
      await cronLock.release(lockValue)
    }

  } catch (error) {
    console.error('[Cron API] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// 获取队列状态
export async function HEAD() {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      cronJobQueue.getWaitingCount(),
      cronJobQueue.getActiveCount(),
      cronJobQueue.getCompletedCount(),
      cronJobQueue.getFailedCount(),
    ])

    return NextResponse.json({
      success: true,
      queue: 'cron-job',
      counts: {
        waiting,
        active,
        completed,
        failed,
        total: waiting + active,
      },
    })
  } catch (error) {
    console.error('[Cron API] Error getting queue status:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
