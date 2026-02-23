import { redis } from './redis'

// 分布式锁工具
export class DistributedLock {
  private key: string
  private ttl: number // 锁过期时间（毫秒）
  
  constructor(key: string, ttl = 60000) {
    this.key = `lock:${key}`
    this.ttl = ttl
  }

  /**
   * 尝试获取锁
   * @param value 锁的值（通常用唯一ID如 jobId）
   * @returns 是否成功获取锁
   */
  async acquire(value: string): Promise<boolean> {
    const result = await redis.set(this.key, value, 'PX', this.ttl, 'NX')
    return result === 'OK'
  }

  /**
   * 释放锁（仅当值匹配时）
   * @param value 锁的值
   * @returns 是否成功释放
   */
  async release(value: string): Promise<boolean> {
    // 使用 Lua 脚本确保原子性：仅当值匹配时删除
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `
    const result = await redis.eval(script, 1, this.key, value)
    return result === 1
  }

  /**
   * 延长锁的过期时间
   * @param value 锁的值
   * @param ttl 新的过期时间（毫秒）
   */
  async extend(value: string, ttl: number): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `
    const result = await redis.eval(script, 1, this.key, value, ttl.toString())
    return result === 1
  }

  /**
   * 检查锁是否存在
   */
  async exists(): Promise<boolean> {
    const result = await redis.exists(this.key)
    return result === 1
  }
}

/**
 * 创建分布式锁的便捷函数
 */
export function createLock(key: string, ttl = 60000): DistributedLock {
  return new DistributedLock(key, ttl)
}

// Cron Job 专用锁
export const cronJobLock = new DistributedLock('cron-job', 10 * 60 * 1000) // 10分钟
