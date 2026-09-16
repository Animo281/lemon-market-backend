import { Session, PublicSession, RoundMetrics, SellerDecision } from '../shared/types'
import {
  getCurrentPlayerId,
  computeAvailableOffers,
  getEconomics,
  computeSellerEarnings,
  computeRoundMetrics,
} from '../services/gameAnalytics'
import { LIMITS } from '../shared/constants'
import { Viewer } from '../middleware/sessionMiddleware'

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

// computeAvailableOffers() already masks `grade` correctly for the offer
// list, but currentSellerDecisions was being spread into every response
// verbatim — including the real grade, in the clear, to any caller with the
// session code. That defeats the whole "asymmetric info" mechanic for anyone
// who opens devtools. Only admins and each seller's own decision keep the
// real grade; everyone else sees it masked while infoMode is 'asymmetric',
// same rule computeAvailableOffers already applies.
function maskedSellerDecisions(
  session: Session,
  viewer: Viewer,
): Record<string, Partial<SellerDecision>> {
  if (session.infoMode === 'full' || viewer.kind === 'admin') return session.currentSellerDecisions

  const ownId = viewer.kind === 'player' ? viewer.player.id : null
  const masked: Record<string, Partial<SellerDecision>> = {}
  for (const [sellerId, decision] of Object.entries(session.currentSellerDecisions)) {
    masked[sellerId] = sellerId === ownId ? decision : { ...decision, grade: undefined }
  }
  return masked
}

export function toPublic(session: Session, viewer: Viewer = { kind: 'anonymous' }): PublicSession {
  const { adminToken: _a, ...rest } = session
  return {
    ...rest,
    players: session.players.map(({ token: _t, ...p }) => p),
    currentSellerDecisions: maskedSellerDecisions(session, viewer),
    currentPlayerId: getCurrentPlayerId(session),
    availableOffers: computeAvailableOffers(session),
    economics: getEconomics(),
    limits: LIMITS,
    currentRoundMetrics: computeCurrentRoundMetrics(session),
  }
}
