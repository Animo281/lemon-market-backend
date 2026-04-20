import { Grade, Session, RoundResult, SellerDecision, BuyerDecision } from '../shared/types'
import { BUYER_VALUES, sellerCost } from '../shared/constants'
import { computeSellerEarnings, computeRoundMetrics } from '../services/gameAnalytics'

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function calculateBuyerEarnings(grade: Grade | null, price: number | null): number {
  if (grade === null || price === null) return 0
  return BUYER_VALUES[grade] - price
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
      confirmed: true,
      earnings: computeSellerEarnings(grade, price, unitsSold),
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

  let totalSurplus = 0
  for (const sd of sellerDecisions) {
    for (let i = 0; i < sd.unitsSold; i++) {
      totalSurplus += sd.price - sellerCost(sd.grade, i)
    }
  }
  for (const bd of buyerDecisions) {
    totalSurplus += bd.earnings
  }

  const metrics = computeRoundMetrics(session, sellerDecisions, buyerDecisions, session.infoMode, totalSurplus)

  return { round: session.currentRound, infoMode: session.infoMode, sellerDecisions, buyerDecisions, totalSurplus, metrics }
}

export function advanceRound(session: Session): Session {
  const nextRound = session.currentRound + 1
  const nextPhase = nextRound > session.totalRounds ? 'game-end' : 'seller-input'
  const buyers = session.players.filter(p => p.role === 'buyer')
  return {
    ...session,
    currentRound: nextRound,
    phase: nextPhase,
    buyerQueue: shuffleArray(buyers.map(b => b.id)),
    currentBuyerIndex: 0,
    currentSellerDecisions: {},
    currentBuyerDecisions: {},
  }
}
