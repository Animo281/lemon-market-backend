import { Grade } from './types'

export const BUYER_VALUES: Record<Grade, number> = { 1: 4.0, 2: 8.8, 3: 13.6 }

export const SELLER_COSTS: Record<Grade, { first: number; second: number }> = {
  1: { first: 1.4, second: 2.4 },
  2: { first: 4.6, second: 5.6 },
  3: { first: 11.0, second: 12.0 },
}

// Marginal cost per unit (0-based index): first + index * 1.00
// Reproduces existing two-unit costs and extrapolates consistently
export function sellerCost(grade: Grade, unitIndex: number): number {
  return SELLER_COSTS[grade].first + unitIndex * 1.00
}

export const DEFAULT_TOTAL_ROUNDS = 5
export const DEFAULT_MAX_SELLER_UNITS = 2
