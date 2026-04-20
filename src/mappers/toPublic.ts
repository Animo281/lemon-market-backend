import { Session, PublicSession } from '../shared/types'

export function toPublic(session: Session): PublicSession {
  const { adminToken: _a, ...rest } = session
  return {
    ...rest,
    players: session.players.map(({ token: _t, ...p }) => p),
  }
}
