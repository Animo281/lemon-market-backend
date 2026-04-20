import { Session, PublicSession, RoundMetrics } from '../shared/types'
import {
  getCurrentPlayerId,
  computeAvailableOffers,
  getEconomics,
  buildSupplyCurve,
  buildDemandCurve,
  findEquilibrium,
  computeSellerEarnings,
  theoreticalMaxSurplus,
} from '../services/gameAnalytics'
import { MAX_SELLER_UNITS_LIMIT, MAX_ROUNDS_LIMIT } from '../shared/constants'

function computeCurrentRoundMetrics(session: Session): RoundMetrics | null {
  if (session.phase !== 'market' && session.phase !== 'round-end') return null

  const sellers = session.players.filter(p => p.role === 'seller')
  const decided = sellers.map(s => {
    const d = session.currentSellerDecisions[s.id]
    return d?.price !== undefined
      ? { grade: d.grade!, price: d.price, unitsOffered: d.unitsOffered ?? session.maxSellerUnits, unitsSold: d.unitsSold ?? 0, earnings: computeSellerEarnings(d.grade!, d.price, d.unitsSold ?? 0) }
      : null
  }).filter((d): d is NonNullable<typeof d> => d !== null)

  const supplyCurve = buildSupplyCurve(decided)
  const demandCurve = buildDemandCurve(decided.map(d => d.grade), session.infoMode, session.numBuyers)

  const totalSellerProfit = decided.reduce((s, d) => s + d.earnings, 0)
  const buyerDecisions = Object.values(session.currentBuyerDecisions)
  const totalBuyerProfit = buyerDecisions.reduce((s, bd) => s + bd.earnings, 0)
  const totalSurplus = totalSellerProfit + totalBuyerProfit

  const txPrices = decided.flatMap(d => Array(d.unitsSold).fill(d.price))
  const transactions = txPrices.length
  const avgTransactionPrice = transactions > 0 ? txPrices.reduce((s, p) => s + p, 0) / transactions : null

  const maxSurplus = theoreticalMaxSurplus(session.numBuyers)
  return {
    totalSellerProfit,
    totalBuyerProfit,
    avgTransactionPrice,
    transactions,
    theoreticalMaxSurplus: maxSurplus,
    efficiency: maxSurplus > 0 ? totalSurplus / maxSurplus : 0,
    equilibrium: findEquilibrium(supplyCurve, demandCurve),
    supplyCurve,
    demandCurve,
  }
}

export function toPublic(session: Session): PublicSession {
  const { adminToken: _a, ...rest } = session
  return {
    ...rest,
    players: session.players.map(({ token: _t, ...p }) => p),
    currentPlayerId: getCurrentPlayerId(session),
    availableOffers: computeAvailableOffers(session),
    economics: getEconomics(),
    limits: { maxSellerUnits: MAX_SELLER_UNITS_LIMIT, maxRounds: MAX_ROUNDS_LIMIT },
    currentRoundMetrics: computeCurrentRoundMetrics(session),
  }
}
