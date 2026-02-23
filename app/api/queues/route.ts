import { NextResponse } from 'next/server'
import { cronJobQueue } from '@/lib/queue'

// 队列状态查询 API
export async function GET() {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      cronJobQueue.getWaitingCount(),
      cronJobQueue.getActiveCount(),
      cronJobQueue.getCompletedCount(),
      cronJobQueue.getFailedCount(),
      cronJobQueue.getDelayedCount(),
    ])
    
    return NextResponse.json({
      success: true,
      queue: 'cron-job',
      counts: {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + delayed,
      },
    })
  } catch (error) {
    console.error('[Queues API] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
