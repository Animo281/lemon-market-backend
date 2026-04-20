import { describe, it, expect } from 'vitest'
import { calculateBuyerEarnings, shuffleArray, computeRoundResult } from '../src/lib/gameLogic'
import { Session } from '../src/shared/types'

describe('calculateBuyerEarnings', () => {
  it('returns 0 when grade or price is null', () => {
    expect(calculateBuyerEarnings(null, null)).toBe(0)
    expect(calculateBuyerEarnings(1, null)).toBe(0)
    expect(calculateBuyerEarnings(null, 1)).toBe(0)
  })

  it('computes grade 1: value 4.0 - price', () => {
    expect(calculateBuyerEarnings(1, 2.0)).toBeCloseTo(2.0)
  })

  it('computes grade 2: value 8.8 - price', () => {
    expect(calculateBuyerEarnings(2, 5.0)).toBeCloseTo(3.8)
  })

  it('computes grade 3: value 13.6 - price', () => {
    expect(calculateBuyerEarnings(3, 11.0)).toBeCloseTo(2.6)
  })

  it('returns negative earnings if price exceeds value', () => {
    expect(calculateBuyerEarnings(1, 5.0)).toBeCloseTo(-1.0)
  })
})

describe('shuffleArray', () => {
  it('returns same length', () => {
    const arr = [1, 2, 3, 4, 5]
    expect(shuffleArray(arr)).toHaveLength(arr.length)
  })

  it('contains all original elements', () => {
    const arr = [1, 2, 3, 4, 5]
    expect(shuffleArray(arr).sort()).toEqual([...arr].sort())
  })

  it('does not mutate original', () => {
    const arr = [1, 2, 3]
    const original = [...arr]
    shuffleArray(arr)
    expect(arr).toEqual(original)
  })
})

describe('computeRoundResult', () => {
  it('computes surplus and round result correctly', () => {
    const session: Session = {
      id: 's1', code: 'TEST', adminToken: 'admin',
      numSellers: 1, numBuyers: 1,
      maxSellerUnits: 2, totalRounds: 5,
      phase: 'round-end', currentRound: 1, infoMode: 'full',
      players: [
        { id: 'seller1', token: 'tok1', name: 'Alice', role: 'seller', slotIndex: 0 },
        { id: 'buyer1', token: 'tok2', name: 'Bob', role: 'buyer', slotIndex: 0 },
      ],
      buyerQueue: ['buyer1'], currentBuyerIndex: 0,
      currentSellerDecisions: {
        seller1: { playerId: 'seller1', grade: 2, price: 6.0, unitsOffered: 2, unitsSold: 1, confirmed: false },
      },
      currentBuyerDecisions: {
        buyer1: { playerId: 'buyer1', sellerId: 'seller1', grade: 2, price: 6.0, earnings: 2.8 },
      },
      results: [],
    }

    const result = computeRoundResult(session)
    expect(result.round).toBe(1)
    expect(result.infoMode).toBe('full')
    expect(result.sellerDecisions).toHaveLength(1)
    expect(result.buyerDecisions).toHaveLength(1)
    // seller profit: 6.0 - 4.6 = 1.4, buyer earnings: 2.8
    expect(result.totalSurplus).toBeCloseTo(1.4 + 2.8)
  })
})
