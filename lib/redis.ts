import Redis from 'ioredis'

// Redis 连接配置
const redisUrl = process.env.REDIS_URL

if (!redisUrl) {
  throw new Error('REDIS_URL is not configured')
}

// 创建 Redis 客户端
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000)
    return delay
  },
  reconnectOnError(err) {
    const targetError = 'READONLY'
    if (err.message.includes(targetError)) {
      return true
    }
    return false
  },
})

// 事件监听
redis.on('connect', () => {
  console.log('[Redis] Connected successfully')
})

redis.on('error', (err) => {
  console.error('[Redis] Error:', err.message)
})

redis.on('close', () => {
  console.log('[Redis] Connection closed')
})

// 导出用于 Bull Queue 的连接
export default redis
