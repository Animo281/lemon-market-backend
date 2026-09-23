import { z } from 'zod'
import {
  MAX_SELLER_UNITS_LIMIT, MAX_ROUNDS_LIMIT, DEFAULT_MAX_SELLER_UNITS, DEFAULT_TOTAL_ROUNDS,
  MAX_SELLERS_LIMIT, MAX_BUYERS_LIMIT, DEFAULT_ECONOMICS,
} from '../shared/constants'

const gradeTableSchema = z.object({
  1: z.number().positive(),
  2: z.number().positive(),
  3: z.number().positive(),
})

// Q3 must be worth/cost more than Q2, which must be worth/cost more than Q1 —
// every other rule in the app (crate art, "best grade first" lists, the
// theoreticalMaxSurplus search) assumes quality is monotonically ordered by
// value and cost. Without this check a host could submit e.g. buyerValues
// {1: 10, 2: 5, 3: 1} and silently invert the game.
function monotonic(table: Record<1 | 2 | 3, number>): boolean {
  return table[1] < table[2] && table[2] < table[3]
}

export const economicsSchema = z.object({
  buyerValues: gradeTableSchema,
  sellerFirstCosts: gradeTableSchema,
}).superRefine((econ, ctx) => {
  if (!monotonic(econ.buyerValues)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['buyerValues'], message: 'Käuferwerte müssen mit der Qualität steigen: Q1 < Q2 < Q3.' })
  }
  if (!monotonic(econ.sellerFirstCosts)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sellerFirstCosts'], message: 'Verkäuferkosten müssen mit der Qualität steigen: Q1 < Q2 < Q3.' })
  }
})

export const createSessionSchema = z.object({
  numSellers: z.number().int().min(1).max(MAX_SELLERS_LIMIT).default(3),
  numBuyers: z.number().int().min(1).max(MAX_BUYERS_LIMIT).default(4),
  maxSellerUnits: z.number().int().min(1).max(MAX_SELLER_UNITS_LIMIT).default(DEFAULT_MAX_SELLER_UNITS),
  totalRounds: z.number().int().min(1).max(MAX_ROUNDS_LIMIT).default(DEFAULT_TOTAL_ROUNDS),
  economics: economicsSchema.default(DEFAULT_ECONOMICS),
})

export const joinSessionSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['seller', 'buyer']),
  slotIndex: z.number().int().min(0),
})

export const configSessionSchema = z.object({
  maxSellerUnits: z.number().int().min(1).max(MAX_SELLER_UNITS_LIMIT).optional(),
  totalRounds: z.number().int().min(1).max(MAX_ROUNDS_LIMIT).optional(),
  economics: economicsSchema.optional(),
})

export const sellerDecisionSchema = z.object({
  grade: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  price: z.number().positive(),
  unitsOffered: z.number().int().min(1).optional(),
})

export const buyerDecisionSchema = z.object({
  sellerId: z.string().nullable(),
})
