import { Session, PublicSession, RoundMetrics } from '../shared/types'
import {
  getCurrentPlayerId,
  computeAvailableOffers,
  getEconomics,
  computeSellerEarnings,
  computeRoundMetrics,
} from '../services/gameAnalytics'
import { LIMITS } from '../shared/constants'

function computeCurrentRoundMetrics(session: Session): RoundMetrics | null {
  if (session.phase !== 'market' && session.phase !== 'round-end') return null

  const sellers = session.players.filter(p => p.role === 'seller')
  const decided = sellers.map(s => {
    const d = session.currentSellerDecisions[s.id]
    return d?.price !== undefined
      ? { grade: d.grade!, price: d.price, unitsOffered: d.unitsOffered ?? session.maxSellerUnits, unitsSold: d.unitsSold ?? 0, earnings: computeSellerEarnings(d.grade!, d.price, d.unitsSold ?? 0) }
      : null
  }).filter((d): d is NonNullable<typeof d> => d !== null)

  const buyerDecisions = Object.values(session.currentBuyerDecisions)
  const totalSurplus = decided.reduce((s, d) => s + d.earnings, 0) + buyerDecisions.reduce((s, bd) => s + bd.earnings, 0)

  return computeRoundMetrics(session, decided, buyerDecisions, session.infoMode, totalSurplus)
}

export function toPublic(session: Session): PublicSession {
  const { adminToken: _a, ...rest } = session
  return {
    ...rest,
    players: session.players.map(({ token: _t, ...p }) => p),
    currentPlayerId: getCurrentPlayerId(session),
    availableOffers: computeAvailableOffers(session),
    economics: getEconomics(),
    limits: LIMITS,
    currentRoundMetrics: computeCurrentRoundMetrics(session),
  }
}
