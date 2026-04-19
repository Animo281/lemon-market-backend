import { Router, Request, Response } from 'express'
import { Grade, Role } from '../shared/types'
import { DEFAULT_MAX_SELLER_UNITS, DEFAULT_TOTAL_ROUNDS } from '../shared/constants'
import { createSession, joinSession, isSlotTaken, findPlayer, isAdminToken, toPublic } from '../lib/sessionLogic'
import { shuffleArray, calculateBuyerEarnings, computeRoundResult, advanceRound } from '../lib/gameLogic'
import { getSessionByCode, setSession } from '../lib/store'

const router = Router()

function getToken(req: Request): string | undefined {
  return (req.headers['x-token'] as string) ?? undefined
}

// POST /api/session — create
router.post('/', (req: Request, res: Response) => {
  const { numSellers = 3, numBuyers = 4, maxSellerUnits, totalRounds } = req.body as {
    numSellers?: number
    numBuyers?: number
    maxSellerUnits?: number
    totalRounds?: number
  }
  const clampedUnits = Math.min(5, Math.max(1, Number(maxSellerUnits) || DEFAULT_MAX_SELLER_UNITS))
  const clampedRounds = Math.min(20, Math.max(1, Number(totalRounds) || DEFAULT_TOTAL_ROUNDS))
  const session = createSession(numSellers, numBuyers, clampedUnits, clampedRounds)
  setSession(session)
  res.json({ code: session.code, adminToken: session.adminToken, sessionId: session.id })
})

// GET /api/session/:code — public state
router.get('/:code', (req: Request, res: Response) => {
  const session = getSessionByCode(req.params.code)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }
  res.json(toPublic(session))
})

// POST /api/session/:code/join
router.post('/:code/join', (req: Request, res: Response) => {
  const session = getSessionByCode(req.params.code)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }
  if (session.phase !== 'lobby') { res.status(400).json({ error: 'Session already started' }); return }

  const { name, role, slotIndex } = req.body as { name: string; role: Role; slotIndex: number }
  if (!name || !role || slotIndex === undefined) {
    res.status(400).json({ error: 'name, role, slotIndex required' }); return
  }
  if (role !== 'seller' && role !== 'buyer') {
    res.status(400).json({ error: 'role must be seller or buyer' }); return
  }
  const maxSlot = role === 'seller' ? session.numSellers : session.numBuyers
  if (slotIndex < 0 || slotIndex >= maxSlot) {
    res.status(400).json({ error: 'Invalid slotIndex' }); return
  }
  if (isSlotTaken(session, role, slotIndex)) {
    res.status(409).json({ error: 'Slot already taken' }); return
  }

  const player = joinSession(session, name, role, slotIndex)
  setSession(session)
  res.json({ playerToken: player.id, playerId: player.id, session: toPublic(session) })
})

// POST /api/session/:code/start — admin
router.post('/:code/start', (req: Request, res: Response) => {
  const session = getSessionByCode(req.params.code)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }

  const token = getToken(req)
  if (!token || !isAdminToken(session, token)) { res.status(403).json({ error: 'Forbidden' }); return }
  if (session.phase !== 'lobby') { res.status(400).json({ error: 'Already started' }); return }

  const sellers = session.players.filter(p => p.role === 'seller')
  const buyers = session.players.filter(p => p.role === 'buyer')
  if (sellers.length === 0 || buyers.length === 0) {
    res.status(400).json({ error: 'Need at least 1 seller and 1 buyer' }); return
  }

  session.phase = 'seller-input'
  session.currentRound = 1
  session.infoMode = 'full'
  session.buyerQueue = shuffleArray(buyers.map(b => b.id))
  session.currentBuyerIndex = 0
  session.currentSellerDecisions = {}
  session.currentBuyerDecisions = {}
  setSession(session)
  res.json(toPublic(session))
})

// PATCH /api/session/:code/config — admin only, lobby only
router.patch('/:code/config', (req: Request, res: Response) => {
  const session = getSessionByCode(req.params.code)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }
  const token = getToken(req)
  if (!token || !isAdminToken(session, token)) { res.status(403).json({ error: 'Forbidden' }); return }
  if (session.phase !== 'lobby') { res.status(400).json({ error: 'Config locked after start' }); return }

  const { maxSellerUnits, totalRounds } = req.body as { maxSellerUnits?: number; totalRounds?: number }
  if (maxSellerUnits !== undefined) {
    session.maxSellerUnits = Math.min(5, Math.max(1, Number(maxSellerUnits) || session.maxSellerUnits))
  }
  if (totalRounds !== undefined) {
    session.totalRounds = Math.min(20, Math.max(1, Number(totalRounds) || session.totalRounds))
  }
  setSession(session)
  res.json(toPublic(session))
})

// POST /api/session/:code/seller-decision
router.post('/:code/seller-decision', (req: Request, res: Response) => {
  const session = getSessionByCode(req.params.code)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }

  const token = getToken(req)
  const player = token ? findPlayer(session, token) : undefined
  if (!player || player.role !== 'seller') { res.status(403).json({ error: 'Forbidden' }); return }
  if (session.phase !== 'seller-input') { res.status(400).json({ error: 'Wrong phase' }); return }

  const { grade, price, unitsOffered } = req.body as { grade: Grade; price: number; unitsOffered?: number }
  if (!grade || price === undefined) { res.status(400).json({ error: 'grade, price required' }); return }

  const offered = Math.min(session.maxSellerUnits, Math.max(1, Number(unitsOffered) || session.maxSellerUnits))

  session.currentSellerDecisions[player.id] = {
    playerId: player.id,
    grade,
    price,
    unitsOffered: offered,
    unitsSold: 0,
    confirmed: false,
  }

  const sellers = session.players.filter(p => p.role === 'seller')
  const allIn = sellers.every(s => s.id in session.currentSellerDecisions)
  if (allIn) {
    const buyers = session.players.filter(p => p.role === 'buyer')
    session.phase = 'market'
    session.buyerQueue = shuffleArray(buyers.map(b => b.id))
    session.currentBuyerIndex = 0
  }

  setSession(session)
  res.json(toPublic(session))
})

// POST /api/session/:code/buyer-decision
router.post('/:code/buyer-decision', (req: Request, res: Response) => {
  const session = getSessionByCode(req.params.code)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }

  const token = getToken(req)
  const player = token ? findPlayer(session, token) : undefined
  if (!player || player.role !== 'buyer') { res.status(403).json({ error: 'Forbidden' }); return }
  if (session.phase !== 'market') { res.status(400).json({ error: 'Wrong phase' }); return }

  if (session.currentBuyerDecisions[player.id]) {
    res.status(400).json({ error: 'Already submitted' }); return
  }

  const { sellerId } = req.body as { sellerId: string | null }

  let grade = null
  let price = null
  let earnings = 0

  if (sellerId !== null) {
    const sd = session.currentSellerDecisions[sellerId]
    if (!sd) { res.status(400).json({ error: 'Seller has no decision' }); return }
    const maxUnits = sd.unitsOffered ?? session.maxSellerUnits
    if ((sd.unitsSold ?? 0) >= maxUnits) { res.status(400).json({ error: 'Seller sold out' }); return }
    grade = sd.grade ?? null
    price = sd.price ?? null
    earnings = calculateBuyerEarnings(grade, price)
    sd.unitsSold = (sd.unitsSold ?? 0) + 1
  }

  session.currentBuyerDecisions[player.id] = { playerId: player.id, sellerId, grade, price, earnings }

  const buyers = session.players.filter(p => p.role === 'buyer')
  if (Object.keys(session.currentBuyerDecisions).length >= buyers.length) {
    const result = computeRoundResult(session)
    session.results.push(result)
    session.phase = 'round-end'
  }

  setSession(session)
  res.json(toPublic(session))
})

// POST /api/session/:code/toggle-info-mode — admin
router.post('/:code/toggle-info-mode', (req: Request, res: Response) => {
  const session = getSessionByCode(req.params.code)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }
  const token = getToken(req)
  if (!token || !isAdminToken(session, token)) { res.status(403).json({ error: 'Forbidden' }); return }
  if (session.infoMode !== 'full') { res.status(400).json({ error: 'Info mode already locked to asymmetric' }); return }
  session.infoMode = 'asymmetric'
  setSession(session)
  res.json(toPublic(session))
})

// POST /api/session/:code/next-round — admin
router.post('/:code/next-round', (req: Request, res: Response) => {
  const session = getSessionByCode(req.params.code)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }

  const token = getToken(req)
  if (!token || !isAdminToken(session, token)) { res.status(403).json({ error: 'Forbidden' }); return }

  const next = advanceRound(session)
  setSession(next)
  res.json(toPublic(next))
})

export default router
