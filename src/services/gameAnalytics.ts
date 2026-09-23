import { EconomicsConfig, Grade, Session, RoundMetrics, AvailableOffer } from '../shared/types'
import { sellerCost } from '../shared/constants'

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

export function calcAsymmetricWTP(buyerValues: Record<Grade, number>, grades: Grade[]): number {
  if (!grades.length) return buyerValues[2]
  return grades.reduce((sum, g) => sum + buyerValues[g], 0) / grades.length
}

export function bestGradeWTP(buyerValues: Record<Grade, number>, grades: Grade[]): number {
  if (!grades.length) return buyerValues[2]
  return buyerValues[Math.max(...grades) as Grade]
}

// The paper's benchmark is "grade 2 is optimal" only because grade 2 happens
// to maximize per-unit surplus under the Holt & Sherman numbers — with a
// host-configurable economics table that's no longer guaranteed, so this
// searches all three grades instead of assuming grade 2. It's also
// capacity-aware: it only counts as many units as the market can actually
// clear (min(numBuyers, numSellers*maxSellerUnits)), and prices each
// successive unit at its real marginal cost (second, third... unit per
// seller costs more), instead of pricing every unit at the first-unit cost.
export function theoreticalMaxSurplus(
  economics: EconomicsConfig,
  numSellers: number,
  maxSellerUnits: number,
  numBuyers: number,
): number {
  const units = Math.min(numBuyers, numSellers * maxSellerUnits)
  if (units <= 0 || numSellers <= 0) return 0

  let best = 0
  for (const grade of [1, 2, 3] as Grade[]) {
    let surplus = 0
    for (let i = 0; i < units; i++) {
      const unitIndex = Math.floor(i / numSellers)
      const marginal = economics.buyerValues[grade] - sellerCost(economics.sellerFirstCosts, grade, unitIndex)
      if (marginal > 0) surplus += marginal
    }
    if (surplus > best) best = surplus
  }
  return best
}

export function computeSellerEarnings(
  sellerFirstCosts: Record<Grade, number>,
  grade: Grade,
  price: number,
  unitsSold: number,
): number {
  let total = 0
  for (let i = 0; i < unitsSold; i++) {
    total += price - sellerCost(sellerFirstCosts, grade, i)
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

export function buildDemandCurve(
  buyerValues: Record<Grade, number>,
  grades: Grade[],
  infoMode: 'full' | 'asymmetric',
  numBuyers: number,
): number[] {
  const wtp = infoMode === 'full' ? bestGradeWTP(buyerValues, grades) : calcAsymmetricWTP(buyerValues, grades)
  return Array(numBuyers).fill(wtp)
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
  const demandCurve = buildDemandCurve(session.economics.buyerValues, grades, infoMode, session.numBuyers)

  const totalSellerProfit = sellerDecisions.reduce((s, sd) => s + sd.earnings, 0)
  const totalBuyerProfit = buyerDecisions.reduce((s, bd) => s + bd.earnings, 0)

  const transactions = sellerDecisions.reduce((s, sd) => s + sd.unitsSold, 0)
  const txPrices = sellerDecisions.flatMap(sd =>
    Array(sd.unitsSold).fill(sd.price)
  )
  const avgTransactionPrice = txPrices.length > 0
    ? txPrices.reduce((s, p) => s + p, 0) / txPrices.length
    : null

  const maxSurplus = theoreticalMaxSurplus(session.economics, session.numSellers, session.maxSellerUnits, session.numBuyers)
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
    return {
      sellerId: seller.id,
      sellerName: seller.name,
      unitsOffered,
      unitsSold,
      unitsRemaining: Math.max(0, unitsOffered - unitsSold),
      price: d?.price ?? null,
      grade: session.infoMode === 'full' ? (d?.grade ?? null) : null,
    }
  })
}
