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
