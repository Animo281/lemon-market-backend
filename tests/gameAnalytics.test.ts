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
import { DEFAULT_BUYER_VALUES, DEFAULT_SELLER_FIRST_COSTS, DEFAULT_ECONOMICS } from '../src/shared/constants'

const baseSession: Session = {
  id: 's1', code: 'TEST', adminToken: 'admin',
  numSellers: 2, numBuyers: 3,
  maxSellerUnits: 2, totalRounds: 5,
  economics: DEFAULT_ECONOMICS,
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
    sel1: { playerId: 'sel1', grade: 2, price: 6.0, unitsOffered: 2, unitsSold: 1, earnings: 0 },
    sel2: { playerId: 'sel2', grade: 1, price: 3.0, unitsOffered: 1, unitsSold: 0, earnings: 0 },
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
    expect(calcAsymmetricWTP(DEFAULT_BUYER_VALUES, [])).toBe(8.8)
  })

  it('averages buyer values for mixed grades', () => {
    // grades [1, 2]: (4.0 + 8.8) / 2 = 6.4
    expect(calcAsymmetricWTP(DEFAULT_BUYER_VALUES, [1, 2])).toBeCloseTo(6.4)
  })

  it('returns single grade value for uniform grade', () => {
    expect(calcAsymmetricWTP(DEFAULT_BUYER_VALUES, [3, 3])).toBeCloseTo(13.6)
  })
})

describe('bestGradeWTP', () => {
  it('returns value of best grade', () => {
    expect(bestGradeWTP(DEFAULT_BUYER_VALUES, [1, 2, 3])).toBe(13.6)
    expect(bestGradeWTP(DEFAULT_BUYER_VALUES, [1, 2])).toBe(8.8)
  })

  it('defaults to grade 2 for empty', () => {
    expect(bestGradeWTP(DEFAULT_BUYER_VALUES, [])).toBe(8.8)
  })
})

describe('theoreticalMaxSurplus', () => {
  it('picks the best grade, capacity- and marginal-cost-aware', () => {
    // 2 sellers * 2 units = 4 possible units, but only 3 buyers → 3 units clear.
    // With 2 sellers, unit index 2 (the 3rd unit overall) is some seller's 2nd
    // unit, so it prices at the higher second-unit cost, not the first-unit one.
    // grade1: (4.0-1.4) + (4.0-1.4) + (4.0-2.4) = 2.6+2.6+1.6 = 6.8
    // grade2: (8.8-4.6) + (8.8-4.6) + (8.8-5.6) = 4.2+4.2+3.2 = 11.6  ← best
    // grade3: (13.6-11.0) + (13.6-11.0) + (13.6-12.0) = 2.6+2.6+1.6 = 6.8
    expect(theoreticalMaxSurplus(DEFAULT_ECONOMICS, 2, 2, 3)).toBeCloseTo(11.6)
  })

  it('is 0 when there are no sellers or no buyers', () => {
    expect(theoreticalMaxSurplus(DEFAULT_ECONOMICS, 0, 2, 3)).toBe(0)
    expect(theoreticalMaxSurplus(DEFAULT_ECONOMICS, 2, 2, 0)).toBe(0)
  })

  it('tracks a shifted economics table instead of assuming grade 2', () => {
    // Grade 3 pays off far more than grade 1 or 2 here, so the search must
    // pick it even though the Holt & Sherman defaults would pick grade 2.
    const shifted = {
      buyerValues: { 1: 4.0, 2: 5.0, 3: 30.0 },
      sellerFirstCosts: { 1: 1.4, 2: 4.6, 3: 11.0 },
    }
    // 1 seller, 1 unit, 1 buyer: grade3 surplus = 30 - 11 = 19, dwarfs grade1/2.
    expect(theoreticalMaxSurplus(shifted, 1, 1, 1)).toBeCloseTo(19)
  })
})

describe('computeSellerEarnings', () => {
  it('returns 0 for 0 units sold', () => {
    expect(computeSellerEarnings(DEFAULT_SELLER_FIRST_COSTS, 2, 6.0, 0)).toBe(0)
  })

  it('computes earnings for grade 2 at price 6: (6-4.6) = 1.4 for 1 unit', () => {
    expect(computeSellerEarnings(DEFAULT_SELLER_FIRST_COSTS, 2, 6.0, 1)).toBeCloseTo(1.4)
  })

  it('computes earnings for 2 units: (6-4.6) + (6-5.6) = 1.4 + 0.4 = 1.8', () => {
    expect(computeSellerEarnings(DEFAULT_SELLER_FIRST_COSTS, 2, 6.0, 2)).toBeCloseTo(1.8)
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
    const curve = buildDemandCurve(DEFAULT_BUYER_VALUES, [2, 1], 'full', 3)
    // bestGradeWTP([2,1]) = BUYER_VALUES[2] = 8.8
    expect(curve).toHaveLength(3)
    expect(curve.every(v => Math.abs(v - 8.8) < 0.001)).toBe(true)
  })

  it('asymmetric info: repeats average WTP', () => {
    const curve = buildDemandCurve(DEFAULT_BUYER_VALUES, [1, 2], 'asymmetric', 2)
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
    // baseSession: 2 sellers, 2 units each, 3 buyers → see theoreticalMaxSurplus tests
    expect(metrics.theoreticalMaxSurplus).toBeCloseTo(11.6)
    expect(metrics.efficiency).toBeCloseTo(4.2 / 11.6)
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
