import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createMemoryRepository } from '../src/repositories/sessionRepository'
import { createSessionRouter } from '../src/routes/session'
import { errorHandler } from '../src/middleware/errorHandler'

function buildApp() {
  const repo = createMemoryRepository()
  const app = express()
  app.use(express.json())
  app.use('/api/session', createSessionRouter(repo))
  app.use(errorHandler)
  return app
}

let app: ReturnType<typeof buildApp>

beforeEach(() => {
  app = buildApp()
})

describe('POST /api/session', () => {
  it('creates session and returns code + adminToken', async () => {
    const res = await request(app).post('/api/session').send({})
    expect(res.status).toBe(200)
    expect(res.body.code).toHaveLength(4)
    expect(res.body.adminToken).toBeTruthy()
    expect(res.body.sessionId).toBeTruthy()
  })

  it('returns 400 for invalid totalRounds (> 20)', async () => {
    const res = await request(app).post('/api/session').send({ totalRounds: 99 })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/session/:code', () => {
  it('returns 404 for unknown code', async () => {
    const res = await request(app).get('/api/session/XXXX')
    expect(res.status).toBe(404)
  })

  it('returns session state', async () => {
    const create = await request(app).post('/api/session').send({})
    const { code } = create.body
    const res = await request(app).get(`/api/session/${code}`)
    expect(res.status).toBe(200)
    expect(res.body.phase).toBe('lobby')
    expect(res.body.adminToken).toBeUndefined()
  })
})

describe('POST /api/session/:code/join', () => {
  it('returns distinct playerToken and playerId', async () => {
    const { body: { code } } = await request(app).post('/api/session').send({})
    const res = await request(app)
      .post(`/api/session/${code}/join`)
      .send({ name: 'Alice', role: 'seller', slotIndex: 0 })
    expect(res.status).toBe(200)
    expect(res.body.playerToken).toBeTruthy()
    expect(res.body.playerId).toBeTruthy()
    expect(res.body.playerToken).not.toBe(res.body.playerId)
  })

  it('returns 409 for duplicate slot', async () => {
    const { body: { code } } = await request(app).post('/api/session').send({})
    await request(app).post(`/api/session/${code}/join`).send({ name: 'A', role: 'seller', slotIndex: 0 })
    const res = await request(app).post(`/api/session/${code}/join`).send({ name: 'B', role: 'seller', slotIndex: 0 })
    expect(res.status).toBe(409)
  })
})

describe('Security: playerId used as token is rejected', () => {
  it('POST seller-decision with playerId (not playerToken) returns 403', async () => {
    const { body: { code, adminToken } } = await request(app).post('/api/session').send({ numSellers: 1, numBuyers: 1 })

    const joinRes = await request(app).post(`/api/session/${code}/join`).send({ name: 'S', role: 'seller', slotIndex: 0 })
    const { playerId } = joinRes.body

    await request(app).post(`/api/session/${code}/join`).send({ name: 'B', role: 'buyer', slotIndex: 0 })
    await request(app).post(`/api/session/${code}/start`).set('x-token', adminToken)

    const res = await request(app)
      .post(`/api/session/${code}/seller-decision`)
      .set('x-token', playerId)  // using ID instead of token
      .send({ grade: 1, price: 2.0 })

    expect(res.status).toBe(403)
  })
})

describe('Full game happy path', () => {
  it('completes a 1-round game', async () => {
    const { body: { code, adminToken } } = await request(app)
      .post('/api/session').send({ numSellers: 1, numBuyers: 1, totalRounds: 1 })

    const { body: { playerToken: sellerToken, playerId: sellerId } } = await request(app)
      .post(`/api/session/${code}/join`).send({ name: 'S', role: 'seller', slotIndex: 0 })

    const { body: { playerToken: buyerToken } } = await request(app)
      .post(`/api/session/${code}/join`).send({ name: 'B', role: 'buyer', slotIndex: 0 })

    await request(app).post(`/api/session/${code}/start`).set('x-token', adminToken)

    await request(app).post(`/api/session/${code}/seller-decision`)
      .set('x-token', sellerToken).send({ grade: 2, price: 6.0 })

    await request(app).post(`/api/session/${code}/buyer-decision`)
      .set('x-token', buyerToken).send({ sellerId })

    const state = await request(app).get(`/api/session/${code}`)
    expect(state.body.phase).toBe('round-end')
    expect(state.body.results).toHaveLength(1)

    const nextRes = await request(app).post(`/api/session/${code}/next-round`).set('x-token', adminToken)
    expect(nextRes.body.phase).toBe('game-end')
  })
})

describe('Admin: kick / skip-buyer / force-advance', () => {
  async function setupStartedGame() {
    const { body: { code, adminToken } } = await request(app)
      .post('/api/session').send({ numSellers: 1, numBuyers: 1 })
    const { body: { playerToken: sellerToken, playerId: sellerId } } = await request(app)
      .post(`/api/session/${code}/join`).send({ name: 'S', role: 'seller', slotIndex: 0 })
    const { body: { playerToken: buyerToken, playerId: buyerId } } = await request(app)
      .post(`/api/session/${code}/join`).send({ name: 'B', role: 'buyer', slotIndex: 0 })
    await request(app).post(`/api/session/${code}/start`).set('x-token', adminToken)
    return { code, adminToken, sellerToken, sellerId, buyerToken, buyerId }
  }

  it('DELETE players/:playerId without admin token → 403', async () => {
    const { code, sellerId } = await setupStartedGame()
    const res = await request(app).delete(`/api/session/${code}/players/${sellerId}`)
    expect(res.status).toBe(403)
  })

  it('DELETE players/:playerId with admin token → 200, player removed', async () => {
    const { code, adminToken, sellerId } = await setupStartedGame()
    const res = await request(app)
      .delete(`/api/session/${code}/players/${sellerId}`)
      .set('x-token', adminToken)
    expect(res.status).toBe(200)
    expect(res.body.players.find((p: { id: string }) => p.id === sellerId)).toBeUndefined()
  })

  it('kicked player token → 403 on subsequent request', async () => {
    const { code, adminToken, sellerId, sellerToken } = await setupStartedGame()
    await request(app).delete(`/api/session/${code}/players/${sellerId}`).set('x-token', adminToken)
    const res = await request(app)
      .post(`/api/session/${code}/seller-decision`)
      .set('x-token', sellerToken)
      .send({ grade: 1, price: 3.0 })
    expect(res.status).toBe(403)
  })

  it('POST skip-buyer without admin → 403', async () => {
    const { code, sellerId, sellerToken } = await setupStartedGame()
    await request(app).post(`/api/session/${code}/seller-decision`)
      .set('x-token', sellerToken).send({ grade: 2, price: 6.0 })
    const res = await request(app).post(`/api/session/${code}/skip-buyer`)
    expect(res.status).toBe(403)
  })

  it('POST skip-buyer in market phase → 200, round-end (1 buyer)', async () => {
    const { code, adminToken, sellerToken } = await setupStartedGame()
    await request(app).post(`/api/session/${code}/seller-decision`)
      .set('x-token', sellerToken).send({ grade: 2, price: 6.0 })
    const res = await request(app).post(`/api/session/${code}/skip-buyer`).set('x-token', adminToken)
    expect(res.status).toBe(200)
    expect(res.body.phase).toBe('round-end')
  })

  it('POST skip-buyer in wrong phase → 400', async () => {
    const { code, adminToken } = await setupStartedGame()
    const res = await request(app).post(`/api/session/${code}/skip-buyer`).set('x-token', adminToken)
    expect(res.status).toBe(400)
  })

  it('POST force-advance in seller-input → 200, market', async () => {
    const { code, adminToken } = await setupStartedGame()
    const res = await request(app).post(`/api/session/${code}/force-advance`).set('x-token', adminToken)
    expect(res.status).toBe(200)
    expect(res.body.phase).toBe('market')
  })

  it('POST force-advance without admin → 403', async () => {
    const { code } = await setupStartedGame()
    const res = await request(app).post(`/api/session/${code}/force-advance`)
    expect(res.status).toBe(403)
  })
})

describe('Validation', () => {
  it('rejects negative price', async () => {
    const { body: { code, adminToken } } = await request(app)
      .post('/api/session').send({ numSellers: 1, numBuyers: 1 })
    const { body: { playerToken } } = await request(app)
      .post(`/api/session/${code}/join`).send({ name: 'S', role: 'seller', slotIndex: 0 })
    await request(app).post(`/api/session/${code}/join`).send({ name: 'B', role: 'buyer', slotIndex: 0 })
    await request(app).post(`/api/session/${code}/start`).set('x-token', adminToken)

    const res = await request(app).post(`/api/session/${code}/seller-decision`)
      .set('x-token', playerToken).send({ grade: 1, price: -5 })
    expect(res.status).toBe(400)
    expect(res.body.issues).toBeDefined()
  })
})
