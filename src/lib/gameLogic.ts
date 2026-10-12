import { Grade, Session, Player, Role, RoundResult, SellerDecision, BuyerDecision } from '../shared/types'
import { computeSellerEarnings, computeRoundMetrics } from '../services/gameAnalytics'

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function playersByRole(session: Session, role: Role): Player[] {
  return session.players.filter(p => p.role === role)
}

export function shuffledBuyerQueue(session: Session): string[] {
  return shuffleArray(playersByRole(session, 'buyer').map(b => b.id))
}

export function noPurchase(playerId: string): BuyerDecision {
  return { playerId, sellerId: null, grade: null, price: null, earnings: 0 }
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
  const sellers = playersByRole(session, 'seller')
  const buyers = playersByRole(session, 'buyer')

  const sellerDecisions: SellerDecision[] = sellers.map(seller => {
    const d = session.currentSellerDecisions[seller.id]
    const grade = d?.grade ?? 1
    const price = d?.price ?? 0
    const unitsSold = d?.unitsSold ?? 0
    return {
      playerId: seller.id,
      grade,
      price,
      unitsOffered: d?.unitsOffered ?? session.maxSellerUnits,
      unitsSold,
      earnings: computeSellerEarnings(session.economics, grade, price, unitsSold),
    }
  })

  const buyerDecisions: BuyerDecision[] = buyers.map(buyer =>
    session.currentBuyerDecisions[buyer.id] ?? noPurchase(buyer.id)
  )

  const totalSurplus = Math.round((
    sellerDecisions.reduce((s, sd) => s + sd.earnings, 0)
    + buyerDecisions.reduce((s, bd) => s + bd.earnings, 0)
  ) * 100) / 100

  const metrics = computeRoundMetrics(session, sellerDecisions, buyerDecisions, session.infoMode, totalSurplus)

  return { round: session.currentRound, infoMode: session.infoMode, sellerDecisions, buyerDecisions, totalSurplus, metrics }
}

export function advanceRound(session: Session): Session {
  const nextRound = session.currentRound + 1
  const isGameEnd = nextRound > session.totalRounds
  return {
    ...session,
    // At game-end, stay at totalRounds instead of overshooting to totalRounds + 1.
    currentRound: isGameEnd ? session.totalRounds : nextRound,
    phase: isGameEnd ? 'game-end' : 'seller-input',
    buyerQueue: shuffledBuyerQueue(session),
    currentBuyerIndex: 0,
    currentSellerDecisions: {},
    currentBuyerDecisions: {},
  }
}
