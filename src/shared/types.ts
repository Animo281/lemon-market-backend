export type Grade = 1 | 2 | 3
export type GamePhase = 'lobby' | 'seller-input' | 'market' | 'round-end' | 'game-end'
export type InfoMode = 'full' | 'asymmetric'
export type Role = 'seller' | 'buyer'

export interface Player {
  id: string
  token: string   // opaque auth token — never sent to clients
  name: string
  role: Role
  slotIndex: number
}

export interface PublicPlayer {
  id: string
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
  earnings: number  // sum of (price - sellerCost(grade, i)) over sold units
}

export interface BuyerDecision {
  playerId: string
  sellerId: string | null   // null = no purchase
  grade: Grade | null
  price: number | null
  earnings: number
}

export interface RoundMetrics {
  totalSellerProfit: number
  totalBuyerProfit: number
  avgTransactionPrice: number | null
  transactions: number
  theoreticalMaxSurplus: number
  efficiency: number  // totalSurplus / theoreticalMaxSurplus, 0 if theoreticalMax is 0
  equilibrium: { qty: number; price: number } | null
  supplyCurve: number[]  // ask prices sorted ascending
  demandCurve: number[]  // wtp values sorted descending
}

export interface RoundResult {
  round: number
  infoMode: InfoMode
  sellerDecisions: SellerDecision[]
  buyerDecisions: BuyerDecision[]
  totalSurplus: number
  metrics: RoundMetrics
}

export interface AvailableOffer {
  sellerId: string
  sellerName: string
  unitsOffered: number
  unitsSold: number
  unitsRemaining: number
  price: number | null   // null if seller hasn't submitted yet
  grade: Grade | null    // null if asymmetric info or not submitted
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
  buyerQueue: string[]
  currentBuyerIndex: number
  currentSellerDecisions: Record<string, Partial<SellerDecision>>
  currentBuyerDecisions: Record<string, BuyerDecision>
  results: RoundResult[]
}

export interface PublicSession extends Omit<Session, 'adminToken' | 'players'> {
  players: PublicPlayer[]
  currentPlayerId: string | null
  availableOffers: AvailableOffer[]
  economics: {
    buyerValues: Record<Grade, number>
    sellerCosts: Array<{ grade: Grade; first: number; second: number }>
  }
  limits: {
    maxSellerUnits: number
    maxRounds: number
  }
  currentRoundMetrics: RoundMetrics | null
}
