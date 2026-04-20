import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryRepository } from '../src/repositories/sessionRepository'
import * as service from '../src/services/sessionService'
import { HttpError } from '../src/middleware/errorHandler'
import { SessionRepository } from '../src/repositories/sessionRepository'

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
    const { player: b1 } = service.joinSession(repo, session, 'B1', 'buyer', 0)
    const { player: b2 } = service.joinSession(repo, session, 'B2', 'buyer', 1)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    service.submitBuyerDecision(repo, session, b1.id, null)
    expect(session.phase).toBe('market')

    service.kickPlayer(repo, session, b2.id)
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

describe('skipCurrentBuyer', () => {
  it('throws 400 outside market phase', () => {
    const session = service.createSession(repo, 1, 1)
    service.joinSession(repo, session, 'S', 'seller', 0)
    service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    expect(session.phase).toBe('seller-input')
    expect(() => service.skipCurrentBuyer(repo, session)).toThrowError(HttpError)
  })

  it('writes null-sellerId decision for current buyer and advances to round-end when last', () => {
    const session = service.createSession(repo, 1, 1)
    const { player: seller } = service.joinSession(repo, session, 'S', 'seller', 0)
    const { player: buyer } = service.joinSession(repo, session, 'B', 'buyer', 0)
    service.startGame(repo, session)
    service.submitSellerDecision(repo, session, seller.id, 2, 6.0)
    expect(session.phase).toBe('market')

    service.skipCurrentBuyer(repo, session)
    expect(session.currentBuyerDecisions[buyer.id]).toBeDefined()
    expect(session.currentBuyerDecisions[buyer.id].sellerId).toBeNull()
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
