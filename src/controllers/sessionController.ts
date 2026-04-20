import { Request, Response } from 'express'
import { SessionRepository } from '../repositories/sessionRepository'
import { toPublic } from '../mappers/toPublic'
import * as service from '../services/sessionService'

export function createSessionController(repo: SessionRepository) {
  return {
    create(req: Request, res: Response): void {
      const { numSellers, numBuyers, maxSellerUnits, totalRounds } = req.body
      const session = service.createSession(repo, numSellers, numBuyers, maxSellerUnits, totalRounds)
      res.json({ code: session.code, adminToken: session.adminToken, sessionId: session.id })
    },

    getState(req: Request, res: Response): void {
      res.json(toPublic(req.session!))
    },

    join(req: Request, res: Response): void {
      const { name, role, slotIndex } = req.body
      const { player, token } = service.joinSession(repo, req.session!, name, role, slotIndex)
      res.json({ playerToken: token, playerId: player.id, session: toPublic(req.session!) })
    },

    start(req: Request, res: Response): void {
      res.json(toPublic(service.startGame(repo, req.session!)))
    },

    config(req: Request, res: Response): void {
      const { maxSellerUnits, totalRounds } = req.body
      res.json(toPublic(service.updateConfig(repo, req.session!, maxSellerUnits, totalRounds)))
    },

    sellerDecision(req: Request, res: Response): void {
      const { grade, price, unitsOffered } = req.body
      res.json(toPublic(service.submitSellerDecision(repo, req.session!, req.player!.id, grade, price, unitsOffered)))
    },

    buyerDecision(req: Request, res: Response): void {
      const { sellerId } = req.body
      res.json(toPublic(service.submitBuyerDecision(repo, req.session!, req.player!.id, sellerId)))
    },

    toggleInfoMode(req: Request, res: Response): void {
      res.json(toPublic(service.toggleInfoMode(repo, req.session!)))
    },

    nextRound(req: Request, res: Response): void {
      res.json(toPublic(service.advanceToNextRound(repo, req.session!)))
    },
  }
}
