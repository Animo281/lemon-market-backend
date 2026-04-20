import { Grade, Session, RoundMetrics, AvailableOffer } from '../shared/types'
import { BUYER_VALUES, SELLER_COSTS, sellerCost } from '../shared/constants'
import { MAX_SELLER_UNITS_LIMIT, MAX_ROUNDS_LIMIT } from '../shared/constants'

export function findEquilibrium(supply: number[], demand: number[]): { qty: number; price: number } | null {
  if (!supply.length || !demand.length) return null
  const s = [...supply].sort((a, b) => a - b)
  const d = [...demand].sort((a, b) => b - a)
  let lastMatch = -1
  for (let i = 0; i < Math.min(s.length, d.length); i++) {
    if (d[i] >= s[i]) lastMatch = i
    else break
  }
  if (lastMatch < 0) return null
  return { qty: lastMatch + 1, price: (s[lastMatch] + d[lastMatch]) / 2 }
}

export function calcAsymmetricWTP(grades: Grade[]): number {
  if (!grades.length) return BUYER_VALUES[2]
  return grades.reduce((sum, g) => sum + BUYER_VALUES[g], 0) / grades.length
}

export function bestGradeWTP(grades: Grade[]): number {
  if (!grades.length) return BUYER_VALUES[2]
  return BUYER_VALUES[Math.max(...grades) as Grade]
}

export function theoreticalMaxSurplus(numBuyers: number): number {
  return numBuyers * (BUYER_VALUES[2] - sellerCost(2, 0))
}

export function computeSellerEarnings(grade: Grade, price: number, unitsSold: number): number {
  let total = 0
  for (let i = 0; i < unitsSold; i++) {
    total += price - sellerCost(grade, i)
  }
  return total
}

export function buildSupplyCurve(
  sellerDecisions: Array<{ price: number; unitsOffered: number }>,
): number[] {
  const prices: number[] = []
  for (const sd of sellerDecisions) {
    for (let i = 0; i < sd.unitsOffered; i++) prices.push(sd.price)
  }
  return prices.sort((a, b) => a - b)
}

export function buildDemandCurve(grades: Grade[], infoMode: 'full' | 'asymmetric', numBuyers: number): number[] {
  const wtp = infoMode === 'full' ? bestGradeWTP(grades) : calcAsymmetricWTP(grades)
  return Array(numBuyers).fill(wtp).sort((a, b) => b - a)
}

export function computeRoundMetrics(
  session: Session,
  sellerDecisions: Array<{ grade: Grade; price: number; unitsOffered: number; unitsSold: number; earnings: number }>,
  buyerDecisions: Array<{ earnings: number }>,
  infoMode: 'full' | 'asymmetric',
  totalSurplus: number,
): RoundMetrics {
  const grades = sellerDecisions.map(sd => sd.grade)
  const supplyCurve = buildSupplyCurve(sellerDecisions)
  const demandCurve = buildDemandCurve(grades, infoMode, session.numBuyers)

  const totalSellerProfit = sellerDecisions.reduce((s, sd) => s + sd.earnings, 0)
  const totalBuyerProfit = buyerDecisions.reduce((s, bd) => s + bd.earnings, 0)

  const transactions = sellerDecisions.reduce((s, sd) => s + sd.unitsSold, 0)
  const txPrices = sellerDecisions.flatMap(sd =>
    Array(sd.unitsSold).fill(sd.price)
  )
  const avgTransactionPrice = txPrices.length > 0
    ? txPrices.reduce((s, p) => s + p, 0) / txPrices.length
    : null

  const maxSurplus = theoreticalMaxSurplus(session.numBuyers)
  const efficiency = maxSurplus > 0 ? totalSurplus / maxSurplus : 0
  const equilibrium = findEquilibrium(supplyCurve, demandCurve)

  return {
    totalSellerProfit,
    totalBuyerProfit,
    avgTransactionPrice,
    transactions,
    theoreticalMaxSurplus: maxSurplus,
    efficiency,
    equilibrium,
    supplyCurve,
    demandCurve,
  }
}

export function getCurrentPlayerId(session: Session): string | null {
  if (session.phase !== 'market') return null
  return session.buyerQueue[session.currentBuyerIndex] ?? null
}

export function computeAvailableOffers(session: Session): AvailableOffer[] {
  const sellers = session.players.filter(p => p.role === 'seller')
  return sellers.map(seller => {
    const d = session.currentSellerDecisions[seller.id]
    const unitsOffered = d?.unitsOffered ?? session.maxSellerUnits
    const unitsSold = d?.unitsSold ?? 0
    const showGrade = session.infoMode === 'full' && d?.grade !== undefined
    return {
      sellerId: seller.id,
      sellerName: seller.name,
      unitsOffered,
      unitsSold,
      unitsRemaining: Math.max(0, unitsOffered - unitsSold),
      price: d?.price ?? null,
      grade: showGrade ? (d!.grade as Grade) : null,
    }
  })
}

export function getEconomics() {
  return {
    buyerValues: BUYER_VALUES,
    sellerCosts: ([1, 2, 3] as Grade[]).map(grade => ({
      grade,
      first: SELLER_COSTS[grade].first,
      second: SELLER_COSTS[grade].second,
    })),
  }
}

export { MAX_SELLER_UNITS_LIMIT, MAX_ROUNDS_LIMIT }
