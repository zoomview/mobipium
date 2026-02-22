// 一次性抓取脚本 - 直接运行: npx tsx scripts/fetch-all.ts
import { prisma } from '../lib/prisma'
import { fetchOffers, parseLastConv, lastConvToDate, MobipiumOffer } from '../lib/mobipium'

const BATCH_SIZE = 5 // 每次抓取 5 页
const TOTAL_PAGES = 120
const MAX_TOTAL = 10000 // 最多抓取 10000 个 offers

async function fetchAllOffers() {
  console.log('Starting bulk fetch...')
  
  let totalOffers = 0
  let page = 1
  
  while (page <= TOTAL_PAGES && totalOffers < MAX_TOTAL) {
    console.log(`Fetching page ${page}...`)
    
    try {
      const offers = await fetchOffers({
        status: 'Active',
        limit: 100,
        page,
        order_by: 'Performance'
      })
      
      if (offers.length === 0) {
        console.log('No more offers, stopping.')
        break
      }
      
      // Process offers
      for (const offer of offers) {
        const payout = parseFloat(offer.payout) || 0
        const dailyCap = parseInt(offer.daily_cap, 10) || null
        const filledCap = parseInt(offer.filled_cap, 10) || null
        const lastConvDate = lastConvToDate(offer.last_conv)
        
        // Upsert offer
        await prisma.offer.upsert({
          where: { id: offer.offer_id },
          create: {
            id: offer.offer_id,
            offerName: offer.offer_name,
            status: offer.status,
            country: offer.country,
            countryName: offer.country_name,
            carrier: offer.carrier,
            vertical: offer.vertical,
            flow: offer.flow,
            payout,
            currency: offer.currency,
            dailyCap,
            typeTraffic: offer.type_traffic,
            filledCap,
            lastConv: lastConvDate,
            lastConvRaw: offer.last_conv,
          },
          update: {
            offerName: offer.offer_name,
            status: offer.status,
            country: offer.country,
            countryName: offer.country_name,
            carrier: offer.carrier,
            vertical: offer.vertical,
            flow: offer.flow,
            payout,
            currency: offer.currency,
            dailyCap,
            typeTraffic: offer.type_traffic,
            filledCap,
            lastConv: lastConvDate,
            lastConvRaw: offer.last_conv,
          },
        })
        
        // Create snapshot
        await prisma.offerSnapshot.create({
          data: {
            offerId: offer.offer_id,
            lastConv: lastConvDate,
            lastConvRaw: offer.last_conv,
            filledCap,
            payout,
            status: offer.status,
          },
        })
        
        totalOffers++
      }
      
      console.log(`Page ${page} done, total offers: ${totalOffers}`)
      page++
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 500))
      
    } catch (error) {
      console.error(`Error on page ${page}:`, error)
      break
    }
  }
  
  console.log(`Fetch complete! Total offers: ${totalOffers}`)
  
  const count = await prisma.offer.count()
  console.log(`Database now has ${count} offers`)
}

fetchAllOffers()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
