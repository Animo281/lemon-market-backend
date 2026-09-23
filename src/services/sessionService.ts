import { v4 as uuid } from 'uuid'
import { Session, Player, Role, Grade, EconomicsConfig } from '../shared/types'
import { DEFAULT_MAX_SELLER_UNITS, DEFAULT_TOTAL_ROUNDS, DEFAULT_ECONOMICS } from '../shared/constants'
import { SessionRepository } from '../repositories/sessionRepository'
import { HttpError } from '../http/httpError'
import { shuffleArray, calculateBuyerEarnings, computeRoundResult, advanceRound, findNextBuyerIndex } from '../lib/gameLogic'
import { getCurrentPlayerId } from './gameAnalytics'

function checkPhaseTransition(session: Session): void {
  if (session.phase === 'seller-input') {
    const sellers = session.players.filter(p => p.role === 'seller')
    if (sellers.every(s => s.id in session.currentSellerDecisions)) {
      const buyers = session.players.filter(p => p.role === 'buyer')
      session.phase = 'market'
      session.buyerQueue = shuffleArray(buyers.map(b => b.id))
      session.currentBuyerIndex = 0
    }
  } else if (session.phase === 'market') {
    session.currentBuyerIndex = findNextBuyerIndex(session.buyerQueue, session.currentBuyerDecisions)
    const buyers = session.players.filter(p => p.role === 'buyer')
    if (Object.keys(session.currentBuyerDecisions).length >= buyers.length) {
      session.results.push(computeRoundResult(session))
      session.phase = 'round-end'
    }
  }
}

// Math.random().toString(36) always starts with "0." — uppercasing and
// stripping the dot used to leave a leading "0" on every code, cutting the
// effective keyspace from 36^4 to 36^3. Draw uniformly from the alphabet
// instead.
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateCode(): string {
  return Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')
}

function createUniqueCode(repo: SessionRepository): string {
  for (let i = 0; i < 20; i++) {
    const code = generateCode()
    if (!repo.getByCode(code)) return code
  }
  throw new HttpError(500, 'Konnte keinen eindeutigen Session-Code erzeugen — bitte erneut versuchen.')
}

export function createSession(
  repo: SessionRepository,
  numSellers: number,
  numBuyers: number,
  maxSellerUnits: number = DEFAULT_MAX_SELLER_UNITS,
  totalRounds: number = DEFAULT_TOTAL_ROUNDS,
  requestedCode?: string,
  economics: EconomicsConfig = DEFAULT_ECONOMICS,
): Session {
  const code = requestedCode?.toUpperCase() ?? createUniqueCode(repo)
  if (requestedCode && repo.getByCode(code)) {
    throw new HttpError(409, 'Dieser Session-Code ist bereits vergeben.')
  }
  const session: Session = {
    id: uuid(),
    code,
    adminToken: uuid(),
    numSellers,
    numBuyers,
    maxSellerUnits,
    totalRounds,
    economics,
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
  if (session.phase !== 'lobby') throw new HttpError(400, 'Die Session hat bereits begonnen — Beitritt nicht mehr möglich.')

  const maxSlot = role === 'seller' ? session.numSellers : session.numBuyers
  if (slotIndex < 0 || slotIndex >= maxSlot) throw new HttpError(400, 'Ungültiger Platz.')
  if (session.players.some(p => p.role === role && p.slotIndex === slotIndex)) {
    throw new HttpError(409, 'Dieser Platz ist schon vergeben.')
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
  economics?: EconomicsConfig,
): Session {
  if (session.phase !== 'lobby') throw new HttpError(400, 'Einstellungen sind nach Spielstart gesperrt.')
  if (maxSellerUnits !== undefined) session.maxSellerUnits = maxSellerUnits
  if (totalRounds !== undefined) session.totalRounds = totalRounds
  if (economics !== undefined) session.economics = economics
  repo.save(session)
  return session
}

export function startGame(repo: SessionRepository, session: Session): Session {
  if (session.phase !== 'lobby') throw new HttpError(400, 'Das Spiel läuft bereits.')
  const sellers = session.players.filter(p => p.role === 'seller')
  const buyers = session.players.filter(p => p.role === 'buyer')
  if (sellers.length === 0 || buyers.length === 0) {
    throw new HttpError(400, 'Mindestens 1 Verkäufer und 1 Käufer nötig, bevor das Spiel startet.')
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
  if (session.phase !== 'seller-input') throw new HttpError(400, 'Die Verkaufsphase ist vorbei — deine Entscheidung kommt jetzt zu spät.')

  const offered = Math.min(session.maxSellerUnits, Math.max(1, unitsOffered ?? session.maxSellerUnits))
  session.currentSellerDecisions[playerId] = { playerId, grade, price, unitsOffered: offered, unitsSold: 0 }

  checkPhaseTransition(session)

  repo.save(session)
  return session
}

export function submitBuyerDecision(
  repo: SessionRepository,
  session: Session,
  playerId: string,
  sellerId: string | null,
): Session {
  if (session.phase !== 'market') throw new HttpError(400, 'Der Markt ist gerade nicht offen.')
  if (session.currentBuyerDecisions[playerId]) throw new HttpError(400, 'Du hast in dieser Runde schon entschieden.')
  // Paper procedure (S. 3-4): buyers are drawn by lot and shop one at a time,
  // in that order — later buyers see which stands already sold out. The
  // queue/currentPlayerId were already computed and shown, just never
  // enforced (any buyer could act at any moment during 'market'). Enforcing
  // it here is what makes the visible "Du bist dran" state actually true.
  if (getCurrentPlayerId(session) !== playerId) throw new HttpError(400, 'Du bist noch nicht an der Reihe.')

  let grade = null
  let price = null
  let earnings = 0

  if (sellerId !== null) {
    // sellerId comes straight from the request body (schema only checks
    // "is a string"). Looking it up against a plain object keyed by id
    // (currentSellerDecisions) before confirming it's an actual seller would
    // let "__proto__"/"constructor" reach into Object.prototype — so a real
    // player match comes first, and only then the decisions lookup.
    const seller = session.players.find(p => p.id === sellerId && p.role === 'seller')
    if (!seller) throw new HttpError(400, 'Unbekannter Verkäufer.')
    const sd = session.currentSellerDecisions[sellerId]
    if (!sd) throw new HttpError(400, `${seller.name} hat noch kein Angebot abgegeben.`)
    const maxUnits = sd.unitsOffered ?? session.maxSellerUnits
    if ((sd.unitsSold ?? 0) >= maxUnits) throw new HttpError(400, 'Bei diesem Stand ist alles verkauft.')
    grade = sd.grade ?? null
    price = sd.price ?? null
    earnings = calculateBuyerEarnings(session.economics.buyerValues, grade, price)
    sd.unitsSold = (sd.unitsSold ?? 0) + 1
  }

  session.currentBuyerDecisions[playerId] = { playerId, sellerId, grade, price, earnings }

  checkPhaseTransition(session)

  repo.save(session)
  return session
}

export function toggleInfoMode(repo: SessionRepository, session: Session): Session {
  session.infoMode = session.infoMode === 'full' ? 'asymmetric' : 'full'
  repo.save(session)
  return session
}

export function advanceToNextRound(repo: SessionRepository, session: Session): Session {
  if (session.phase !== 'round-end') throw new HttpError(400, 'Diese Runde ist noch nicht beendet.')
  Object.assign(session, advanceRound(session))
  repo.save(session)
  return session
}

export function kickPlayer(repo: SessionRepository, session: Session, playerId: string): Session {
  const player = session.players.find(p => p.id === playerId)
  if (!player) throw new HttpError(404, 'Spieler nicht gefunden.')

  // A buyer who already bought from a seller this round leaves that seller's
  // unitsSold pointing at a sale that no longer exists — decrement it so the
  // unit becomes available again instead of being permanently phantom-sold.
  if (player.role === 'buyer') {
    const decision = session.currentBuyerDecisions[playerId]
    if (decision?.sellerId) {
      const sd = session.currentSellerDecisions[decision.sellerId]
      if (sd && (sd.unitsSold ?? 0) > 0) sd.unitsSold = (sd.unitsSold ?? 0) - 1
    }
  }

  session.players = session.players.filter(p => p.id !== playerId)
  session.buyerQueue = session.buyerQueue.filter(id => id !== playerId)
  delete session.currentSellerDecisions[playerId]
  delete session.currentBuyerDecisions[playerId]

  checkPhaseTransition(session)
  repo.save(session)
  return session
}

export function skipCurrentBuyer(repo: SessionRepository, session: Session): Session {
  if (session.phase !== 'market') throw new HttpError(400, 'Der Markt ist gerade nicht offen.')

  const currentPlayerId = session.buyerQueue[session.currentBuyerIndex] ?? null
  if (!currentPlayerId) throw new HttpError(400, 'Kein Käufer ist gerade an der Reihe.')
  if (session.currentBuyerDecisions[currentPlayerId]) throw new HttpError(400, 'Dieser Käufer hat bereits entschieden.')

  session.currentBuyerDecisions[currentPlayerId] = {
    playerId: currentPlayerId,
    sellerId: null,
    grade: null,
    price: null,
    earnings: 0,
  }

  checkPhaseTransition(session)
  repo.save(session)
  return session
}

export function forceAdvanceFromSellerInput(repo: SessionRepository, session: Session): Session {
  if (session.phase !== 'seller-input') throw new HttpError(400, 'Die Verkaufsphase läuft gerade nicht.')

  const sellers = session.players.filter(p => p.role === 'seller')
  for (const seller of sellers) {
    if (!(seller.id in session.currentSellerDecisions)) {
      session.currentSellerDecisions[seller.id] = {
        playerId: seller.id,
        grade: 1,
        price: 0,
        unitsOffered: 0,
        unitsSold: 0,
        earnings: 0,
      }
    }
  }

  checkPhaseTransition(session)
  repo.save(session)
  return session
}
