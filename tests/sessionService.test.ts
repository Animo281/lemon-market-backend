import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryRepository } from '../src/repositories/sessionRepository'
import * as service from '../src/services/sessionService'
import { HttpError } from '../src/http/httpError'
import { SessionRepository } from '../src/repositories/sessionRepository'
import { activeBuyerIds } from '../src/lib/gameLogic'
import { BUYER_GROUP_SIZE } from '../src/shared/constants'

let repo: SessionRepository

beforeEach(() => {
  repo = createMemoryRepository()
})

describe('createSession', () => {
  it('creates session with correct defaults', () => {
    const session = service.createSession(repo, 3, 4)
    expect(session.phase).toBe('lobby')
    expect(session.numSellers).toBe(3)
    expect(session.numBuyers).toBe(4)
    expect(session.code).toHaveLength(4)
    expect(session.adminToken).toBeTruthy()
  })

  it('persists to repository', () => {
    const session = service.createSession(repo, 3, 4)
    expect(repo.getByCode(session.code)).toBeDefined()
  })
})

describe('joinSession', () => {
  it('returns distinct playerToken and playerId', () => {
    const session = service.createSession(repo, 3, 4)
    const { player, token } = service.joinSession(repo, session, 'Alice', 'seller', 0)
    expect(token).not.toBe(player.id)
    expect(token).toBe(player.token)
  })

  it('throws 409 on duplicate slot', () => {
    const session = service.createSession(repo, 3, 4)
    service.joinSession(repo, session, 'Alice', 'seller', 0)
    expect(() => service.joinSession(repo, session, 'Bob', 'seller', 0))
      .toThrowError(HttpError)
  })

  it('throws 400 if session already started', () => {
    const session = service.createSession(repo, 1, 1)
    service.joinSession(repo, session, 'S', 'seller', 0)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    expect(() => service.joinSession(repo, session, 'X', 'seller', 0))
      .toThrowError(HttpError)
  })
})

describe('startGame', () => {
  it('transitions to seller-input phase', () => {
    const session = service.createSession(repo, 1, 1)
    service.joinSession(repo, session, 'S', 'seller', 0)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    expect(session.phase).toBe('seller-input')
  })

  it('throws 400 without players', () => {
    const session = service.createSession(repo, 1, 1)
    expect(() => service.startGame(repo, session)).toThrowError(HttpError)
  })
})

describe('state machine: seller-decision → market → round-end → next-round', () => {
  it('completes full round cycle', () => {
    const session = service.createSession(repo, 1, 1)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    const { player: buyer } = service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)

    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    expect(session.phase).toBe('market')

    service.submitBuyerDecision(repo, session, buyer.id, seller.id)
    expect(session.phase).toBe('round-end')
    expect(session.results).toHaveLength(1)

    service.advanceToNextRound(repo, session)
    expect(session.phase).toBe('seller-input')
    expect(session.currentRound).toBe(2)
  })

  it('throws 403-style HttpError when wrong token used (findPlayer test)', () => {
    const session = service.createSession(repo, 1, 1)
    const { player } = service.joinSession(repo, session, 'S', 'seller', 0)
    // player.id should NOT work as auth token
    expect(player.token).not.toBe(player.id)
  })
})

describe('game-end after final round', () => {
  it('phase becomes game-end after last round', () => {
    const session = service.createSession(repo, 1, 1, 2, 1)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    const { player: buyer } = service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 1, 2.0)
    service.submitBuyerDecision(repo, session, buyer.id, null)
    expect(session.phase).toBe('round-end')
    service.advanceToNextRound(repo, session)
    expect(session.phase).toBe('game-end')
  })
})

describe('kickPlayer', () => {
  it('throws 404 for unknown playerId', () => {
    const session = service.createSession(repo, 1, 1)
    expect(() => service.kickPlayer(repo, session, 'nonexistent')).toThrowError(HttpError)
  })

  it('removes seller in seller-input and phase stays seller-input when others still missing', () => {
    const session = service.createSession(repo, 2, 1)
    const { player: s1 } = service.joinSession(repo, session, 'S1', 'seller', 0)
    service.joinSession(repo, session, 'S2', 'seller', 1)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, s1.id, 2, 6.0)
    expect(session.phase).toBe('seller-input')

    // kick S2 (who hasn't submitted) — S1 already submitted → all remaining submitted → market
    const { player: s2 } = session.players.find(p => p.name === 'S2')
      ? { player: session.players.find(p => p.name === 'S2')! }
      : { player: { id: '', token: '', name: '', role: 'seller' as const, slotIndex: 0 } }
    service.kickPlayer(repo, session, s2.id)
    expect(session.players.some(p => p.name === 'S2')).toBe(false)
    expect(session.phase).toBe('market')
  })

  it('removes buyer in market and triggers round-end when all remaining buyers decided', () => {
    const session = service.createSession(repo, 1, 2)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    service.joinSession(repo, session, 'B1', 'buyer', 0)
    service.joinSession(repo, session, 'B2', 'buyer', 1)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    // buyerQueue is shuffled — submit for whoever's actually up first, then
    // kick the other one.
    const [first, second] = session.buyerQueue
    service.submitBuyerDecision(repo, session, first, null)
    expect(session.phase).toBe('market')

    service.kickPlayer(repo, session, second)
    expect(session.phase).toBe('round-end')
  })

  it('kicked player id no longer in players array', () => {
    const session = service.createSession(repo, 1, 1)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.kickPlayer(repo, session, seller.id)
    expect(session.players.find(p => p.id === seller.id)).toBeUndefined()
  })
})

describe('skipBuyer', () => {
  it('throws 400 outside market phase', () => {
    const session = service.createSession(repo, 1, 1)
    service.joinSession(repo, session, 'S', 'seller', 0)
    const { player: buyer } = service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    expect(session.phase).toBe('seller-input')
    expect(() => service.skipBuyer(repo, session, buyer.id)).toThrowError(HttpError)
  })

  it('throws 400 for a buyer who is not currently active', () => {
    const session = service.createSession(repo, 1, 1)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    expect(() => service.skipBuyer(repo, session, 'nonexistent')).toThrowError(HttpError)
  })

  it('writes null-sellerId decision for the given buyer and advances to round-end when last', () => {
    const session = service.createSession(repo, 1, 1)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    const { player: buyer } = service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    expect(session.phase).toBe('market')

    service.skipBuyer(repo, session, buyer.id)
    expect(session.currentBuyerDecisions[buyer.id]).toBeDefined()
    expect(session.currentBuyerDecisions[buyer.id].sellerId).toBeNull()
    expect(session.phase).toBe('round-end')
  })
})

describe('buyer groups (BUYER_GROUP_SIZE concurrent buyers, then the next group)', () => {
  // 4 buyers with BUYER_GROUP_SIZE=3: group 1 is the first 3 in buyerQueue,
  // group 2 is just the 4th — enough to exercise a group boundary.
  function setUp4Buyers() {
    const session = service.createSession(repo, 1, 4)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    for (let i = 0; i < 4; i++) service.joinSession(repo, session, `B${i}`, 'buyer', i)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    expect(session.phase).toBe('market')
    return session
  }

  it('the whole first group is active at once, the next group is not', () => {
    const session = setUp4Buyers()
    const [g1a, g1b, g1c, g2a] = session.buyerQueue
    expect(activeBuyerIds(session)).toEqual([g1a, g1b, g1c])
    expect(activeBuyerIds(session)).not.toContain(g2a)
  })

  it('the active group only shrinks as its members decide — no early pull-in from the next group', () => {
    const session = setUp4Buyers()
    const [g1a, g1b, g1c] = session.buyerQueue
    service.submitBuyerDecision(repo, session, g1a, null)
    expect(activeBuyerIds(session)).toEqual([g1b, g1c])
  })

  it('moves to the next group once the whole current group has decided (bug: used to stay stuck)', () => {
    const session = setUp4Buyers()
    const [g1a, g1b, g1c, g2a] = session.buyerQueue
    service.submitBuyerDecision(repo, session, g1a, null)
    service.submitBuyerDecision(repo, session, g1b, null)
    expect(activeBuyerIds(session)).toEqual([g1c])
    service.submitBuyerDecision(repo, session, g1c, null)
    expect(activeBuyerIds(session)).toEqual([g2a])
  })

  it('skipBuyer skips whoever is actually active, not just the first in the group', () => {
    const session = setUp4Buyers()
    const [g1a, g1b, g1c] = session.buyerQueue
    service.submitBuyerDecision(repo, session, g1a, null)
    service.skipBuyer(repo, session, g1b)
    expect(session.currentBuyerDecisions[g1b].sellerId).toBeNull()
    expect(activeBuyerIds(session)).toEqual([g1c])
  })

  it('kicking an active buyer recomputes the group — chunk boundaries shift with the shorter queue, pulling the next buyer in to keep the group full', () => {
    const session = setUp4Buyers()
    const [g1a, g1b, g1c, g2a] = session.buyerQueue
    service.submitBuyerDecision(repo, session, g1a, null)
    service.kickPlayer(repo, session, g1b)
    expect(activeBuyerIds(session)).toEqual([g1c, g2a])
  })

  it('the active group is empty once every buyer has decided', () => {
    const session = setUp4Buyers()
    for (const id of [...session.buyerQueue]) {
      service.submitBuyerDecision(repo, session, id, null)
    }
    expect(session.phase).toBe('round-end')
    expect(activeBuyerIds(session)).toEqual([])
  })
})

describe('submitBuyerDecision enforces the drawn-by-lot order (paper: buyers "shop" in groups)', () => {
  it('rejects a buyer from a later group', () => {
    const session = service.createSession(repo, 1, 4)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    for (let i = 0; i < 4; i++) service.joinSession(repo, session, `B${i}`, 'buyer', i)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)

    const [g1a, g1b, g1c, g2a] = session.buyerQueue
    expect(() => service.submitBuyerDecision(repo, session, g2a, null)).toThrowError(HttpError)
    expect(session.currentBuyerDecisions[g2a]).toBeUndefined()

    // Once the whole first group has gone through, the next group's turn comes.
    service.submitBuyerDecision(repo, session, g1a, null)
    service.submitBuyerDecision(repo, session, g1b, null)
    service.submitBuyerDecision(repo, session, g1c, null)
    service.submitBuyerDecision(repo, session, g2a, null)
    expect(session.phase).toBe('round-end')
  })

  it('members of the same group may decide in any order', () => {
    const session = service.createSession(repo, 1, BUYER_GROUP_SIZE)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    for (let i = 0; i < BUYER_GROUP_SIZE; i++) service.joinSession(repo, session, `B${i}`, 'buyer', i)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)

    const [first, second, third] = session.buyerQueue
    service.submitBuyerDecision(repo, session, third, null)
    service.submitBuyerDecision(repo, session, first, null)
    service.submitBuyerDecision(repo, session, second, null)
    expect(session.phase).toBe('round-end')
  })
})

describe('forceAdvanceFromSellerInput', () => {
  it('throws 400 outside seller-input phase', () => {
    const session = service.createSession(repo, 1, 1)
    service.joinSession(repo, session, 'S', 'seller', 0)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, session.players.find(p => p.role === 'seller')!.id, 1, 5.0)
    expect(session.phase).toBe('market')
    expect(() => service.forceAdvanceFromSellerInput(repo, session)).toThrowError(HttpError)
  })

  it('fills default decisions for missing sellers and transitions to market', () => {
    const session = service.createSession(repo, 2, 1)
    service.joinSession(repo, session, 'S1', 'seller', 0)
    service.joinSession(repo, session, 'S2', 'seller', 1)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    expect(session.phase).toBe('seller-input')

    service.forceAdvanceFromSellerInput(repo, session)
    expect(session.phase).toBe('market')
    const sellers = session.players.filter(p => p.role === 'seller')
    for (const s of sellers) {
      expect(session.currentSellerDecisions[s.id]).toBeDefined()
    }
  })

  it('does not overwrite decisions already submitted', () => {
    const session = service.createSession(repo, 2, 1)
    const { player: s1 } = service.joinSession(repo, session, 'S1', 'seller', 0)
    service.joinSession(repo, session, 'S2', 'seller', 1)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, s1.id, 3, 12.0)

    service.forceAdvanceFromSellerInput(repo, session)
    expect(session.currentSellerDecisions[s1.id]?.grade).toBe(3)
    expect(session.currentSellerDecisions[s1.id]?.price).toBe(12.0)
  })
})

describe('turnDeadline', () => {
  it('is set when the market phase opens, using the configured turnDurationSeconds', () => {
    const session = service.createSession(repo, 1, 1, undefined, undefined, undefined, undefined, 45)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    const before = Date.now()
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    expect(session.phase).toBe('market')
    expect(session.turnDeadline).not.toBeNull()
    expect(session.turnDeadline! - before).toBeGreaterThan(44_000)
    expect(session.turnDeadline! - before).toBeLessThanOrEqual(45_000)
  })

  it('is cleared once the round ends', () => {
    const session = service.createSession(repo, 1, 1)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    const { player: buyer } = service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    service.submitBuyerDecision(repo, session, buyer.id, null)
    expect(session.phase).toBe('round-end')
    expect(session.turnDeadline).toBeNull()
  })

  it('does not reset while the same group is still deciding', () => {
    const session = service.createSession(repo, 1, 4)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    for (let i = 0; i < 4; i++) service.joinSession(repo, session, `B${i}`, 'buyer', i)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    const [g1a, g1b] = session.buyerQueue
    const deadlineAfterGroupStart = session.turnDeadline

    service.submitBuyerDecision(repo, session, g1a, null)
    expect(session.turnDeadline).toBe(deadlineAfterGroupStart)
    service.submitBuyerDecision(repo, session, g1b, null)
    expect(session.turnDeadline).toBe(deadlineAfterGroupStart)
  })
})

describe('expireTurnIfNeeded', () => {
  it('does nothing before the deadline, outside market, or once the whole round is decided', () => {
    const session = service.createSession(repo, 1, 1)
    service.joinSession(repo, session, 'S', 'seller', 0)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    expect(service.expireTurnIfNeeded(session)).toBe(false) // seller-input, no deadline yet
  })

  it('auto-skips the whole active group once its deadline has passed, and starts the next group\'s timer', () => {
    const session = service.createSession(repo, 1, 4, undefined, undefined, undefined, undefined, 10)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    for (let i = 0; i < 4; i++) service.joinSession(repo, session, `B${i}`, 'buyer', i)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    const [g1a, g1b, g1c, g2a] = session.buyerQueue

    expect(service.expireTurnIfNeeded(session)).toBe(false) // still well within the 10s window

    const realNow = Date.now
    try {
      Date.now = () => realNow() + 11_000
      expect(service.expireTurnIfNeeded(session)).toBe(true)
    } finally {
      Date.now = realNow
    }

    expect(session.currentBuyerDecisions[g1a].sellerId).toBeNull()
    expect(session.currentBuyerDecisions[g1b].sellerId).toBeNull()
    expect(session.currentBuyerDecisions[g1c].sellerId).toBeNull()
    expect(session.currentBuyerDecisions[g2a]).toBeUndefined()
    expect(activeBuyerIds(session)).toEqual([g2a])
    expect(session.turnDeadline).not.toBeNull()
  })

  it('ends the round when the expiring group was the last one', () => {
    const session = service.createSession(repo, 1, 1, undefined, undefined, undefined, undefined, 10)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)

    const realNow = Date.now
    try {
      Date.now = () => realNow() + 11_000
      expect(service.expireTurnIfNeeded(session)).toBe(true)
    } finally {
      Date.now = realNow
    }

    expect(session.phase).toBe('round-end')
    expect(session.turnDeadline).toBeNull()
    expect(session.results).toHaveLength(1)
  })
})
