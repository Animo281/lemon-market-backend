import { Router } from 'express'
import { SessionRepository } from '../repositories/sessionRepository'
import { createSessionController } from '../controllers/sessionController'
import { createSessionMiddleware } from '../middleware/sessionMiddleware'
import { validate } from '../middleware/validate'
import {
  createSessionSchema,
  joinSessionSchema,
  configSessionSchema,
  sellerDecisionSchema,
  buyerDecisionSchema,
} from '../schemas/session'

export function createSessionRouter(repo: SessionRepository): Router {
  const router = Router()
  const ctrl = createSessionController(repo)
  const { loadSession, requireAdmin, requirePlayer, resolveViewer } = createSessionMiddleware(repo)

  // resolveViewer runs on every session-scoped route (it never throws) so
  // every toPublic() response — not just GET — reflects who's actually
  // asking: a seller's own response still shows their own grade even while
  // it's masked from everyone else in asymmetric mode.
  router.post('/', validate(createSessionSchema), ctrl.create)
  router.get('/:code', loadSession, resolveViewer, ctrl.getState)
  router.post('/:code/join', loadSession, resolveViewer, validate(joinSessionSchema), ctrl.join)
  router.post('/:code/start', loadSession, requireAdmin, resolveViewer, ctrl.start)
  router.patch('/:code/config', loadSession, requireAdmin, resolveViewer, validate(configSessionSchema), ctrl.config)
  router.post('/:code/seller-decision', loadSession, requirePlayer('seller'), resolveViewer, validate(sellerDecisionSchema), ctrl.sellerDecision)
  router.post('/:code/buyer-decision', loadSession, requirePlayer('buyer'), resolveViewer, validate(buyerDecisionSchema), ctrl.buyerDecision)
  router.post('/:code/toggle-info-mode', loadSession, requireAdmin, resolveViewer, ctrl.toggleInfoMode)
  router.post('/:code/next-round', loadSession, requireAdmin, resolveViewer, ctrl.nextRound)
  router.delete('/:code/players/:playerId', loadSession, requireAdmin, resolveViewer, ctrl.kick)
  router.post('/:code/skip-buyer', loadSession, requireAdmin, resolveViewer, ctrl.skipBuyer)
  router.post('/:code/force-advance', loadSession, requireAdmin, resolveViewer, ctrl.forceAdvance)

  return router
}
