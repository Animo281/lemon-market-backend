import { DurableObject } from 'cloudflare:workers'
import { ZodSchema } from 'zod'
import { openApiSpec } from './docs/openapi'
import { HttpError } from './http/httpError'
import { toPublic } from './mappers/toPublic'
import { createMemoryRepository } from './repositories/sessionRepository'
import {
  buyerDecisionSchema,
  configSessionSchema,
  createSessionSchema,
  joinSessionSchema,
  sellerDecisionSchema,
} from './schemas/session'
import * as service from './services/sessionService'
import { Player, Role, Session } from './shared/types'
import { Viewer } from './shared/viewer'

interface Env {
  SESSIONS: DurableObjectNamespace<SessionDurableObject>
  ASSETS: Fetcher
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
const SESSION_PATH = /^\/api\/session\/([^/]+)(?:\/(.*))?$/
const SESSION_CODE = /^[A-Z0-9]{4}$/

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status)
  console.error(error)
  return json({ error: 'Interner Serverfehler.' }, 500)
}

async function validatedBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    throw new HttpError(400, 'Ungültige Anfrage — Anfrage-Format prüfen.')
  }

  const result = schema.safeParse(input)
  if (!result.success) {
    return Promise.reject(Object.assign(
      new HttpError(400, 'Eingabe ungültig — bitte Werte prüfen.'),
      { issues: result.error.issues },
    ))
  }
  return result.data
}

function validationErrorResponse(error: unknown): Response {
  if (error instanceof HttpError && 'issues' in error) {
    return json({ error: error.message, issues: error.issues }, error.status)
  }
  return errorResponse(error)
}

function tokenFrom(request: Request): string | null {
  return request.headers.get('x-token')
}

function resolveViewer(session: Session, request: Request): Viewer {
  const token = tokenFrom(request)
  if (token && token === session.adminToken) return { kind: 'admin' }
  const player = token ? session.players.find(candidate => candidate.token === token) : undefined
  return player ? { kind: 'player', player } : { kind: 'anonymous' }
}

function requireAdmin(session: Session, request: Request): void {
  if (tokenFrom(request) !== session.adminToken) {
    throw new HttpError(403, 'Zugriff verweigert — kein gültiges Admin-Token.')
  }
}

function requirePlayer(session: Session, request: Request, role?: Role): Player {
  const token = tokenFrom(request)
  const player = token ? session.players.find(candidate => candidate.token === token) : undefined
  if (!player) throw new HttpError(403, 'Zugriff verweigert — kein gültiges Spieler-Token.')
  if (role && player.role !== role) {
    throw new HttpError(403, role === 'seller' ? 'Nur Verkäufer dürfen das.' : 'Nur Käufer dürfen das.')
  }
  return player
}

function docsPage(): Response {
  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lemon Market API</title><style>
body{font:16px/1.55 system-ui,sans-serif;max-width:900px;margin:3rem auto;padding:0 1.25rem;color:#172018}
code,pre{background:#f3f6ef;border-radius:.4rem}code{padding:.15rem .35rem}pre{padding:1rem;overflow:auto}
a{color:#326b24}h1,h2{line-height:1.2}
</style></head><body><h1>Lemon Market API</h1>
<p>Die API liegt unter <code>/api</code>. Die maschinenlesbare OpenAPI-3-Beschreibung ist als
<a href="/api/openapi.json">/api/openapi.json</a> verfügbar.</p>
<h2>Schnellstart</h2><pre>POST /api/session
Content-Type: application/json

{"numSellers":3,"numBuyers":4}</pre>
<p>Geschützte Admin- und Spieler-Routen erwarten das zur Laufzeit ausgegebene Token im Header <code>x-token</code>.</p>
</body></html>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

async function createRemoteSession(request: Request, env: Env): Promise<Response> {
  let body: Awaited<ReturnType<typeof validatedBody<typeof createSessionSchema._output>>>
  try {
    body = await validatedBody(request, createSessionSchema)
  } catch (error) {
    return validationErrorResponse(error)
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const code = service.generateCode()
    const stub = env.SESSIONS.getByName(code)
    const response = await stub.fetch('https://session.internal/create', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...body, code }),
    })
    if (response.status !== 409) return response
  }
  return json({ error: 'Konnte keinen eindeutigen Session-Code erzeugen — bitte erneut versuchen.' }, 500)
}

async function workerFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/api/docs' || url.pathname === '/api/docs/') return docsPage()
  if (url.pathname === '/api/openapi.json' && request.method === 'GET') return json(openApiSpec)
  if (url.pathname === '/api/session' && request.method === 'POST') return createRemoteSession(request, env)

  const match = url.pathname.match(SESSION_PATH)
  if (match) {
    const code = decodeURIComponent(match[1]).toUpperCase()
    if (!SESSION_CODE.test(code)) return json({ error: 'Session nicht gefunden — Code prüfen.' }, 404)
    return env.SESSIONS.getByName(code).fetch(request)
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return json({ error: 'Nicht gefunden.' }, 404)
  }
  return env.ASSETS.fetch(request)
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return workerFetch(request, env).catch(errorResponse)
  },
} satisfies ExportedHandler<Env>

interface CreateMessage extends Omit<ReturnType<typeof createSessionSchema.parse>, never> {
  code: string
}

export class SessionDurableObject extends DurableObject<Env> {
  private session: Session | undefined
  private readonly ready: Promise<void>
  private requestQueue: Promise<void> = Promise.resolve()

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.ready = state.blockConcurrencyWhile(async () => {
      this.session = await state.storage.get<Session>('session')
    })
  }

  fetch(request: Request): Promise<Response> {
    const response = this.requestQueue.then(() => this.handle(request))
    this.requestQueue = response.then(() => undefined, () => undefined)
    return response
  }

  private async handle(request: Request): Promise<Response> {
    await this.ready
    try {
      const url = new URL(request.url)
      if (url.hostname === 'session.internal' && url.pathname === '/create' && request.method === 'POST') {
        return await this.create(request)
      }
      return await this.routeSession(request, url)
    } catch (error) {
      return validationErrorResponse(error)
    }
  }

  private async create(request: Request): Promise<Response> {
    if (this.session) throw new HttpError(409, 'Dieser Session-Code ist bereits vergeben.')
    const input = await request.json() as CreateMessage
    if (!SESSION_CODE.test(input.code)) throw new HttpError(400, 'Ungültiger Session-Code.')

    const repo = createMemoryRepository()
    const created = service.createSession(
      repo,
      input.numSellers,
      input.numBuyers,
      input.maxSellerUnits,
      input.totalRounds,
      input.code,
      input.economics,
    )
    await this.ctx.storage.put('session', created)
    this.session = created
    return json({ code: created.code, adminToken: created.adminToken, sessionId: created.id })
  }

  private async routeSession(request: Request, url: URL): Promise<Response> {
    const match = url.pathname.match(SESSION_PATH)
    const code = match ? decodeURIComponent(match[1]).toUpperCase() : ''
    if (!this.session || code !== this.session.code) {
      throw new HttpError(404, 'Session nicht gefunden — Code prüfen.')
    }

    const suffix = match?.[2] ?? ''
    const snapshot = structuredClone(this.session)
    const repo = createMemoryRepository([this.session])
    const viewer = resolveViewer(this.session, request)
    let mutated = false
    let payload: unknown

    try {
      if (request.method === 'GET' && suffix === '') {
        payload = toPublic(this.session, viewer)
      } else if (request.method === 'POST' && suffix === 'join') {
        const body = await validatedBody(request, joinSessionSchema)
        const { player, token } = service.joinSession(repo, this.session, body.name, body.role, body.slotIndex)
        payload = { playerToken: token, playerId: player.id, session: toPublic(this.session, viewer) }
        mutated = true
      } else if (request.method === 'POST' && suffix === 'start') {
        requireAdmin(this.session, request)
        payload = toPublic(service.startGame(repo, this.session), viewer)
        mutated = true
      } else if (request.method === 'PATCH' && suffix === 'config') {
        requireAdmin(this.session, request)
        const body = await validatedBody(request, configSessionSchema)
        payload = toPublic(service.updateConfig(repo, this.session, body.maxSellerUnits, body.totalRounds, body.economics), viewer)
        mutated = true
      } else if (request.method === 'POST' && suffix === 'seller-decision') {
        const player = requirePlayer(this.session, request, 'seller')
        const body = await validatedBody(request, sellerDecisionSchema)
        payload = toPublic(service.submitSellerDecision(repo, this.session, player.id, body.grade, body.price, body.unitsOffered), viewer)
        mutated = true
      } else if (request.method === 'POST' && suffix === 'buyer-decision') {
        const player = requirePlayer(this.session, request, 'buyer')
        const body = await validatedBody(request, buyerDecisionSchema)
        payload = toPublic(service.submitBuyerDecision(repo, this.session, player.id, body.sellerId), viewer)
        mutated = true
      } else if (request.method === 'POST' && suffix === 'toggle-info-mode') {
        requireAdmin(this.session, request)
        payload = toPublic(service.toggleInfoMode(repo, this.session), viewer)
        mutated = true
      } else if (request.method === 'POST' && suffix === 'next-round') {
        requireAdmin(this.session, request)
        payload = toPublic(service.advanceToNextRound(repo, this.session), viewer)
        mutated = true
      } else if (request.method === 'POST' && suffix === 'skip-buyer') {
        requireAdmin(this.session, request)
        payload = toPublic(service.skipCurrentBuyer(repo, this.session), viewer)
        mutated = true
      } else if (request.method === 'POST' && suffix === 'force-advance') {
        requireAdmin(this.session, request)
        payload = toPublic(service.forceAdvanceFromSellerInput(repo, this.session), viewer)
        mutated = true
      } else if (request.method === 'DELETE' && suffix.startsWith('players/')) {
        requireAdmin(this.session, request)
        const playerId = decodeURIComponent(suffix.slice('players/'.length))
        if (!playerId || playerId.includes('/')) throw new HttpError(404, 'Nicht gefunden.')
        payload = toPublic(service.kickPlayer(repo, this.session, playerId), viewer)
        mutated = true
      } else {
        throw new HttpError(404, 'Nicht gefunden.')
      }

      if (mutated) await this.ctx.storage.put('session', this.session)
      return json(payload)
    } catch (error) {
      this.session = snapshot
      throw error
    }
  }
}
