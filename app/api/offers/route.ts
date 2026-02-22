import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 允许排序的字段白名单
const ALLOWED_SORT_FIELDS = ['lastConv', 'payout', 'dailyCap', 'updatedAt', 'createdAt', 'id', 'offerName', 'status', 'country']

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  
  // Pagination - 边界检查
  const rawPage = searchParams.get('page')
  let page = rawPage ? parseInt(rawPage, 10) : 1
  
  // 分页边界检查: 确保 page >= 1
  if (isNaN(page) || page < 1) {
    page = 1
  }

  const rawLimit = searchParams.get('limit')
  let limit = rawLimit ? parseInt(rawLimit, 10) : 20
  
  // limit 边界检查: 确保 1 <= limit <= 100
  if (isNaN(limit) || limit < 1) {
    limit = 20
  } else if (limit > 100) {
    limit = 100
  }

  const skip = (page - 1) * limit

  // Filters
  const country = searchParams.get('country')
  const status = searchParams.get('status')
  const vertical = searchParams.get('vertical')
  const carrier = searchParams.get('carrier')
  const search = searchParams.get('search')
  
  // Sorting - 白名单验证
  let sortBy = searchParams.get('sortBy') || 'updatedAt'
  let sortOrder = (searchParams.get('sortOrder') || 'desc').toLowerCase() as 'asc' | 'desc'

  // 验证 sortBy 是否在白名单中
  if (!ALLOWED_SORT_FIELDS.includes(sortBy)) {
    sortBy = 'updatedAt' // 默认值
  }

  // 验证 sortOrder
  if (sortOrder !== 'asc' && sortOrder !== 'desc') {
    sortOrder = 'desc' // 默认值
  }

  // Build where clause
  const where: Record<string, unknown> = {}
  
  if (country) where.country = country
  if (status) where.status = status
  if (vertical) where.vertical = vertical
  if (carrier) where.carrier = carrier
  if (search) {
    where.OR = [
      { offerName: { contains: search, mode: 'insensitive' } },
      { id: { contains: search } },
    ]
  }

  // Get total count
  const total = await prisma.offer.count({ where })

  // Get offers - 使用 Prisma 原生排序，然后手动处理 null 值
  const validSortFields = ['lastConv', 'payout', 'dailyCap', 'updatedAt', 'createdAt', 'id', 'offerName', 'status', 'country']
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'updatedAt'
  
  // 获取所有数据后在内存中排序（因为需要转换 lastConvRaw 为分钟数）
  const allOffers = await prisma.offer.findMany({
    where,
  })

  // 转换 lastConvRaw 为分钟数的辅助函数 (支持多种格式)
  const parseLastConvToMinutes = (raw: string | null): number | null => {
    if (!raw) return null
    const trimmed = raw.trim().toLowerCase()
    
    // 格式1: "1h18min" (小时+分钟)
    const mixedMatch = trimmed.match(/^(\d+)h(\d+)min$/i)
    if (mixedMatch) {
      const hours = parseInt(mixedMatch[1], 10)
      const minutes = parseInt(mixedMatch[2], 10)
      return hours * 60 + minutes
    }
    
    // 格式2: "11min", "58min", "5min" (纯分钟，min后缀)
    const minOnlyMatch = trimmed.match(/^(\d+)min$/i)
    if (minOnlyMatch) {
      return parseInt(minOnlyMatch[1], 10)
    }
    
    // 格式3: "5m", "2h", "1d" (单个字母单位)
    const simpleMatch = trimmed.match(/^(\d+)([mhd])$/i)
    if (simpleMatch) {
      const value = parseInt(simpleMatch[1], 10)
      const unit = simpleMatch[2].toLowerCase()
      switch (unit) {
        case 'm': return value
        case 'h': return value * 60
        case 'd': return value * 1440
      }
    }
    
    // 格式4: "just now", "now"
    if (trimmed === 'just now' || trimmed === 'now') {
      return 0.5
    }
    
    // 格式5: "< 1m"
    const lessThanMatch = trimmed.match(/^<\s*(\d+)([mhd])$/i)
    if (lessThanMatch) {
      const value = parseInt(lessThanMatch[1], 10)
      return value === 1 ? 0.5 : value * 0.5
    }
    
    return null
  }

  // 排序
  let sortedOffers = allOffers
  if (sortField === 'lastConv') {
    // 先分离 null 和非 null
    const nulls = allOffers.filter(o => o.lastConvRaw === null)
    const nonNulls = allOffers.filter(o => o.lastConvRaw !== null)
    
    // 按分钟数排序
    nonNulls.sort((a, b) => {
      const aMin = parseLastConvToMinutes(a.lastConvRaw) ?? Infinity
      const bMin = parseLastConvToMinutes(b.lastConvRaw) ?? Infinity
      return sortOrder === 'asc' ? aMin - bMin : bMin - aMin
    })
    
    sortedOffers = [...nonNulls, ...nulls]  // 非 null 在前
  } else {
    sortedOffers = allOffers.sort((a, b) => {
      const aVal = a[sortField as keyof typeof a]
      const bVal = b[sortField as keyof typeof b]
      if (aVal === bVal) return 0
      if (aVal === null) return 1
      if (bVal === null) return -1
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
      }
      return 0
    })
  }

  // 分页
  const paginatedOffers = sortedOffers.slice(skip, skip + limit)

  return NextResponse.json({
    success: true,
    data: paginatedOffers,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  })
}
