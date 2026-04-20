import { describe, it, expect } from 'vitest'
import {
  findEquilibrium,
  calcAsymmetricWTP,
  bestGradeWTP,
  theoreticalMaxSurplus,
  computeSellerEarnings,
  buildSupplyCurve,
  buildDemandCurve,
  computeRoundMetrics,
  getCurrentPlayerId,
  computeAvailableOffers,
} from '../src/services/gameAnalytics'
import { Session } from '../src/shared/types'

const baseSession: Session = {
  id: 's1', code: 'TEST', adminToken: 'admin',
  numSellers: 2, numBuyers: 3,
  maxSellerUnits: 2, totalRounds: 5,
  phase: 'market', currentRound: 1, infoMode: 'full',
  players: [
    { id: 'sel1', token: 't1', name: 'Alice', role: 'seller', slotIndex: 0 },
    { id: 'sel2', token: 't2', name: 'Bob', role: 'seller', slotIndex: 1 },
    { id: 'buy1', token: 't3', name: 'Carol', role: 'buyer', slotIndex: 0 },
    { id: 'buy2', token: 't4', name: 'Dave', role: 'buyer', slotIndex: 1 },
    { id: 'buy3', token: 't5', name: 'Eve', role: 'buyer', slotIndex: 2 },
  ],
  buyerQueue: ['buy1', 'buy2', 'buy3'], currentBuyerIndex: 1,
  currentSellerDecisions: {
    sel1: { playerId: 'sel1', grade: 2, price: 6.0, unitsOffered: 2, unitsSold: 1, confirmed: false, earnings: 0 },
    sel2: { playerId: 'sel2', grade: 1, price: 3.0, unitsOffered: 1, unitsSold: 0, confirmed: false, earnings: 0 },
  },
  currentBuyerDecisions: {},
  results: [],
}

describe('findEquilibrium', () => {
  it('returns null for empty inputs', () => {
    expect(findEquilibrium([], [3, 5])).toBeNull()
    expect(findEquilibrium([2, 4], [])).toBeNull()
  })

  it('finds equilibrium where supply <= demand', () => {
    // supply=[3,5], demand=[6,4]: at qty=2 demand(4) < supply(5) → only 1 trade clears
    const eq = findEquilibrium([3, 5], [6, 4])
    expect(eq).not.toBeNull()
    expect(eq!.qty).toBe(1)
    expect(eq!.price).toBeCloseTo(4.5)
  })

  it('finds equilibrium for 2 trades when both clear', () => {
    // supply=[3,4], demand=[6,5]: qty=2 both clear
    const eq = findEquilibrium([3, 4], [6, 5])
    expect(eq).not.toBeNull()
    expect(eq!.qty).toBe(2)
    expect(eq!.price).toBeCloseTo(4.5)
  })

  it('returns null when no trades possible', () => {
    expect(findEquilibrium([8, 10], [2, 3])).toBeNull()
  })

  it('handles single unit match', () => {
    const eq = findEquilibrium([5], [7])
    expect(eq!.qty).toBe(1)
    expect(eq!.price).toBeCloseTo(6)
  })
})

describe('calcAsymmetricWTP', () => {
  it('returns grade 2 value as default for empty grades', () => {
    expect(calcAsymmetricWTP([])).toBe(8.8)
  })

  it('averages buyer values for mixed grades', () => {
    // grades [1, 2]: (4.0 + 8.8) / 2 = 6.4
    expect(calcAsymmetricWTP([1, 2])).toBeCloseTo(6.4)
  })

  it('returns single grade value for uniform grade', () => {
    expect(calcAsymmetricWTP([3, 3])).toBeCloseTo(13.6)
  })
})

describe('bestGradeWTP', () => {
  it('returns value of best grade', () => {
    expect(bestGradeWTP([1, 2, 3])).toBe(13.6)
    expect(bestGradeWTP([1, 2])).toBe(8.8)
  })

  it('defaults to grade 2 for empty', () => {
    expect(bestGradeWTP([])).toBe(8.8)
  })
})

describe('theoreticalMaxSurplus', () => {
  it('computes numBuyers * (BUYER_VALUES[2] - sellerCost(2, 0))', () => {
    // 3 * (8.8 - 4.6) = 3 * 4.2 = 12.6
    expect(theoreticalMaxSurplus(3)).toBeCloseTo(12.6)
  })
})

describe('computeSellerEarnings', () => {
  it('returns 0 for 0 units sold', () => {
    expect(computeSellerEarnings(2, 6.0, 0)).toBe(0)
  })

  it('computes earnings for grade 2 at price 6: (6-4.6) = 1.4 for 1 unit', () => {
    expect(computeSellerEarnings(2, 6.0, 1)).toBeCloseTo(1.4)
  })

  it('computes earnings for 2 units: (6-4.6) + (6-5.6) = 1.4 + 0.4 = 1.8', () => {
    expect(computeSellerEarnings(2, 6.0, 2)).toBeCloseTo(1.8)
  })
})

describe('buildSupplyCurve', () => {
  it('returns sorted ask prices', () => {
    const curve = buildSupplyCurve([
      { price: 5, unitsOffered: 2 },
      { price: 3, unitsOffered: 1 },
    ])
    expect(curve).toEqual([3, 5, 5])
  })
})

describe('buildDemandCurve', () => {
  it('full info: repeats best-grade WTP for all buyers', () => {
    const curve = buildDemandCurve([2, 1], 'full', 3)
    // bestGradeWTP([2,1]) = BUYER_VALUES[2] = 8.8
    expect(curve).toHaveLength(3)
    expect(curve.every(v => Math.abs(v - 8.8) < 0.001)).toBe(true)
  })

  it('asymmetric info: repeats average WTP', () => {
    const curve = buildDemandCurve([1, 2], 'asymmetric', 2)
    // avg = (4.0 + 8.8)/2 = 6.4
    expect(curve.every(v => Math.abs(v - 6.4) < 0.001)).toBe(true)
  })
})

describe('computeRoundMetrics', () => {
  it('computes all fields for a simple round', () => {
    const sellerDecisions = [
      { grade: 2 as const, price: 6.0, unitsOffered: 2, unitsSold: 1, earnings: 1.4 },
    ]
    const buyerDecisions = [{ earnings: 2.8 }]
    const metrics = computeRoundMetrics(baseSession, sellerDecisions, buyerDecisions, 'full', 4.2)

    expect(metrics.transactions).toBe(1)
    expect(metrics.totalSellerProfit).toBeCloseTo(1.4)
    expect(metrics.totalBuyerProfit).toBeCloseTo(2.8)
    expect(metrics.avgTransactionPrice).toBeCloseTo(6.0)
    expect(metrics.theoreticalMaxSurplus).toBeCloseTo(12.6) // 3 buyers
    expect(metrics.efficiency).toBeCloseTo(4.2 / 12.6)
    expect(metrics.supplyCurve).toEqual([6, 6])
    expect(metrics.equilibrium).not.toBeNull()
  })

  it('efficiency is 0 when theoreticalMax is 0', () => {
    const zeroSession = { ...baseSession, numBuyers: 0 }
    const metrics = computeRoundMetrics(zeroSession, [], [], 'full', 0)
    expect(metrics.efficiency).toBe(0)
  })
})

describe('getCurrentPlayerId', () => {
  it('returns buyerQueue[currentBuyerIndex] in market phase', () => {
    expect(getCurrentPlayerId(baseSession)).toBe('buy2')
  })

  it('returns null outside market phase', () => {
    expect(getCurrentPlayerId({ ...baseSession, phase: 'seller-input' })).toBeNull()
    expect(getCurrentPlayerId({ ...baseSession, phase: 'round-end' })).toBeNull()
  })
})

describe('computeAvailableOffers', () => {
  it('full info: shows grade for decided sellers', () => {
    const offers = computeAvailableOffers(baseSession)
    const alice = offers.find(o => o.sellerId === 'sel1')!
    expect(alice.grade).toBe(2)
    expect(alice.price).toBe(6.0)
    expect(alice.unitsRemaining).toBe(1)
  })

  it('asymmetric info: hides grade', () => {
    const asymSession = { ...baseSession, infoMode: 'asymmetric' as const }
    const offers = computeAvailableOffers(asymSession)
    expect(offers.every(o => o.grade === null)).toBe(true)
  })

  it('undecided seller has null price', () => {
    const noDecision = {
      ...baseSession,
      currentSellerDecisions: {},
    }
    const offers = computeAvailableOffers(noDecision)
    expect(offers.every(o => o.price === null)).toBe(true)
  })
})
