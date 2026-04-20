import { z } from 'zod'
import { MAX_SELLER_UNITS_LIMIT, MAX_ROUNDS_LIMIT, DEFAULT_MAX_SELLER_UNITS, DEFAULT_TOTAL_ROUNDS } from '../shared/constants'

export const createSessionSchema = z.object({
  numSellers: z.number().int().min(1).default(3),
  numBuyers: z.number().int().min(1).default(4),
  maxSellerUnits: z.number().int().min(1).max(MAX_SELLER_UNITS_LIMIT).default(DEFAULT_MAX_SELLER_UNITS),
  totalRounds: z.number().int().min(1).max(MAX_ROUNDS_LIMIT).default(DEFAULT_TOTAL_ROUNDS),
})

export const joinSessionSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['seller', 'buyer']),
  slotIndex: z.number().int().min(0),
})

export const configSessionSchema = z.object({
  maxSellerUnits: z.number().int().min(1).max(MAX_SELLER_UNITS_LIMIT).optional(),
  totalRounds: z.number().int().min(1).max(MAX_ROUNDS_LIMIT).optional(),
})

export const sellerDecisionSchema = z.object({
  grade: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  price: z.number().nonnegative(),
  unitsOffered: z.number().int().min(1).optional(),
})

export const buyerDecisionSchema = z.object({
  sellerId: z.string().nullable(),
})
