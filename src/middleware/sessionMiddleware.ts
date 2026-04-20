import { Request, Response, NextFunction } from 'express'
import { SessionRepository } from '../repositories/sessionRepository'
import { HttpError } from './errorHandler'
import { Session, Role, Player } from '../shared/types'

declare global {
  namespace Express {
    interface Request {
      session?: Session
      player?: Player
    }
  }
}

export function createSessionMiddleware(repo: SessionRepository) {
  function loadSession(req: Request, _res: Response, next: NextFunction): void {
    const session = repo.getByCode(req.params.code)
    if (!session) throw new HttpError(404, 'Session not found')
    req.session = session
    next()
  }

  function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
    const token = req.headers['x-token'] as string | undefined
    if (!token || token !== req.session!.adminToken) throw new HttpError(403, 'Forbidden')
    next()
  }

  function requirePlayer(role?: Role) {
    return (req: Request, _res: Response, next: NextFunction): void => {
      const token = req.headers['x-token'] as string | undefined
      const player = token ? req.session!.players.find(p => p.token === token) : undefined
      if (!player) throw new HttpError(403, 'Forbidden')
      if (role && player.role !== role) throw new HttpError(403, 'Forbidden')
      req.player = player
      next()
    }
  }

  return { loadSession, requireAdmin, requirePlayer }
}
