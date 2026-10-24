import { describe, it, expect } from 'vitest'
import { calculateBuyerEarnings, shuffleArray, computeRoundResult, activeBuyerIds } from '../src/lib/gameLogic'
import { Session } from '../src/shared/types'
import { DEFAULT_BUYER_VALUES, DEFAULT_ECONOMICS, BUYER_GROUP_SIZE } from '../src/shared/constants'

function sessionWithQueue(buyerQueue: string[], currentBuyerDecisions: Record<string, unknown> = {}): Session {
  return {
    id: 's1', code: 'TEST', adminToken: 'admin',
    numSellers: 1, numBuyers: buyerQueue.length,
    maxSellerUnits: 2, totalRounds: 5,
    economics: DEFAULT_ECONOMICS,
    phase: 'market', currentRound: 1, infoMode: 'full',
    players: [],
    buyerQueue, turnDeadline: null, turnDurationSeconds: 30,
    currentSellerDecisions: {},
    currentBuyerDecisions: currentBuyerDecisions as Session['currentBuyerDecisions'],
    results: [],
  }
}

describe('calculateBuyerEarnings', () => {
  it('returns 0 when grade or price is null', () => {
    expect(calculateBuyerEarnings(DEFAULT_BUYER_VALUES, null, null)).toBe(0)
    expect(calculateBuyerEarnings(DEFAULT_BUYER_VALUES, 1, null)).toBe(0)
    expect(calculateBuyerEarnings(DEFAULT_BUYER_VALUES, null, 1)).toBe(0)
  })

  it('computes grade 1: value 4.0 - price', () => {
    expect(calculateBuyerEarnings(DEFAULT_BUYER_VALUES, 1, 2.0)).toBeCloseTo(2.0)
  })

  it('computes grade 2: value 8.8 - price', () => {
    expect(calculateBuyerEarnings(DEFAULT_BUYER_VALUES, 2, 5.0)).toBeCloseTo(3.8)
  })

  it('computes grade 3: value 13.6 - price', () => {
    expect(calculateBuyerEarnings(DEFAULT_BUYER_VALUES, 3, 11.0)).toBeCloseTo(2.6)
  })

  it('returns negative earnings if price exceeds value', () => {
    expect(calculateBuyerEarnings(DEFAULT_BUYER_VALUES, 1, 5.0)).toBeCloseTo(-1.0)
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

describe('activeBuyerIds', () => {
  it('returns the first BUYER_GROUP_SIZE buyers when nobody has decided yet', () => {
    expect(BUYER_GROUP_SIZE).toBe(3)
    expect(activeBuyerIds(sessionWithQueue(['b1', 'b2', 'b3', 'b4']))).toEqual(['b1', 'b2', 'b3'])
  })

  it('shrinks as members of the active group decide, without pulling in the next group', () => {
    expect(activeBuyerIds(sessionWithQueue(['b1', 'b2', 'b3', 'b4'], { b1: {} }))).toEqual(['b2', 'b3'])
  })

  it('moves to the next group once the whole current group has decided', () => {
    const session = sessionWithQueue(['b1', 'b2', 'b3', 'b4', 'b5'], { b1: {}, b2: {}, b3: {} })
    expect(activeBuyerIds(session)).toEqual(['b4', 'b5'])
  })

  it('returns an empty array once everyone has decided', () => {
    expect(activeBuyerIds(sessionWithQueue(['b1', 'b2'], { b1: {}, b2: {} }))).toEqual([])
  })

  it('returns an empty array for an empty queue', () => {
    expect(activeBuyerIds(sessionWithQueue([]))).toEqual([])
  })
})

describe('computeRoundResult', () => {
  it('computes surplus and round result correctly', () => {
    const session: Session = {
      id: 's1', code: 'TEST', adminToken: 'admin',
      numSellers: 1, numBuyers: 1,
      maxSellerUnits: 2, totalRounds: 5,
      economics: DEFAULT_ECONOMICS,
      phase: 'round-end', currentRound: 1, infoMode: 'full',
      players: [
        { id: 'seller1', token: 'tok1', name: 'Alice', role: 'seller', slotIndex: 0 },
        { id: 'buyer1', token: 'tok2', name: 'Bob', role: 'buyer', slotIndex: 0 },
      ],
      buyerQueue: ['buyer1'], turnDeadline: null, turnDurationSeconds: 30,
      currentSellerDecisions: {
        seller1: { playerId: 'seller1', grade: 2, price: 6.0, unitsOffered: 2, unitsSold: 1 },
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
