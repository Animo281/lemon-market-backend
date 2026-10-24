import { Grade, Session, Player, Role, RoundResult, SellerDecision, BuyerDecision } from '../shared/types'
import { computeSellerEarnings, computeRoundMetrics } from '../services/gameAnalytics'
import { BUYER_GROUP_SIZE } from '../shared/constants'

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

// The buyers who may currently submit a decision: up to BUYER_GROUP_SIZE
// consecutive buyers from the queue, starting at the first undecided one,
// chunked into fixed BUYER_GROUP_SIZE-sized groups (chunk 0 = queue[0..n),
// chunk 1 = queue[n..2n), ...). Buyers in an earlier chunk have already
// decided; buyers in a later chunk aren't up yet. Derived rather than
// cached so it stays correct even if a kick removes entries mid-round.
export function activeBuyerIds(session: Session): string[] {
  const firstUndecided = session.buyerQueue.findIndex(id => !(id in session.currentBuyerDecisions))
  if (firstUndecided === -1) return []
  const chunkStart = Math.floor(firstUndecided / BUYER_GROUP_SIZE) * BUYER_GROUP_SIZE
  return session.buyerQueue
    .slice(chunkStart, chunkStart + BUYER_GROUP_SIZE)
    .filter(id => !(id in session.currentBuyerDecisions))
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
    turnDeadline: null,
    currentSellerDecisions: {},
    currentBuyerDecisions: {},
  }
}
