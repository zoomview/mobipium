'use client'

import { useState, useEffect, useCallback } from 'react'
import styles from './page.module.css'

interface Offer {
  id: string
  offerName: string
  status: string
  country: string
  countryName: string | null
  carrier: string | null
  vertical: string | null
  flow: string | null
  payout: number
  currency: string | null
  dailyCap: number | null
  typeTraffic: string | null
  filledCap: number | null
  lastConv: string | null
  lastConvRaw: string | null
  updatedAt: string
}

interface OfferStats {
  totalOffers: number
  activeOffers: number
  offersWithConversions: number
}

export default function Home() {
  const [offers, setOffers] = useState<Offer[]>([])
  const [stats, setStats] = useState<OfferStats>({
    totalOffers: 0,
    activeOffers: 0,
    offersWithConversions: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('')
  const [status, setStatus] = useState('')
  const [vertical, setVertical] = useState('')
  const [sortBy, setSortBy] = useState('lastConv')
  const [sortOrder, setSortOrder] = useState('asc')

  // Selected offer for chart
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)
  const [chartData, setChartData] = useState<Array<{time: string; lastConvMinutes: number | null}>>([])
  const [chartLoading, setChartLoading] = useState(false)

  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const fetchOffers = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      params.set('page', page.toString())
      params.set('limit', '50')
      if (search) params.set('search', search)
      if (country) params.set('country', country)
      if (status) params.set('status', status)
      if (vertical) params.set('vertical', vertical)
      params.set('sortBy', sortBy)
      params.set('sortOrder', sortOrder)

      const response = await fetch(`/api/offers?${params}`)
      const data = await response.json()

      if (data.success) {
        setOffers(data.data)
        setTotalPages(data.meta.totalPages)

        // 使用API返回的正确统计
        if (data.stats) {
          setStats({
            totalOffers: data.stats.totalOffers,
            activeOffers: data.stats.activeOffers,
            offersWithConversions: data.stats.offersWithConversions,
          })
        } else {
          // 兼容旧版本
          const withConversions = data.data.filter((o: Offer) => o.lastConvRaw).length
          setStats({
            totalOffers: data.meta.total,
            activeOffers: data.data.filter((o: Offer) => o.status === 'Active').length,
            offersWithConversions: withConversions,
          })
        }
      } else {
        setError(data.error || 'Failed to fetch offers')
      }
    } catch (err) {
      setError('Failed to fetch offers')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [page, search, country, status, vertical, sortBy, sortOrder])

  useEffect(() => {
    fetchOffers()
  }, [fetchOffers])

  const fetchChartData = async (offerId: string) => {
    setChartLoading(true)
    try {
      const response = await fetch(`/api/offers/${offerId}/history?hours=24`)
      const data = await response.json()
      if (data.success) {
        setChartData(data.data)
      }
    } catch (err) {
      console.error('Failed to fetch chart data:', err)
    } finally {
      setChartLoading(false)
    }
  }

  const handleOfferClick = (offer: Offer) => {
    setSelectedOffer(offer)
    fetchChartData(offer.id)
  }

  const parseLastConvMinutes = (lastConvRaw: string | null): number | null => {
    if (!lastConvRaw) return null
    const match = lastConvRaw.match(/^(\d+)([mhd])$/i)
    if (!match) return null
    const value = parseInt(match[1], 10)
    const unit = match[2].toLowerCase()
    switch (unit) {
      case 'm': return value
      case 'h': return value * 60
      case 'd': return value * 1440
      default: return null
    }
  }

  // Get unique values for filters
  // 常用国家列表 + 数据库中的国家（去重合并）
  const COMMON_COUNTRIES = [
    'US', 'UK', 'CA', 'AU', 'DE', 'FR', 'ES', 'IT', 'JP', 'KR',
    'BR', 'MX', 'AR', 'CO', 'CL', 'PE', 'IN', 'ID', 'TH', 'VN',
    'NG', 'ZA', 'EG', 'MA', 'KE', 'GH', 'RU', 'UA', 'PL', 'NL',
    'BE', 'SE', 'NO', 'FI', 'DK', 'AT', 'CH', 'IE', 'PT', 'GR',
    'TR', 'SA', 'AE', 'IL', 'SG', 'MY', 'PH', 'NZ', 'TW', 'HK'
  ]
  const countriesFromData = [...new Set(offers.map(o => o.country).filter(Boolean))]
  const countries = [...new Set([...COMMON_COUNTRIES, ...countriesFromData])].sort()
  
  // 常用 Vertical 列表
  const COMMON_VERTICALS = [
    'Carrier Billing', 'Dating', 'Live Cams', 'Adult', 'Gaming',
    'Finance', 'Sweepstakes', 'VPN', 'Anti-Virus', 'Education',
    'Mobile Content', 'Video', 'Music', 'Apps', 'E-commerce'
  ]
  const verticalsFromData = [...new Set(offers.map(o => o.vertical).filter((v): v is string => Boolean(v)))]
  const verticals = [...new Set([...COMMON_VERTICALS, ...verticalsFromData])].sort()

  // 常用 Flow 列表
  const COMMON_FLOWS = ['1 Click', 'DOI', 'PIN Submit', 'SOI', 'Email Submit', 'App Install']
  const flowsFromData = [...new Set(offers.map(o => o.flow).filter((v): v is string => Boolean(v)))]
  const flows = [...new Set([...COMMON_FLOWS, ...flowsFromData])].sort()
  
  const statuses = ['Active', 'Paused', 'Blocked']

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Mobipium Offer Monitor</h1>
        <p className={styles.subtitle}>Track conversion times and find hot offers</p>
      </header>

      {/* Stats Cards */}
      <section className={styles.stats}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.totalOffers}</div>
          <div className={styles.statLabel}>Total Offers</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.activeOffers}</div>
          <div className={styles.statLabel}>Active</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.offersWithConversions}</div>
          <div className={styles.statLabel}>With Conversions</div>
        </div>
      </section>

      {/* Filters */}
      <section className={styles.filters}>
        <input
          type="text"
          placeholder="Search offers..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className={styles.searchInput}
        />
        <select value={country} onChange={(e) => { setCountry(e.target.value); setPage(1); }} className={styles.select}>
          <option value="">All Countries</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={vertical} onChange={(e) => { setVertical(e.target.value); setPage(1); }} className={styles.select}>
          <option value="">All Verticals</option>
          {verticals.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={styles.select}>
          <option value="">All Status</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </section>

      {/* Main Content */}
      <div className={styles.content}>
        {/* Offers Table */}
        <section className={styles.tableSection}>
          {loading ? (
            <div className={styles.loading}>Loading...</div>
          ) : error ? (
            <div className={styles.error}>{error}</div>
          ) : (
            <>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th onClick={() => { setSortBy('id'); setSortOrder(sortBy === 'id' && sortOrder === 'asc' ? 'desc' : 'asc'); setPage(1); }} style={{cursor: 'pointer'}}>
                      ID {sortBy === 'id' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => { setSortBy('offerName'); setSortOrder(sortBy === 'offerName' && sortOrder === 'asc' ? 'desc' : 'asc'); setPage(1); }} style={{cursor: 'pointer'}}>
                      Offer {sortBy === 'offerName' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => { setSortBy('country'); setSortOrder(sortBy === 'country' && sortOrder === 'asc' ? 'desc' : 'asc'); setPage(1); }} style={{cursor: 'pointer'}}>
                      Country {sortBy === 'country' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>Carrier</th>
                    <th onClick={() => { setSortBy('vertical'); setSortOrder(sortBy === 'vertical' && sortOrder === 'asc' ? 'desc' : 'asc'); setPage(1); }} style={{cursor: 'pointer'}}>
                      Vertical {sortBy === 'vertical' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>Flow</th>
                    <th onClick={() => { setSortBy('payout'); setSortOrder(sortBy === 'payout' && sortOrder === 'asc' ? 'desc' : 'asc'); setPage(1); }} style={{cursor: 'pointer'}}>
                      Payout {sortBy === 'payout' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => { setSortBy('lastConv'); setSortOrder(sortBy === 'lastConv' && sortOrder === 'asc' ? 'desc' : 'asc'); setPage(1); }} style={{cursor: 'pointer'}}>
                      Last Conv {sortBy === 'lastConv' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => { setSortBy('dailyCap'); setSortOrder(sortBy === 'dailyCap' && sortOrder === 'asc' ? 'desc' : 'asc'); setPage(1); }} style={{cursor: 'pointer'}}>
                      Daily Cap {sortBy === 'dailyCap' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer) => {
                    const minutes = parseLastConvMinutes(offer.lastConvRaw)
                    return (
                      <tr
                        key={offer.id}
                        onClick={() => handleOfferClick(offer)}
                        className={`${styles.row} ${selectedOffer?.id === offer.id ? styles.selected : ''}`}
                      >
                        <td className={styles.offerId}>{offer.id}</td>
                        <td className={styles.offerName}>{offer.offerName}</td>
                        <td>{offer.country}</td>
                        <td>{offer.carrier || '-'}</td>
                        <td>{offer.vertical || '-'}</td>
                        <td>{offer.flow || '-'}</td>
                        <td>${offer.payout.toFixed(2)}</td>
                        <td className={minutes !== null && minutes < 5 ? styles.hot : ''}>
                          {offer.lastConvRaw || '-'}
                        </td>
                        <td>{offer.dailyCap || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              <div className={styles.pagination}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</button>
                <span>Page {page} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</button>
              </div>
            </>
          )}
        </section>

        {/* Chart Section */}
        {selectedOffer && (
          <section className={styles.chartSection}>
            <h2>Conversion Trend: {selectedOffer.offerName}</h2>
            {chartLoading ? (
              <div className={styles.loading}>Loading chart...</div>
            ) : chartData.length > 0 ? (
              <div className={styles.chart}>
                {chartData.map((point, i) => (
                  <div key={i} className={styles.chartPoint}>
                    <div
                      className={styles.chartBar}
                      style={{
                        height: `${Math.min(100, (point.lastConvMinutes || 0) / 10)}%`,
                        backgroundColor: point.lastConvMinutes && point.lastConvMinutes < 5 ? '#22c55e' : '#3b82f6'
                      }}
                      title={`${point.lastConvMinutes} min`}
                    />
                    <div className={styles.chartLabel}>
                      {new Date(point.time).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.noData}>No historical data available</p>
            )}
            <button onClick={() => setSelectedOffer(null)} className={styles.closeChart}>Close</button>
          </section>
        )}
      </div>
    </main>
  )
}
