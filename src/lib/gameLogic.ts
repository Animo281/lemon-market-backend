import { Grade, Session, RoundResult, SellerDecision, BuyerDecision } from '../shared/types'
import { computeSellerEarnings, computeRoundMetrics } from '../services/gameAnalytics'

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function calculateBuyerEarnings(
  buyerValues: Record<Grade, number>,
  grade: Grade | null,
  price: number | null,
): number {
  if (grade === null || price === null) return 0
  return Math.round((buyerValues[grade] - price) * 100) / 100
}

// Returns the index of the first buyer in the queue without a decision yet,
// or buyerQueue.length once everyone has decided. Derived rather than
// incremented so it stays correct even if a kick removes entries mid-round.
export function findNextBuyerIndex(
  buyerQueue: string[],
  decisions: Record<string, unknown>,
): number {
  const next = buyerQueue.findIndex(id => !(id in decisions))
  return next === -1 ? buyerQueue.length : next
}

export function computeRoundResult(session: Session): RoundResult {
  const sellers = session.players.filter(p => p.role === 'seller')
  const buyers = session.players.filter(p => p.role === 'buyer')

  const sellerDecisions: SellerDecision[] = sellers.map(seller => {
    const d = session.currentSellerDecisions[seller.id]
    const grade = (d?.grade ?? 1) as Grade
    const price = d?.price ?? 0
    const unitsSold = d?.unitsSold ?? 0
    return {
      playerId: seller.id,
      grade,
      price,
      unitsOffered: d?.unitsOffered ?? session.maxSellerUnits,
      unitsSold,
      earnings: computeSellerEarnings(session.economics.sellerFirstCosts, grade, price, unitsSold),
    }
  })

  const buyerDecisions: BuyerDecision[] = buyers.map(buyer =>
    session.currentBuyerDecisions[buyer.id] ?? {
      playerId: buyer.id,
      sellerId: null,
      grade: null,
      price: null,
      earnings: 0,
    }
  )

  let totalSurplus = sellerDecisions.reduce((s, sd) => s + sd.earnings, 0)
    + buyerDecisions.reduce((s, bd) => s + bd.earnings, 0)

  totalSurplus = Math.round(totalSurplus * 100) / 100

  const metrics = computeRoundMetrics(session, sellerDecisions, buyerDecisions, session.infoMode, totalSurplus)

  return { round: session.currentRound, infoMode: session.infoMode, sellerDecisions, buyerDecisions, totalSurplus, metrics }
}

export function advanceRound(session: Session): Session {
  const nextRound = session.currentRound + 1
  const isGameEnd = nextRound > session.totalRounds
  const buyers = session.players.filter(p => p.role === 'buyer')
  return {
    ...session,
    // At game-end, stay at totalRounds instead of overshooting to
    // totalRounds + 1 — nothing plays a round that doesn't exist, so
    // "Runde 6 von 5" on the results screen was a pure display bug.
    currentRound: isGameEnd ? session.totalRounds : nextRound,
    phase: isGameEnd ? 'game-end' : 'seller-input',
    buyerQueue: shuffleArray(buyers.map(b => b.id)),
    currentBuyerIndex: 0,
    currentSellerDecisions: {},
    currentBuyerDecisions: {},
  }
}
