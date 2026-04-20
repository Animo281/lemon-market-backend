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
  const { loadSession, requireAdmin, requirePlayer } = createSessionMiddleware(repo)

  router.post('/', validate(createSessionSchema), ctrl.create)
  router.get('/:code', loadSession, ctrl.getState)
  router.post('/:code/join', loadSession, validate(joinSessionSchema), ctrl.join)
  router.post('/:code/start', loadSession, requireAdmin, ctrl.start)
  router.patch('/:code/config', loadSession, requireAdmin, validate(configSessionSchema), ctrl.config)
  router.post('/:code/seller-decision', loadSession, requirePlayer('seller'), validate(sellerDecisionSchema), ctrl.sellerDecision)
  router.post('/:code/buyer-decision', loadSession, requirePlayer('buyer'), validate(buyerDecisionSchema), ctrl.buyerDecision)
  router.post('/:code/toggle-info-mode', loadSession, requireAdmin, ctrl.toggleInfoMode)
  router.post('/:code/next-round', loadSession, requireAdmin, ctrl.nextRound)

  return router
}
