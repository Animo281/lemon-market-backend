export type Grade = 1 | 2 | 3
export type GamePhase = 'lobby' | 'seller-input' | 'market' | 'round-end' | 'game-end'
export type InfoMode = 'full' | 'asymmetric'
export type Role = 'seller' | 'buyer'

export interface Player {
  id: string       // UUID — also serves as playerToken
  name: string
  role: Role
  slotIndex: number
}

export interface SellerDecision {
  playerId: string
  grade: Grade
  price: number
  unitsOffered: number
  unitsSold: number
  confirmed: boolean
}

export interface BuyerDecision {
  playerId: string
  sellerId: string | null   // null = no purchase
  grade: Grade | null
  price: number | null
  earnings: number
}

export interface RoundResult {
  round: number
  infoMode: InfoMode
  sellerDecisions: SellerDecision[]
  buyerDecisions: BuyerDecision[]
  totalSurplus: number
}

export interface Session {
  id: string
  code: string           // 4-char uppercase join code
  adminToken: string
  numSellers: number
  numBuyers: number
  maxSellerUnits: number
  totalRounds: number
  phase: GamePhase
  currentRound: number
  infoMode: InfoMode
  players: Player[]
  buyerQueue: string[]           // ordered player IDs for current round
  currentBuyerIndex: number
  currentSellerDecisions: Record<string, Partial<SellerDecision>>  // key = playerId
  currentBuyerDecisions: Record<string, BuyerDecision>             // key = playerId
  results: RoundResult[]
}

// Sent to clients — adminToken stripped
export type PublicSession = Omit<Session, 'adminToken'>
