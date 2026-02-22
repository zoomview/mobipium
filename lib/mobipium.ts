const API_BASE = 'https://affiliates.mobipium.com/api/cpa/findmyoffers'
const TOKEN = process.env.MOBIPIUM_API_TOKEN

export interface MobipiumOffer {
  offer_id: string
  offer_name: string
  status: string
  country: string
  country_name: string
  carrier: string
  vertical: string
  flow: string
  model: string
  payout: string
  currency: string
  daily_cap: string
  type_traffic: string
  time_frame: string
  traffic_restrictions: string
  landing_page: string | null
  thumbnails: string | null
  offer_url: string
  filled_cap: string
  last_conv: string | null
}

export interface FetchOffersParams {
  country?: string
  status?: string
  verticals?: string
  flows?: string
  order_by?: string
  offers?: string
  payout_above?: string
  limit?: number
  page?: number
}

export interface MobipiumResponse {
  success: boolean
  meta: {
    total: number
    total_pages: number
    page: number
    limit: string
  }
  offers: MobipiumOffer[]
  time_elapsed: number
}

export async function fetchOffers(params: FetchOffersParams = {}): Promise<MobipiumOffer[]> {
  if (!TOKEN) {
    throw new Error('MOBIPIUM_API_TOKEN is not set')
  }

  const url = new URL(API_BASE)
  url.searchParams.set('mwsd', TOKEN)

  if (params.country) url.searchParams.set('country', params.country)
  if (params.status) url.searchParams.set('status', params.status)
  if (params.verticals) url.searchParams.set('verticals', params.verticals)
  if (params.flows) url.searchParams.set('flows', params.flows)
  if (params.order_by) url.searchParams.set('order_by', params.order_by)
  if (params.offers) url.searchParams.set('offers', params.offers)
  if (params.payout_above) url.searchParams.set('payout_above', params.payout_above)
  if (params.limit) url.searchParams.set('limit', params.limit.toString())
  if (params.page) url.searchParams.set('pages', params.page.toString())

  const response = await fetch(url.toString(), {
    next: { revalidate: 0 }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch offers: ${response.status} ${response.statusText}`)
  }

  const data: MobipiumResponse = await response.json()

  if (!data.success) {
    throw new Error('API returned unsuccessful response')
  }

  return data.offers
}

// Parse last_conv to minutes (supports multiple formats)
// Formats supported:
// - "5m" -> 5 minutes
// - "2h" -> 120 minutes
// - "51min" -> 51 minutes (Mobipium 常用格式)
// - "6h18min" -> 6*60 + 18 = 378 minutes
// - "1h58min" -> 1*60 + 58 = 118 minutes
// - "0min" -> 0 minutes
// - "5m", "2h", "1d" -> 标准格式
// - "< 1m" -> 0.5 minutes (less than 1 minute)
// - "just now" -> 0.5 minutes
// - "now" -> 0.5 minutes
// - "1m30s" -> 1.5 minutes (mixed format)
export function parseLastConv(lastConv: string | null): number | null {
  if (!lastConv) return null

  const trimmed = lastConv.trim().toLowerCase()

  // 情况0: Mobipium 格式 "51min", "0min" 等 (分钟)
  const minMatch = trimmed.match(/^(\d+)min$/)
  if (minMatch) {
    return parseInt(minMatch[1], 10)
  }

  // 情况0b: Mobipium 混合格式 "6h18min", "1h58min" 等
  const hourMinMatch = trimmed.match(/^(\d+)h(\d+)min$/)
  if (hourMinMatch) {
    const hours = parseInt(hourMinMatch[1], 10)
    const mins = parseInt(hourMinMatch[2], 10)
    return hours * 60 + mins
  }

  // 情况1: 标准格式 "5m", "2h", "1d"
  const standardMatch = trimmed.match(/^(\d+)([mhd])$/i)
  if (standardMatch) {
    const value = parseInt(standardMatch[1], 10)
    const unit = standardMatch[2].toLowerCase()

    switch (unit) {
      case 'm': return value
      case 'h': return value * 60
      case 'd': return value * 1440
      default: return null
    }
  }

  // 情况2: 小于 X 分钟 "< 1m", "<5m" (支持带空格或不带空格)
  const lessThanMatch = trimmed.match(/^<\s*(\d+)([mhd])$/i)
  if (lessThanMatch) {
    const value = parseInt(lessThanMatch[1], 10)
    const unit = lessThanMatch[2].toLowerCase()

    // "< 1m" 返回 0.5 分钟，其他返回 value * 0.5
    if (value === 1) return 0.5

    switch (unit) {
      case 'm': return value * 0.5
      case 'h': return value * 60 * 0.5
      case 'd': return value * 1440 * 0.5
      default: return 0.5
    }
  }

  // 情况3: "just now", "now" 等表示刚刚
  if (trimmed === 'just now' || trimmed === 'now' || trimmed === 'just now ' || trimmed === 'now ') {
    return 0.5
  }

  // 情况4: 混合格式 "1m30s" (分钟+秒)
  const mixedMatch = trimmed.match(/^(\d+)m(\d+)s$/)
  if (mixedMatch) {
    const minutes = parseInt(mixedMatch[1], 10)
    const seconds = parseInt(mixedMatch[2], 10)
    return minutes + seconds / 60
  }

  // 情况5: 只有秒数 "30s"
  const secondsMatch = trimmed.match(/^(\d+)s$/)
  if (secondsMatch) {
    const seconds = parseInt(secondsMatch[1], 10)
    return seconds / 60
  }

  // 情况6: 数字格式 "5" (默认当作分钟)
  const numMatch = trimmed.match(/^(\d+)$/)
  if (numMatch) {
    return parseInt(numMatch[1], 10)
  }

  return null
}

// Convert last_conv string to Date (approximate)
export function lastConvToDate(lastConv: string | null): Date | null {
  if (!lastConv) return null

  const minutes = parseLastConv(lastConv)
  if (minutes === null) return null

  // Subtract from now to get approximate conversion time
  return new Date(Date.now() - minutes * 60 * 1000)
}
