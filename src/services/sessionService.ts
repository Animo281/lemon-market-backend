import { v4 as uuid } from 'uuid'
import { Session, Player, Role, Grade } from '../shared/types'
import { DEFAULT_MAX_SELLER_UNITS, DEFAULT_TOTAL_ROUNDS } from '../shared/constants'
import { SessionRepository } from '../repositories/sessionRepository'
import { HttpError } from '../middleware/errorHandler'
import { shuffleArray, calculateBuyerEarnings, computeRoundResult, advanceRound } from '../lib/gameLogic'

function generateCode(): string {
  return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
}

function createUniqueCode(repo: SessionRepository): string {
  for (let i = 0; i < 20; i++) {
    const code = generateCode()
    if (code.length === 4 && !repo.getByCode(code)) return code
  }
  throw new HttpError(500, 'Could not generate unique session code')
}

export function createSession(
  repo: SessionRepository,
  numSellers: number,
  numBuyers: number,
  maxSellerUnits: number = DEFAULT_MAX_SELLER_UNITS,
  totalRounds: number = DEFAULT_TOTAL_ROUNDS,
): Session {
  const session: Session = {
    id: uuid(),
    code: createUniqueCode(repo),
    adminToken: uuid(),
    numSellers,
    numBuyers,
    maxSellerUnits,
    totalRounds,
    phase: 'lobby',
    currentRound: 1,
    infoMode: 'full',
    players: [],
    buyerQueue: [],
    currentBuyerIndex: 0,
    currentSellerDecisions: {},
    currentBuyerDecisions: {},
    results: [],
  }
  repo.save(session)
  return session
}

export function joinSession(
  repo: SessionRepository,
  session: Session,
  name: string,
  role: Role,
  slotIndex: number,
): { player: Player; token: string } {
  if (session.phase !== 'lobby') throw new HttpError(400, 'Session already started')

  const maxSlot = role === 'seller' ? session.numSellers : session.numBuyers
  if (slotIndex < 0 || slotIndex >= maxSlot) throw new HttpError(400, 'Invalid slotIndex')
  if (session.players.some(p => p.role === role && p.slotIndex === slotIndex)) {
    throw new HttpError(409, 'Slot already taken')
  }

  const token = uuid()
  const player: Player = { id: uuid(), token, name, role, slotIndex }
  session.players.push(player)
  repo.save(session)
  return { player, token }
}

export function updateConfig(
  repo: SessionRepository,
  session: Session,
  maxSellerUnits?: number,
  totalRounds?: number,
): Session {
  if (session.phase !== 'lobby') throw new HttpError(400, 'Config locked after start')
  if (maxSellerUnits !== undefined) session.maxSellerUnits = maxSellerUnits
  if (totalRounds !== undefined) session.totalRounds = totalRounds
  repo.save(session)
  return session
}

export function startGame(repo: SessionRepository, session: Session): Session {
  if (session.phase !== 'lobby') throw new HttpError(400, 'Already started')
  const sellers = session.players.filter(p => p.role === 'seller')
  const buyers = session.players.filter(p => p.role === 'buyer')
  if (sellers.length === 0 || buyers.length === 0) {
    throw new HttpError(400, 'Need at least 1 seller and 1 buyer')
  }
  session.phase = 'seller-input'
  session.currentRound = 1
  session.infoMode = 'full'
  session.buyerQueue = shuffleArray(buyers.map(b => b.id))
  session.currentBuyerIndex = 0
  session.currentSellerDecisions = {}
  session.currentBuyerDecisions = {}
  repo.save(session)
  return session
}

export function submitSellerDecision(
  repo: SessionRepository,
  session: Session,
  playerId: string,
  grade: Grade,
  price: number,
  unitsOffered?: number,
): Session {
  if (session.phase !== 'seller-input') throw new HttpError(400, 'Wrong phase')

  const offered = Math.min(session.maxSellerUnits, Math.max(1, unitsOffered ?? session.maxSellerUnits))
  session.currentSellerDecisions[playerId] = { playerId, grade, price, unitsOffered: offered, unitsSold: 0, confirmed: false }

  const sellers = session.players.filter(p => p.role === 'seller')
  if (sellers.every(s => s.id in session.currentSellerDecisions)) {
    const buyers = session.players.filter(p => p.role === 'buyer')
    session.phase = 'market'
    session.buyerQueue = shuffleArray(buyers.map(b => b.id))
    session.currentBuyerIndex = 0
  }

  repo.save(session)
  return session
}

export function submitBuyerDecision(
  repo: SessionRepository,
  session: Session,
  playerId: string,
  sellerId: string | null,
): Session {
  if (session.phase !== 'market') throw new HttpError(400, 'Wrong phase')
  if (session.currentBuyerDecisions[playerId]) throw new HttpError(400, 'Already submitted')

  let grade = null
  let price = null
  let earnings = 0

  if (sellerId !== null) {
    const sd = session.currentSellerDecisions[sellerId]
    if (!sd) throw new HttpError(400, 'Seller has no decision')
    const maxUnits = sd.unitsOffered ?? session.maxSellerUnits
    if ((sd.unitsSold ?? 0) >= maxUnits) throw new HttpError(400, 'Seller sold out')
    grade = sd.grade ?? null
    price = sd.price ?? null
    earnings = calculateBuyerEarnings(grade, price)
    sd.unitsSold = (sd.unitsSold ?? 0) + 1
  }

  session.currentBuyerDecisions[playerId] = { playerId, sellerId, grade, price, earnings }

  const buyers = session.players.filter(p => p.role === 'buyer')
  if (Object.keys(session.currentBuyerDecisions).length >= buyers.length) {
    session.results.push(computeRoundResult(session))
    session.phase = 'round-end'
  }

  repo.save(session)
  return session
}

export function toggleInfoMode(repo: SessionRepository, session: Session): Session {
  if (session.infoMode !== 'full') throw new HttpError(400, 'Info mode already locked to asymmetric')
  session.infoMode = 'asymmetric'
  repo.save(session)
  return session
}

export function advanceToNextRound(repo: SessionRepository, session: Session): Session {
  if (session.phase !== 'round-end') throw new HttpError(400, 'Wrong phase')
  Object.assign(session, advanceRound(session))
  repo.save(session)
  return session
}
