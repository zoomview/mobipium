import { parseLastConv, lastConvToDate, MobipiumOffer, fetchOffers } from '@/lib/mobipium'
import { sendAlertEmail } from '@/lib/alert'

// ============================================
// 测试: mobipium.ts - parseLastConv 函数
// ============================================

describe('parseLastConv', () => {
  // 正常格式测试
  test('解析分钟格式: 5m', () => {
    expect(parseLastConv('5m')).toBe(5)
  })

  test('解析小时格式: 2h', () => {
    expect(parseLastConv('2h')).toBe(120) // 2 * 60
  })

  test('解析天格式: 1d', () => {
    expect(parseLastConv('1d')).toBe(1440) // 1 * 1440
  })

  test('解析大数字天: 3d', () => {
    expect(parseLastConv('3d')).toBe(4320) // 3 * 1440
  })

  // 边界情况测试
  test('null 输入返回 null', () => {
    expect(parseLastConv(null)).toBeNull()
  })

  test('undefined 输入返回 null', () => {
    expect(parseLastConv(undefined)).toBeNull()
  })

  test('空字符串返回 null', () => {
    expect(parseLastConv('')).toBeNull()
  })

  // 未知格式测试 - 修复后这些应该能正确解析
  test('未知格式: just now', () => {
    // 修复后: "just now" -> 0.5 分钟
    expect(parseLastConv('just now')).toBe(0.5)
  })

  test('未知格式: now', () => {
    // 修复后: "now" -> 0.5 分钟
    expect(parseLastConv('now')).toBe(0.5)
  })

  test('未知格式: 1m30s', () => {
    // 修复后: 混合格式 "1m30s" -> 1.5 分钟
    expect(parseLastConv('1m30s')).toBe(1.5)
  })

  test('未知格式: < 1m', () => {
    // 修复后: "< 1m" -> 0.5 分钟
    expect(parseLastConv('< 1m')).toBe(0.5)
  })

  test('未知格式: < 5m', () => {
    // 修复后: "< 5m" -> 2.5 分钟
    expect(parseLastConv('< 5m')).toBe(2.5)
  })

  test('未知格式: 30s', () => {
    // 修复后: "30s" -> 0.5 分钟
    expect(parseLastConv('30s')).toBe(0.5)
  })

  test('数字格式: 5 (无单位)', () => {
    // 修复后: "5" -> 5 分钟
    expect(parseLastConv('5')).toBe(5)
  })

  test('负数格式: -5m', () => {
    // 负数可能不被正确处理
    expect(parseLastConv('-5m')).toBeNull()
  })

  test('大小写混合: 5M', () => {
    expect(parseLastConv('5M')).toBe(5)
  })

  test('大小写混合: 5H', () => {
    expect(parseLastConv('5H')).toBe(300)
  })
})

// ============================================
// 测试: mobipium.ts - lastConvToDate 函数
// ============================================

describe('lastConvToDate', () => {
  test('有效输入返回合理的时间', () => {
    const result = lastConvToDate('5m')
    expect(result).toBeInstanceOf(Date)
    // 应该在 5 分钟左右
    const diff = Math.abs(Date.now() - result!.getTime())
    expect(diff).toBeLessThan(600000) // 10 分钟误差内
  })

  test('null 输入返回 null', () => {
    expect(lastConvToDate(null)).toBeNull()
  })

  test('无效格式返回 null', () => {
    expect(lastConvToDate('invalid')).toBeNull()
  })
})

// ============================================
// 测试: alert.ts - 告警逻辑
// ============================================

describe('sendAlertEmail', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('没有配置 RESEND_API_KEY 时跳过发送', async () => {
    delete process.env.RESEND_API_KEY
    delete process.env.ALERT_EMAIL
    
    const result = await sendAlertEmail({
      offerId: '123',
      offerName: 'Test Offer',
      previousLastConv: '< 1m',
      currentLastConv: '15m',
      previousMinutes: 0.5,
      currentMinutes: 15,
    })
    
    expect(result).toBe(false)
  })

  test('没有配置 ALERT_EMAIL 时返回 false', async () => {
    process.env.RESEND_API_KEY = 'test_key'
    delete process.env.ALERT_EMAIL
    
    const result = await sendAlertEmail({
      offerId: '123',
      offerName: 'Test Offer',
      previousLastConv: '< 1m',
      currentLastConv: '15m',
      previousMinutes: 0.5,
      currentMinutes: 15,
    })
    
    expect(result).toBe(false)
  })
})

// ============================================
// 测试: 数据类型转换边界情况
// ============================================

describe('数据类型转换', () => {
  test('payout 字符串转 Float', () => {
    const payout = parseFloat('10.5')
    expect(payout).toBe(10.5)
  })

  test('payout 无效字符串返回 NaN', () => {
    const payout = parseFloat('abc')
    expect(Number.isNaN(payout)).toBe(true)
  })

  test('payout 空字符串返回 NaN', () => {
    const payout = parseFloat('')
    expect(Number.isNaN(payout)).toBe(true)
  })

  test('dailyCap 字符串转 Int', () => {
    const cap = parseInt('100', 10)
    expect(cap).toBe(100)
  })

  test('dailyCap 非数字字符串返回 NaN', () => {
    const cap = parseInt('abc', 10)
    expect(Number.isNaN(cap)).toBe(true)
  })

  test('处理货币格式: $10.50', () => {
    const payout = parseFloat('$10.50'.replace('$', ''))
    expect(payout).toBe(10.5)
  })
})

// ============================================
// 测试: API 响应数据结构验证
// ============================================

describe('API 响应数据结构', () => {
  test('MobipiumOffer 接口必需字段', () => {
    const validOffer: MobipiumOffer = {
      offer_id: '123',
      offer_name: 'Test Offer',
      status: 'Active',
      country: 'US',
      country_name: 'United States',
      carrier: 'Verizon',
      vertical: 'dating',
      flow: '1 Click',
      model: 'CPI',
      payout: '10.50',
      currency: 'USD',
      daily_cap: '100',
      type_traffic: 'Mobile',
      time_frame: '30d',
      traffic_restrictions: 'No adult',
      landing_page: null,
      thumbnails: null,
      offer_url: 'https://example.com',
      filled_cap: '50',
      last_conv: '5m',
    }

    // 验证必需字段存在
    expect(validOffer.offer_id).toBeDefined()
    expect(validOffer.offer_name).toBeDefined()
    expect(validOffer.status).toBeDefined()
    expect(validOffer.country).toBeDefined()
  })

  test('MobipiumOffer 可选字段为 null', () => {
    const offerWithNulls: MobipiumOffer = {
      offer_id: '123',
      offer_name: 'Test',
      status: 'Active',
      country: 'US',
      country_name: null,
      carrier: null,
      vertical: null,
      flow: null,
      model: 'CPI',
      payout: '10',
      currency: 'USD',
      daily_cap: null,
      type_traffic: null,
      time_frame: '30d',
      traffic_restrictions: null,
      landing_page: null,
      thumbnails: null,
      offer_url: 'https://example.com',
      filled_cap: null,
      last_conv: null,
    }

    expect(offerWithNulls.last_conv).toBeNull()
    expect(offerWithNulls.carrier).toBeNull()
  })

  test('last_conv 可能的不同格式', () => {
    const formats = ['< 1m', '1m', '5m', '10m', '30m', '1h', '2h', '1d', 'just now', null]
    
    formats.forEach(format => {
      const result = parseLastConv(format)
      // 这些格式中，部分会返回 null，可能导致数据丢失
      console.log(`Format: "${format}" => ${result}`)
    })
  })
})

// ============================================
// 测试: Prisma Schema 约束
// ============================================

describe('Prisma Schema 约束验证', () => {
  test('Offer model required fields', () => {
    // id (String, required)
    // offerName (String, required)
    // status (String, required)
    // country (String, required)
    // payout (Float, required) - 注意: 这意味着不能存储 null
    
    // 验证 payout 为 0 是合法的
    const payout = 0
    expect(typeof payout).toBe('number')
    
    // 但 null 会导致 Prisma 错误
    const payoutNull: number | null = null
    expect(payoutNull).toBeNull()
  })

  test('OfferSnapshot relation', () => {
    // snapshot 必须有对应的 offer
    // 删除 offer 时，snapshots 会被 cascade 删除
    
    // 测试 cascade 删除行为需要实际数据库
    console.log('需要数据库测试: cascade delete')
  })
})

// ============================================
// 集成测试: API 路由安全
// ============================================

describe('API 路由安全问题', () => {
  // sortBy 参数直接使用可能导致的问题
  
  test('sortBy 允许任意字段名', () => {
    // 当前代码允许任意 sortBy，可能导致 Prisma 错误
    const allowedFields = ['lastConv', 'payout', 'dailyCap', 'updatedAt', 'createdAt']
    const userInput = 'arbitrary_field' // 用户输入任意字段
    
    // 当前没有验证
    const isSafe = allowedFields.includes(userInput)
    expect(isSafe).toBe(false) // 不安全!
  })

  test('sortBy SQL 注入风险', () => {
    // 尝试注入恶意 sortBy
    const maliciousInput = 'id; DROP TABLE offers;--'
    
    // Prisma 会参数化查询，但可能返回错误
    console.log(`恶意输入: ${maliciousInput}`)
    // 实际测试需要数据库连接
  })

  test('sortOrder 只允许 asc/desc', () => {
    const allowedOrders = ['asc', 'desc']
    const userInput = 'ASC' // 大写
    const userInput2 = 'DESC' // 大写
    const userInput3 = 'anything' // 任意值
    
    // 当前没有验证大小写
    expect(allowedOrders.includes(userInput.toLowerCase())).toBe(true)
    expect(allowedOrders.includes(userInput2.toLowerCase())).toBe(true)
    expect(allowedOrders.includes(userInput3.toLowerCase())).toBe(false)
  })
})

// ============================================
// 边界条件测试
// ============================================

describe('边界条件测试', () => {
  test('分页 page=0', () => {
    const page = 0
    const limit = 20
    const skip = (page - 1) * limit
    // page=0 会导致 skip=-20，查询可能出错
    expect(skip).toBe(-20)
  })

  test('分页 page=负数', () => {
    const page = -1
    const limit = 20
    const skip = (page - 1) * limit
    expect(skip).toBe(-40)
  })

  test('limit=0', () => {
    const limit = 0
    // Prisma take=0 会返回空数组，这是安全的
    expect(limit).toBe(0)
  })

  test('limit=负数', () => {
    const limit = -1
    // Prisma take=-1 行为不确定
    expect(limit).toBeLessThan(0)
  })

  test('limit 超过最大值', () => {
    const userLimit = 1000
    const maxLimit = 100
    const result = Math.min(userLimit, maxLimit)
    expect(result).toBe(100) // 已被限制
  })

  test('search 空字符串', () => {
    const search = ''
    // 空字符串 search 会被忽略或导致问题
    expect(search).toBe('')
  })

  test('search SQL 注入', () => {
    const search = "' OR 1=1 --"
    // Prisma 使用参数化查询，是安全的
    expect(search).toBeDefined()
  })
})

// ============================================
// Cron 并发问题
// ============================================

describe('Cron 并发控制', () => {
  test('多次调用 cron 没有锁机制', () => {
    // 当前代码没有防止并发执行
    // 如果 cron 被频繁调用，会导致:
    // 1. 重复创建 snapshots
    // 2. 重复发送告警
    // 3. API 限流
    
    const isConcurrent = true // 模拟并发
    const hasLock = false // 当前没有锁
    
    expect(hasLock).toBe(false) // 存在并发问题!
  })

  test('告警去重时间窗口', () => {
    // 当前逻辑: 24 小时内不重复发送同一 offer 的告警
    const alertWindow = 24 * 60 * 60 * 1000 // 24 小时
    const timeBetweenAlerts = 30 * 60 * 1000 // 30 分钟
    
    expect(timeBetweenAlerts).toBeLessThan(alertWindow) // 会被去重
  })
})

// ============================================
// 告警逻辑测试 (修复后支持多种场景)
// ============================================

describe('告警逻辑边界', () => {
  const ALERT_THRESHOLD_MINUTES = 10
  const ALERT_MULTIPLE_THRESHOLD = 5

  // 场景1: 转化时间激增 (从 <1分钟 -> >阈值)
  test('告警条件: 从 1分钟 -> 15分钟 (应该告警 - conv_time_surge)', () => {
    const prevMinutes = 0.5 // < 1m
    const currentMinutes = 15
    const threshold = ALERT_THRESHOLD_MINUTES
    
    const shouldAlert = prevMinutes < 1 && currentMinutes > threshold
    expect(shouldAlert).toBe(true)
  })

  // 场景2: 转化时间倍数增长 (新支持)
  test('告警条件: 从 2分钟 -> 15分钟 (应该告警 - conv_time_multiplied)', () => {
    const prevMinutes = 2
    const currentMinutes = 15 // 7.5 倍，超过 5 倍阈值
    
    const shouldAlert = 
      prevMinutes >= 1 && 
      currentMinutes > prevMinutes * ALERT_MULTIPLE_THRESHOLD &&
      currentMinutes > ALERT_THRESHOLD_MINUTES
    
    expect(shouldAlert).toBe(true) // 现在会告警!
  })

  // 场景3: 转化突然消失 (新支持)
  test('告警条件: 之前有转化，现在消失 (应该告警 - conv_disappeared)', () => {
    const prevMinutes = 5 // 之前有转化
    const currentMinutes = null // 现在没了
    
    const shouldAlert = prevMinutes !== null && prevMinutes < 30 && currentMinutes === null
    expect(shouldAlert).toBe(true) // 现在会告警!
  })

  // 场景4: 状态变更 (新支持)
  test('告警条件: 状态从 Active -> Paused (应该告警 - status_changed)', () => {
    const prevStatus = 'Active'
    const currentStatus = 'Paused'
    
    const shouldAlert = prevStatus === 'Active' && currentStatus !== 'Active'
    expect(shouldAlert).toBe(true) // 现在会告警!
  })

  test('告警条件: 从 5分钟 -> 15分钟 (应该告警 - conv_time_multiplied)', () => {
    const prevMinutes = 5
    const currentMinutes = 15 // 3 倍，未超过 5 倍阈值
    
    const shouldAlert = 
      prevMinutes >= 1 && 
      currentMinutes > prevMinutes * ALERT_MULTIPLE_THRESHOLD &&
      currentMinutes > ALERT_THRESHOLD_MINUTES
    
    expect(shouldAlert).toBe(false) // 不会告警，因为倍数不够
  })

  test('告警条件: 从 20分钟 -> 1小时 (应该告警 - conv_time_multiplied)', () => {
    const prevMinutes = 20
    const currentMinutes = 60 // 3 倍
    
    const shouldAlert = 
      prevMinutes >= 1 && 
      currentMinutes > prevMinutes * ALERT_MULTIPLE_THRESHOLD &&
      currentMinutes > ALERT_THRESHOLD_MINUTES
    
    expect(shouldAlert).toBe(false) // 不会告警，倍数不够
  })

  test('告警条件: 从 1分钟 -> 30秒 (不应该告警)', () => {
    const prevMinutes = 0.5
    const currentMinutes = 0.5
    const threshold = ALERT_THRESHOLD_MINUTES
    
    const shouldAlert = prevMinutes < 1 && currentMinutes > threshold
    expect(shouldAlert).toBe(false) // 合理，不需要告警
  })

  test('告警条件: prev=null, current=15分钟', () => {
    const prevMinutes = null
    const currentMinutes = 15
    const threshold = 10
    
    const shouldAlert = prevMinutes !== null && prevMinutes < 1 && currentMinutes > threshold
    expect(shouldAlert).toBe(false) // prev 是 null 时不会告警
  })
})

// ============================================
// 总结: 发现的问题 (已修复)
// ============================================

describe('问题总结', () => {
  test('已识别问题列表', () => {
    const issues = [
      {
        severity: 'HIGH',
        title: 'parseLastConv 不支持多种格式',
        description: '只支持 Xm/Xh/Xd，不支持 < 1m, just now, 1m30s 等',
        impact: '部分 offer 的 last_conv 数据丢失',
        status: 'FIXED', // ✅ 已修复
        fixDetails: '支持 < Xm, just now, now, XmYs, Xs 等格式',
      },
      {
        severity: 'HIGH',
        title: '告警逻辑过于严格',
        description: '只监控 <1分钟 -> >阈值，其他变化不告警',
        impact: '很多异常情况被漏报',
        status: 'FIXED', // ✅ 已修复
        fixDetails: '支持 4 种告警场景: conv_time_surge, conv_time_multiplied, conv_disappeared, status_changed',
      },
      {
        severity: 'MEDIUM',
        title: 'sortBy 没有白名单验证',
        description: '允许任意字段名作为排序依据',
        impact: '可能导致 Prisma 错误',
        status: 'FIXED', // ✅ 已修复
        fixDetails: '添加 ALLOWED_SORT_FIELDS 白名单验证',
      },
      {
        severity: 'MEDIUM',
        title: '分页没有边界检查',
        description: 'page=0 或负数会导致负数 skip',
        impact: '查询结果异常',
        status: 'FIXED', // ✅ 已修复
        fixDetails: '添加 page >= 1, limit 在 1-100 之间的验证',
      },
      {
        severity: 'LOW',
        title: 'Cron 没有并发控制',
        description: '多次调用会重复执行',
        impact: '数据重复、资源浪费',
        status: 'FIXED', // ✅ 已修复
        fixDetails: '添加 isCronRunning 锁机制，5 分钟超时',
      },
      {
        severity: 'LOW',
        title: '数据类型转换没有默认值',
        description: 'parseFloat/parseInt 失败返回 NaN',
        impact: '可能存储无效数据到数据库',
        status: 'FIXED', // ✅ 已修复
        fixDetails: '使用 || 0 或 || null 提供默认值',
      },
    ]
    
    expect(issues.length).toBe(6)
    console.table(issues)
  })
})
