#!/usr/bin/env node
// Load test for the Lemon-Market worker: simulates ~30 concurrent classroom
// players (sellers + buyers + admin) across two full games, run against a
// local `wrangler dev` instance so it costs zero Cloudflare request quota.
// See C:\Users\aniss\.claude\plans\hast-du-alles-gefixt-deep-sky.md for why.
//
// Usage:
//   npx wrangler dev                       # terminal A
//   node scripts/load-test.mjs             # terminal B
//
// Env vars (all optional):
//   BASE_URL       default http://localhost:8787
//   NUM_SELLERS    default 10
//   NUM_BUYERS     default 20
//   ROUNDS         default 5
//   GAMES          default 2
//   SPEED          default 8    — "thinking time" divisor; poll intervals
//                                 are NOT scaled, so the measured req/s is
//                                 realistic even though the run finishes
//                                 faster. The projection below undoes this:
//                                 it multiplies the measured polling RATE
//                                 (which stays correct) by the real-world
//                                 session length, rather than just scaling
//                                 the compressed run's totals.
//   GAME_MINUTES   default 45   — assumed real wall-clock length of one
//                                 classroom game, for that projection.

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8787'
const NUM_SELLERS = Number(process.env.NUM_SELLERS ?? 10)
const NUM_BUYERS = Number(process.env.NUM_BUYERS ?? 20)
const ROUNDS = Number(process.env.ROUNDS ?? 5)
const GAMES = Number(process.env.GAMES ?? 2)
const SPEED = Number(process.env.SPEED ?? 8)
const GAME_MINUTES = Number(process.env.GAME_MINUTES ?? 45)

// Requests that scale with wall-clock TIME (polling, independent of round
// count) vs. requests that scale with ROUND/PLAYER count (actions — same
// total regardless of how long the thinking-time delays were compressed).
const POLL_ENDPOINTS = new Set(['GET /session', 'GET /session (admin)'])

// Real frontend cadence — see PlayerView.tsx/AdminView.tsx/JoinView.tsx.
const POLL_MARKET_MS = 1500
const POLL_IDLE_MS = 3000
const ADMIN_POLL_MS = 3000

function rand(min, max) { return min + Math.random() * (max - min) }
function sleep(ms) { return new Promise(r => setTimeout(r, Math.max(0, ms))) }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ---- metrics -----------------------------------------------------------

const metrics = {
  byEndpoint: new Map(), // endpoint -> { count, latencies: number[] }
  unexpectedErrors: [],  // { endpoint, status, body }
  expectedConflicts: 0,  // 409s we deliberately provoked
}

function record(endpoint, latencyMs) {
  if (!metrics.byEndpoint.has(endpoint)) metrics.byEndpoint.set(endpoint, { count: 0, latencies: [] })
  const m = metrics.byEndpoint.get(endpoint)
  m.count += 1
  m.latencies.push(latencyMs)
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

// ---- HTTP helper --------------------------------------------------------

async function call(endpoint, { method = 'GET', token, body, expectStatus } = {}) {
  const headers = {}
  if (token) headers['x-token'] = token
  if (body !== undefined) headers['content-type'] = 'application/json'

  const start = performance.now()
  let res
  try {
    res = await fetch(`${BASE_URL}${endpoint.url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    metrics.unexpectedErrors.push({ endpoint: endpoint.label, status: 'network-error', body: String(err) })
    throw err
  }
  const latency = performance.now() - start
  record(endpoint.label, latency)

  const ok = expectStatus ? res.status === expectStatus : res.ok
  let json = null
  try { json = await res.json() } catch { /* empty body */ }

  if (expectStatus === 409 && res.status === 409) {
    metrics.expectedConflicts += 1
  } else if (!ok) {
    metrics.unexpectedErrors.push({ endpoint: endpoint.label, status: res.status, body: json })
  }
  return { status: res.status, json }
}

// ---- virtual session create ----------------------------------------------

async function createSession() {
  const { status, json } = await call({ url: '/api/session', label: 'POST /session' }, {
    method: 'POST',
    body: { numSellers: NUM_SELLERS, numBuyers: NUM_BUYERS, maxSellerUnits: 2, totalRounds: ROUNDS },
  })
  if (status !== 200) throw new Error(`session create failed: ${status} ${JSON.stringify(json)}`)
  return json // { code, adminToken, sessionId }
}

async function joinSlot(code, name, role, slotIndex) {
  const { status, json } = await call(
    { url: `/api/session/${code}/join`, label: 'POST /join' },
    { method: 'POST', body: { name, role, slotIndex } },
  )
  if (status !== 200) throw new Error(`join failed (${role} #${slotIndex}): ${status} ${JSON.stringify(json)}`)
  return json // { playerToken, playerId, session }
}

async function getSession(code, token) {
  return call({ url: `/api/session/${code}`, label: 'GET /session' }, { token })
}

// ---- virtual player: polls + acts like the real frontend ----------------

class VirtualPlayer {
  constructor(code, token, playerId, role) {
    this.code = code
    this.token = token
    this.playerId = playerId
    this.role = role
    this.stop = false
    this.lastSession = null
    this.actedThisRound = -1 // currentRound index already acted on
  }

  async pollLoop() {
    while (!this.stop) {
      const { status, json } = await getSession(this.code, this.token)
      if (status === 200) {
        this.lastSession = json
        await this.maybeAct(json)
      }
      const interval = (this.lastSession?.phase === 'market' ? POLL_MARKET_MS : POLL_IDLE_MS)
        + rand(-150, 150) // real clients don't fire in lockstep
      await sleep(interval)
    }
  }

  async maybeAct(session) {
    if (session.phase === 'game-end') { this.stop = true; return }

    if (this.role === 'seller' && session.phase === 'seller-input') {
      if (this.actedThisRound === session.currentRound) return
      if (session.currentSellerDecisions[this.playerId]) return
      this.actedThisRound = session.currentRound
      await sleep(rand(1000, 4000) / SPEED) // thinking time
      await call(
        { url: `/api/session/${this.code}/seller-decision`, label: 'POST /seller-decision' },
        { method: 'POST', token: this.token, body: { grade: pick([1, 2, 3]), price: Number(rand(2, 10).toFixed(2)) } },
      )
      return
    }

    if (this.role === 'buyer' && session.phase === 'market' && session.currentPlayerId === this.playerId) {
      if (session.currentBuyerDecisions[this.playerId]) return
      await sleep(rand(500, 2000) / SPEED)
      const sellersWithStock = Object.values(session.currentSellerDecisions)
        .filter(sd => (sd.unitsSold ?? 0) < (sd.unitsOffered ?? session.maxSellerUnits))
      const sellerId = sellersWithStock.length && Math.random() > 0.1 ? pick(sellersWithStock).playerId : null
      await call(
        { url: `/api/session/${this.code}/buyer-decision`, label: 'POST /buyer-decision' },
        { method: 'POST', token: this.token, body: { sellerId } },
      )
    }
  }
}

// ---- admin loop -----------------------------------------------------------

class AdminController {
  constructor(code, adminToken) {
    this.code = code
    this.adminToken = adminToken
    this.stop = false
    this.toggledInfoMode = false
  }

  async pollLoop() {
    while (!this.stop) {
      const { status, json } = await call(
        { url: `/api/session/${this.code}`, label: 'GET /session (admin)' },
        { token: this.adminToken },
      )
      if (status === 200) await this.maybeAct(json)
      await sleep(ADMIN_POLL_MS + rand(-200, 200))
    }
  }

  async maybeAct(session) {
    if (session.phase === 'round-end') {
      if (session.currentRound >= 3 && !this.toggledInfoMode) {
        this.toggledInfoMode = true
        await call(
          { url: `/api/session/${this.code}/toggle-info-mode`, label: 'POST /toggle-info-mode' },
          { method: 'POST', token: this.adminToken },
        )
      }
      await sleep(rand(300, 1000) / SPEED)
      await call(
        { url: `/api/session/${this.code}/next-round`, label: 'POST /next-round' },
        { method: 'POST', token: this.adminToken },
      )
    } else if (session.phase === 'game-end') {
      this.stop = true
    }
  }
}

// ---- consistency checks ----------------------------------------------------

function checkConsistency(session, gameLabel) {
  const problems = []
  for (const result of session.results ?? []) {
    if (result.sellerDecisions.length !== NUM_SELLERS) {
      problems.push(`${gameLabel} round ${result.round}: expected ${NUM_SELLERS} seller decisions, got ${result.sellerDecisions.length}`)
    }
    if (result.buyerDecisions.length !== NUM_BUYERS) {
      problems.push(`${gameLabel} round ${result.round}: expected ${NUM_BUYERS} buyer decisions, got ${result.buyerDecisions.length}`)
    }
    for (const sd of result.sellerDecisions) {
      if (sd.unitsSold > sd.unitsOffered) {
        problems.push(`${gameLabel} round ${result.round}: seller ${sd.playerId} sold ${sd.unitsSold} > offered ${sd.unitsOffered}`)
      }
    }
    const eff = result.metrics?.efficiency
    if (eff !== undefined && eff !== null && (eff < -0.001 || eff > 1.001)) {
      problems.push(`${gameLabel} round ${result.round}: efficiency ${eff} out of [0,1]`)
    }
  }
  return problems
}

// ---- one full game ----------------------------------------------------------

async function runGame(gameLabel) {
  console.log(`\n=== ${gameLabel}: creating session (${NUM_SELLERS} sellers, ${NUM_BUYERS} buyers, ${ROUNDS} rounds) ===`)
  const { code, adminToken } = await createSession()
  console.log(`${gameLabel}: code ${code}`)

  // Lobby rush: everyone joins at roughly the same time.
  const joinPromises = []
  for (let i = 0; i < NUM_SELLERS; i++) joinPromises.push(joinSlot(code, `Seller${i}`, 'seller', i))
  for (let i = 0; i < NUM_BUYERS; i++) joinPromises.push(joinSlot(code, `Buyer${i}`, 'buyer', i))
  const joinResults = await Promise.all(joinPromises)

  // Deliberate slot collision: two more players try seller slot 0 and buyer
  // slot 0 after they're already taken — expect 409 on both.
  await call({ url: `/api/session/${code}/join`, label: 'POST /join (conflict)' },
    { method: 'POST', body: { name: 'Collider-S', role: 'seller', slotIndex: 0 }, expectStatus: 409 })
  await call({ url: `/api/session/${code}/join`, label: 'POST /join (conflict)' },
    { method: 'POST', body: { name: 'Collider-B', role: 'buyer', slotIndex: 0 }, expectStatus: 409 })

  const players = joinResults.map((r, i) => {
    const role = i < NUM_SELLERS ? 'seller' : 'buyer'
    return new VirtualPlayer(code, r.playerToken, r.playerId, role)
  })

  const admin = new AdminController(code, adminToken)

  const pollLoops = [admin.pollLoop(), ...players.map(p => p.pollLoop())]

  await sleep(rand(500, 1500))
  const start = await call({ url: `/api/session/${code}/start`, label: 'POST /start' }, { method: 'POST', token: adminToken })
  if (start.status !== 200) throw new Error(`start failed: ${start.status} ${JSON.stringify(start.json)}`)
  console.log(`${gameLabel}: started`)

  // Wait for the admin loop to see game-end (bounded safety timeout).
  const deadline = Date.now() + 1000 * 60 * 5
  while (!admin.stop && Date.now() < deadline) await sleep(500)
  players.forEach(p => { p.stop = true })
  await Promise.all(pollLoops)

  const final = await getSession(code, adminToken)
  const finalSize = JSON.stringify(final.json).length
  console.log(`${gameLabel}: finished, final session payload ${(finalSize / 1024).toFixed(1)} KB`)

  return checkConsistency(final.json, gameLabel)
}

// ---- main ----------------------------------------------------------------

async function main() {
  console.log(`Load test: ${BASE_URL}, ${NUM_SELLERS}S/${NUM_BUYERS}B, ${ROUNDS} rounds x ${GAMES} games, SPEED=${SPEED}`)
  const overallStart = Date.now()
  let allProblems = []

  for (let g = 1; g <= GAMES; g++) {
    const problems = await runGame(`Game ${g}`)
    allProblems = allProblems.concat(problems)
  }

  const durationSec = (Date.now() - overallStart) / 1000

  console.log('\n=== Results ===')
  console.log(`Total wall time: ${(durationSec / 60).toFixed(1)} min (SPEED=${SPEED} compresses thinking time, not poll intervals)`)
  let totalRequests = 0
  let pollRequests = 0
  let actionRequests = 0
  for (const [endpoint, m] of metrics.byEndpoint) {
    const sorted = [...m.latencies].sort((a, b) => a - b)
    totalRequests += m.count
    if (POLL_ENDPOINTS.has(endpoint)) pollRequests += m.count
    else actionRequests += m.count
    console.log(
      `  ${endpoint.padEnd(28)} n=${String(m.count).padEnd(6)} `
      + `p50=${percentile(sorted, 0.5).toFixed(0)}ms p95=${percentile(sorted, 0.95).toFixed(0)}ms max=${sorted[sorted.length - 1]?.toFixed(0)}ms`,
    )
  }
  console.log(`  TOTAL requests: ${totalRequests}`)

  // SPEED compressed thinking time, so this run's wall-clock time is NOT
  // the real session length — only polling's rate (req/s) survived that
  // compression unchanged. Action-request counts (join/decisions/rounds)
  // scale with round+player count, not wall time, so they're already
  // real; only the polling volume needs re-expanding to the real duration.
  const pollRatePerSec = pollRequests / durationSec
  const realSessionSec = GAME_MINUTES * 60 * GAMES
  const projectedPoll = pollRatePerSec * realSessionSec
  const projectedTotal = projectedPoll + actionRequests
  console.log(`  Measured poll rate: ${pollRatePerSec.toFixed(2)} req/s (this run's thinking-time compression does not affect this)`)
  console.log(`  Projected for ${GAMES} real game(s) @ ${GAME_MINUTES} min each: ~${Math.round(projectedTotal)} requests`
    + ` (${Math.round(projectedPoll)} polling + ${actionRequests} actions)`)
  console.log(`  Cloudflare free-tier daily cap: 100,000 (Workers) and 100,000 (Durable Objects)`)

  console.log(`\n  Expected 409 conflicts seen: ${metrics.expectedConflicts} (want 2, one per deliberate slot collision x ${GAMES} games = ${2 * GAMES})`)
  console.log(`  Unexpected errors: ${metrics.unexpectedErrors.length}`)
  if (metrics.unexpectedErrors.length) {
    for (const e of metrics.unexpectedErrors.slice(0, 20)) {
      console.log(`    - ${e.endpoint}: ${e.status} ${JSON.stringify(e.body)}`)
    }
  }

  console.log(`\n  Consistency problems: ${allProblems.length}`)
  for (const p of allProblems) console.log(`    - ${p}`)

  const failed = metrics.unexpectedErrors.length > 0
    || allProblems.length > 0
    || metrics.expectedConflicts !== 2 * GAMES
  if (failed) {
    console.log('\nFAILED — see errors/problems above.')
    process.exit(1)
  }
  console.log('\nPASSED.')
}

main().catch(err => {
  console.error('\nLoad test crashed:', err)
  process.exit(1)
})
