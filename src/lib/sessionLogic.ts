import { v4 as uuid } from 'uuid'
import { Session, Player, Role, PublicSession } from '../shared/types'
import { DEFAULT_MAX_SELLER_UNITS, DEFAULT_TOTAL_ROUNDS } from '../shared/constants'
import { getSessionByCode } from './store'

function generateCode(): string {
  return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4).padEnd(4, '0')
}

export function createCode(): string {
  let code = generateCode()
  let attempts = 0
  while (getSessionByCode(code) && attempts < 20) {
    code = generateCode()
    attempts++
  }
  return code
}

export function createSession(numSellers: number, numBuyers: number, maxSellerUnits: number = DEFAULT_MAX_SELLER_UNITS, totalRounds: number = DEFAULT_TOTAL_ROUNDS): Session {
  return {
    id: uuid(),
    code: createCode(),
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
}

export function joinSession(session: Session, name: string, role: Role, slotIndex: number): Player {
  const player: Player = { id: uuid(), name, role, slotIndex }
  session.players.push(player)
  return player
}

export function isSlotTaken(session: Session, role: Role, slotIndex: number): boolean {
  return session.players.some(p => p.role === role && p.slotIndex === slotIndex)
}

export function findPlayer(session: Session, token: string): Player | undefined {
  return session.players.find(p => p.id === token)
}

export function isAdminToken(session: Session, token: string): boolean {
  return session.adminToken === token
}

export function toPublic(session: Session): PublicSession {
  const { adminToken: _, ...pub } = session
  return pub
}
