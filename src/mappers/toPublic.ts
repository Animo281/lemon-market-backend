import { Session, PublicSession, PublicEconomics, RoundMetrics, SellerDecision, BuyerDecision } from '../shared/types'
import {
  getCurrentPlayerId,
  computeAvailableOffers,
  computeSellerEarnings,
  computeRoundMetrics,
} from '../services/gameAnalytics'
import { LIMITS } from '../shared/constants'
import { Viewer } from '../shared/viewer'

// True exactly when the market board is still "live" and grades are supposed
// to be hidden from buyers — i.e. when revealing anything grade-derived would
// leak what the paper's procedure keeps secret until the instructor writes
// the round's grades on the board. Once the round is over (session.results),
// that reveal has happened and nothing needs masking anymore.
function isHiddenMarket(session: Session): boolean {
  return session.infoMode === 'asymmetric' && session.phase === 'market'
}

function computeCurrentRoundMetrics(session: Session, viewer: Viewer): RoundMetrics | null {
  if (session.phase !== 'market' && session.phase !== 'round-end') return null
  // totalBuyerProfit and the demand curve are both derived from buyer
  // earnings, which are grade-derived (earnings = buyerValues[grade] - price)
  // — showing them mid-round would let a non-admin reverse-engineer the
  // grade of every stand that's already sold, defeating maskedBuyerDecisions
  // below for no reason.
  if (isHiddenMarket(session) && viewer.kind !== 'admin') return null

  const sellers = session.players.filter(p => p.role === 'seller')
  const decided = sellers.map(s => {
    const d = session.currentSellerDecisions[s.id]
    return d?.price !== undefined
      ? { grade: d.grade!, price: d.price, unitsOffered: d.unitsOffered ?? session.maxSellerUnits, unitsSold: d.unitsSold ?? 0, earnings: computeSellerEarnings(session.economics.sellerFirstCosts, d.grade!, d.price, d.unitsSold ?? 0) }
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

// The seller-side mask above closed the devtools leak for currentSellerDecisions,
// but currentBuyerDecisions had the exact same hole from the other direction:
// BuyerDecision.grade is copied straight from the seller's decision the moment
// a buyer checks out (submitBuyerDecision in sessionService.ts), and .earnings
// is buyerValues[grade] - price — arithmetically reveals the grade even
// without the field. In the paper, buyers "do not find out the grade of their
// purchase until the instructor writes all sellers' grades in the table after
// all buyers are finished shopping" — so during a still-open asymmetric-info
// market, nobody but the admin gets grade/earnings here, not even the buyer
// who made the purchase themself. Once the round ends this stops applying —
// session.results[] is the paper's "aufgedeckte Tafel" and stays unmasked.
function maskedBuyerDecisions(
  session: Session,
  viewer: Viewer,
): Record<string, BuyerDecision> {
  if (!isHiddenMarket(session) || viewer.kind === 'admin') return session.currentBuyerDecisions

  const masked: Record<string, BuyerDecision> = {}
  for (const [buyerId, decision] of Object.entries(session.currentBuyerDecisions)) {
    masked[buyerId] = { ...decision, grade: null, earnings: 0 }
  }
  return masked
}

// The paper's own instructions keep each side's private-information table
// private ("do not reveal the private information tables of sellers' costs
// and buyers' values") — so unlike maxSellerUnits/totalRounds, which are
// public rules, buyerValues/sellerFirstCosts are split by role. A buyer only
// ever learns their own redemption values, a seller only their own costs;
// only the admin (running the debrief) sees both.
function maskedEconomics(session: Session, viewer: Viewer): PublicEconomics {
  if (viewer.kind === 'admin') return session.economics
  if (viewer.kind === 'player' && viewer.player.role === 'buyer') return { buyerValues: session.economics.buyerValues }
  if (viewer.kind === 'player' && viewer.player.role === 'seller') return { sellerFirstCosts: session.economics.sellerFirstCosts }
  return {}
}

export function toPublic(session: Session, viewer: Viewer = { kind: 'anonymous' }): PublicSession {
  const { adminToken: _a, economics: _e, currentBuyerDecisions: _b, ...rest } = session
  return {
    ...rest,
    players: session.players.map(({ token: _t, ...p }) => p),
    currentSellerDecisions: maskedSellerDecisions(session, viewer),
    currentBuyerDecisions: maskedBuyerDecisions(session, viewer),
    currentPlayerId: getCurrentPlayerId(session),
    availableOffers: computeAvailableOffers(session),
    economics: maskedEconomics(session, viewer),
    limits: LIMITS,
    currentRoundMetrics: computeCurrentRoundMetrics(session, viewer),
  }
}
