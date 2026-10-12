import { Request, Response, NextFunction } from 'express'
import { SessionRepository } from '../repositories/sessionRepository'
import { HttpError } from '../http/httpError'
import { Session, Role, Player } from '../shared/types'
import { findPlayerByToken, resolveViewer as resolveViewerForToken, Viewer } from '../shared/viewer'

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
      const player = findPlayerByToken(req.session!, token)
      if (!player) throw new HttpError(403, 'Zugriff verweigert — kein gültiges Spieler-Token.')
      if (role && player.role !== role) {
        throw new HttpError(403, role === 'seller' ? 'Nur Verkäufer dürfen das.' : 'Nur Käufer dürfen das.')
      }
      req.player = player
      next()
    }
  }

  // Non-throwing: resolves who's asking without gating access, so GET /:code
  // can still mask e.g. a hidden grade without requiring auth.
  function resolveViewer(req: Request, _res: Response, next: NextFunction): void {
    const token = req.headers['x-token'] as string | undefined
    req.viewer = resolveViewerForToken(req.session!, token)
    next()
  }

  return { loadSession, requireAdmin, requirePlayer, resolveViewer }
}
