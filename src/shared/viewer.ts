import { Player, Session } from './types'

export type Viewer =
  | { kind: 'admin' }
  | { kind: 'player'; player: Player }
  | { kind: 'anonymous' }

export function findPlayerByToken(session: Session, token: string | null | undefined): Player | undefined {
  return token ? session.players.find(p => p.token === token) : undefined
}

export function resolveViewer(session: Session, token: string | null | undefined): Viewer {
  if (token && token === session.adminToken) return { kind: 'admin' }
  const player = findPlayerByToken(session, token)
  return player ? { kind: 'player', player } : { kind: 'anonymous' }
}
