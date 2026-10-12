import { EconomicsConfig, Grade } from './types'

// Holt & Sherman (1999) parameters — the default a session starts with, but no
// longer the only values: the host can override both tables at session.create
// (and while still in 'lobby'), see schemas/session.ts. Only the per-unit cost
// step (below) is a fixed game rule rather than a per-session parameter.
export const DEFAULT_BUYER_VALUES: Record<Grade, number> = { 1: 4.0, 2: 8.8, 3: 13.6 }
export const DEFAULT_SELLER_FIRST_COSTS: Record<Grade, number> = { 1: 1.4, 2: 4.6, 3: 11.0 }
// The paper's own fixed rule ("2nd unit costs $1 more") — kept as the default
// value, but host-configurable per session via economics.unitCostStep.
export const UNIT_COST_STEP = 1.00
export const DEFAULT_ECONOMICS: EconomicsConfig = {
  buyerValues: DEFAULT_BUYER_VALUES,
  sellerFirstCosts: DEFAULT_SELLER_FIRST_COSTS,
  unitCostStep: UNIT_COST_STEP,
}

// Marginal cost per unit (0-based index): firstCosts[grade] + index * step.
// step defaults to UNIT_COST_STEP for callers that don't carry a full
// economics config in scope; pass economics.unitCostStep where available.
export function sellerCost(firstCosts: Record<Grade, number>, grade: Grade, unitIndex: number, step: number = UNIT_COST_STEP): number {
  return firstCosts[grade] + unitIndex * step
}

export const DEFAULT_TOTAL_ROUNDS = 5
export const DEFAULT_MAX_SELLER_UNITS = 2
export const MAX_SELLER_UNITS_LIMIT = 5
export const MAX_ROUNDS_LIMIT = 20

// Classroom-sized upper bounds on session.create — without these, a huge
// numBuyers/numSellers reaches an Array(n) allocation in gameAnalytics
// (demand curve) and either crashes with a RangeError or exhausts memory.
export const MAX_SELLERS_LIMIT = 10
export const MAX_BUYERS_LIMIT = 20

export const LIMITS = Object.freeze({
  maxSellerUnits: MAX_SELLER_UNITS_LIMIT,
  maxRounds: MAX_ROUNDS_LIMIT,
  maxSellers: MAX_SELLERS_LIMIT,
  maxBuyers: MAX_BUYERS_LIMIT,
})
