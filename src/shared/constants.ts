import { EconomicsConfig, Grade } from './types'

// Holt & Sherman (1999) parameters — the default a session starts with, but
// the host can override both tables (and unitCostStep) at session.create
// and while still in 'lobby', see schemas/session.ts.
export const DEFAULT_BUYER_VALUES: Record<Grade, number> = { 1: 4.0, 2: 8.8, 3: 13.6 }
export const DEFAULT_SELLER_FIRST_COSTS: Record<Grade, number> = { 1: 1.4, 2: 4.6, 3: 11.0 }
// The paper's own rule: "2nd unit costs $1 more".
export const UNIT_COST_STEP = 1.00
export const DEFAULT_ECONOMICS: EconomicsConfig = {
  buyerValues: DEFAULT_BUYER_VALUES,
  sellerFirstCosts: DEFAULT_SELLER_FIRST_COSTS,
  unitCostStep: UNIT_COST_STEP,
}

// Marginal cost per unit (0-based index): firstCosts[grade] + index * step.
export function sellerCost(firstCosts: Record<Grade, number>, grade: Grade, unitIndex: number, step: number): number {
  return firstCosts[grade] + unitIndex * step
}

export const MAX_SELLER_UNITS_LIMIT = 5
export const MAX_ROUNDS_LIMIT = 20
// No fixed round count is chosen up front anymore — the admin ends the game
// after whichever round they like via POST /:code/end-game. totalRounds is
// kept only as a hard safety ceiling (and still overridable via config), so
// it defaults to the max instead of a small curated number.
export const DEFAULT_TOTAL_ROUNDS = MAX_ROUNDS_LIMIT
export const DEFAULT_MAX_SELLER_UNITS = 2

// Classroom-sized upper bounds on session.create — without these, a huge
// numBuyers/numSellers reaches an Array(n) allocation in gameAnalytics
// (demand curve) and either crashes with a RangeError or exhausts memory.
export const MAX_SELLERS_LIMIT = 12
export const MAX_BUYERS_LIMIT = 24

// Market phase: buyers act in small groups instead of strictly one at a
// time, so a classroom of up to 24 buyers doesn't bottleneck on a single
// queue. Fixed for now (not per-session configurable) to keep the surface
// small — later buyers in the next group still see which stands already
// sold out, partially preserving the paper's "later buyers see less"
// mechanic while cutting wait time roughly by this factor.
export const BUYER_GROUP_SIZE = 3

// Per-turn timer: the admin sets the duration at session.create (like
// maxSellerUnits), a group's deadline resets whenever a *new* group starts
// (not on every individual decision) — see sessionService.checkPhaseTransition.
export const DEFAULT_TURN_DURATION_SECONDS = 30
export const MIN_TURN_DURATION_SECONDS = 10
export const MAX_TURN_DURATION_SECONDS = 180

// Feedback from a live classroom test: sellers were pricing arbitrarily far
// above any buyer's value. A seller still must never price below their own
// cost (checked dynamically against the chosen grade's cost in
// sessionService.submitSellerDecision — that depends on the session's own
// economics, so it can't live in the static Zod schema), but the ceiling is
// a flat, configurable number.
export const MAX_SELLER_PRICE = 40

export const LIMITS = Object.freeze({
  maxSellerUnits: MAX_SELLER_UNITS_LIMIT,
  maxRounds: MAX_ROUNDS_LIMIT,
  maxSellers: MAX_SELLERS_LIMIT,
  maxBuyers: MAX_BUYERS_LIMIT,
  minTurnDurationSeconds: MIN_TURN_DURATION_SECONDS,
  maxTurnDurationSeconds: MAX_TURN_DURATION_SECONDS,
  maxSellerPrice: MAX_SELLER_PRICE,
})
