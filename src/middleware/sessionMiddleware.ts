import { Request, Response, NextFunction } from 'express'
import { SessionRepository } from '../repositories/sessionRepository'
import { HttpError } from './errorHandler'
import { Session, Role, Player } from '../shared/types'

// Non-throwing identity resolution for GET /:code — see resolveViewer below.
export type Viewer =
  | { kind: 'admin' }
  | { kind: 'player'; player: Player }
  | { kind: 'anonymous' }

declare global {
  namespace Express {
    interface Request {
      session?: Session
      player?: Player
      viewer?: Viewer
    }
  }
}

export function createSessionMiddleware(repo: SessionRepository) {
  function loadSession(req: Request, _res: Response, next: NextFunction): void {
    const session = repo.getByCode(req.params.code)
    if (!session) throw new HttpError(404, 'Session nicht gefunden — Code prüfen.')
    req.session = session
    next()
  }

  function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
    const token = req.headers['x-token'] as string | undefined
    if (!token || token !== req.session!.adminToken) throw new HttpError(403, 'Zugriff verweigert — kein gültiges Admin-Token.')
    next()
  }

  function requirePlayer(role?: Role) {
    return (req: Request, _res: Response, next: NextFunction): void => {
      const token = req.headers['x-token'] as string | undefined
      const player = token ? req.session!.players.find(p => p.token === token) : undefined
      if (!player) throw new HttpError(403, 'Zugriff verweigert — kein gültiges Spieler-Token.')
      if (role && player.role !== role) {
        throw new HttpError(403, role === 'seller' ? 'Nur Verkäufer dürfen das.' : 'Nur Käufer dürfen das.')
      }
      req.player = player
      next()
    }
  }

  // Non-throwing: resolves *who* is asking (admin / a specific player / nobody
  // identifiable) without gating access — used by GET /:code so toPublic() can
  // decide what to mask (e.g. hidden grade in asymmetric mode) without adding
  // a hard auth requirement to a route that must stay publicly pollable.
  function resolveViewer(req: Request, _res: Response, next: NextFunction): void {
    const token = req.headers['x-token'] as string | undefined
    const session = req.session!
    if (token && token === session.adminToken) {
      req.viewer = { kind: 'admin' }
    } else {
      const player = token ? session.players.find(p => p.token === token) : undefined
      req.viewer = player ? { kind: 'player', player } : { kind: 'anonymous' }
    }
    next()
  }

  return { loadSession, requireAdmin, requirePlayer, resolveViewer }
}
