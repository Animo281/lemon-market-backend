import { SELF, env, evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

interface CreateResponse {
  code: string
  adminToken: string
  sessionId: string
}

interface JoinResponse {
  playerToken: string
  playerId: string
  session: SessionResponse
}

interface SessionResponse {
  code: string
  phase: string
  currentRound: number
  players: Array<{ id: string; name: string; role: string; slotIndex: number }>
  currentSellerDecisions: Record<string, { grade?: number; unitsSold?: number }>
  results: unknown[]
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, init)
}

async function responseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>
}

async function post<T>(path: string, body?: unknown, token?: string): Promise<{ response: Response; body: T }> {
  const response = await request(path, {
    method: 'POST',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-token': token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { response, body: await responseJson<T>(response) }
}

async function createSession(overrides: Record<string, unknown> = {}): Promise<CreateResponse> {
  const { response, body } = await post<CreateResponse>('/api/session', {
    numSellers: 1,
    numBuyers: 1,
    ...overrides,
  })
  expect(response.status).toBe(200)
  return body
}

describe('Worker API with SQLite Durable Objects', () => {
  it('persists a session and serializes concurrent joins to the same slot', async () => {
    const created = await createSession()

    const loaded = await request(`/api/session/${created.code}`)
    expect(loaded.status).toBe(200)
    expect((await responseJson<SessionResponse>(loaded)).code).toBe(created.code)

    const namespace = (env as unknown as { SESSIONS: DurableObjectNamespace }).SESSIONS
    const stub = namespace.get(namespace.idFromName(created.code))
    await evictDurableObject(stub)
    const loadedAfterEviction = await request(`/api/session/${created.code}`)
    expect(loadedAfterEviction.status).toBe(200)
    expect((await responseJson<SessionResponse>(loadedAfterEviction)).code).toBe(created.code)

    const [first, second] = await Promise.all([
      post<JoinResponse>(`/api/session/${created.code}/join`, { name: 'Ada', role: 'seller', slotIndex: 0 }),
      post<JoinResponse>(`/api/session/${created.code}/join`, { name: 'Grace', role: 'seller', slotIndex: 0 }),
    ])
    expect([first.response.status, second.response.status].sort()).toEqual([200, 409])

    const reloaded = await request(`/api/session/${created.code}`)
    const state = await responseJson<SessionResponse>(reloaded)
    expect(state.players.filter(player => player.role === 'seller')).toHaveLength(1)
  })

  it('checks admin/player tokens and completes a full game through round-end to game-end', async () => {
    const created = await createSession({ totalRounds: 1 })
    const sellerJoin = await post<JoinResponse>(`/api/session/${created.code}/join`, {
      name: 'Verkäuferin', role: 'seller', slotIndex: 0,
    })
    const buyerJoin = await post<JoinResponse>(`/api/session/${created.code}/join`, {
      name: 'Käufer', role: 'buyer', slotIndex: 0,
    })
    expect(sellerJoin.response.status).toBe(200)
    expect(buyerJoin.response.status).toBe(200)

    expect((await post(`/api/session/${created.code}/start`, undefined, 'wrong')).response.status).toBe(403)
    expect((await post(`/api/session/${created.code}/start`, undefined, created.adminToken)).response.status).toBe(200)

    const wrongRole = await post(
      `/api/session/${created.code}/buyer-decision`,
      { sellerId: null },
      sellerJoin.body.playerToken,
    )
    expect(wrongRole.response.status).toBe(403)

    const sellerDecision = await post<SessionResponse>(
      `/api/session/${created.code}/seller-decision`,
      { grade: 2, price: 6, unitsOffered: 1 },
      sellerJoin.body.playerToken,
    )
    expect(sellerDecision.response.status).toBe(200)
    expect(sellerDecision.body.phase).toBe('market')

    const anonymous = await request(`/api/session/${created.code}`)
    const anonymousText = await anonymous.text()
    expect(anonymousText).not.toContain(created.adminToken)
    expect(anonymousText).not.toContain(sellerJoin.body.playerToken)
    expect(anonymousText).not.toContain(buyerJoin.body.playerToken)

    expect((await post(
      `/api/session/${created.code}/buyer-decision`,
      { sellerId: sellerJoin.body.playerId },
      'wrong',
    )).response.status).toBe(403)

    const buyerDecision = await post<SessionResponse>(
      `/api/session/${created.code}/buyer-decision`,
      { sellerId: sellerJoin.body.playerId },
      buyerJoin.body.playerToken,
    )
    expect(buyerDecision.response.status).toBe(200)
    expect(buyerDecision.body.phase).toBe('round-end')
    expect(buyerDecision.body.results).toHaveLength(1)

    const persisted = await request(`/api/session/${created.code}`, {
      headers: { 'x-token': created.adminToken },
    })
    expect((await responseJson<SessionResponse>(persisted)).phase).toBe('round-end')

    const gameEnd = await post<SessionResponse>(
      `/api/session/${created.code}/next-round`,
      undefined,
      created.adminToken,
    )
    expect(gameEnd.response.status).toBe(200)
    expect(gameEnd.body.phase).toBe('game-end')
    expect(gameEnd.body.currentRound).toBe(1)
  })

  it('returns JSON errors for validation, malformed JSON, unknown codes, and API misses', async () => {
    const invalid = await post<{ issues?: unknown[] }>('/api/session', { numSellers: 0, numBuyers: 1 })
    expect(invalid.response.status).toBe(400)
    expect(invalid.body.issues).toBeDefined()

    const malformed = await request('/api/session', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken',
    })
    expect(malformed.status).toBe(400)

    const unknown = await request('/api/session/ZZZZ')
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('content-type')).toContain('application/json')

    const namespace = (env as unknown as { SESSIONS: DurableObjectNamespace }).SESSIONS
    const unknownStub = namespace.get(namespace.idFromName('ZZZZ'))
    const storedUnknown = await runInDurableObject(
      unknownStub,
      async (_instance: DurableObject, state) => state.storage.get('session'),
    )
    expect(storedUnknown).toBeUndefined()

    for (const path of ['/api', '/api/this-does-not-exist']) {
      const missingApi = await request(path, { headers: { 'sec-fetch-mode': 'navigate' } })
      expect(missingApi.status).toBe(404)
      expect(missingApi.headers.get('content-type')).toContain('application/json')
      expect(await missingApi.text()).not.toContain('<div id="root">')
    }
  })
})

describe('Static assets and documentation', () => {
  it.each(['/join/ABCD', '/admin/ABCD', '/play/ABCD'])(
    'serves the SPA shell for %s',
    async path => {
      const response = await request(path, { headers: { 'sec-fetch-mode': 'navigate' } })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('<div id="root">')
    },
  )

  it('serves human and machine-readable API documentation', async () => {
    const docs = await request('/api/docs')
    expect(docs.status).toBe(200)
    expect(await docs.text()).toContain('Lemon Market API')

    const spec = await request('/api/openapi.json')
    expect(spec.status).toBe(200)
    expect((await responseJson<{ openapi: string }>(spec)).openapi).toBe('3.0.0')
  })
})
