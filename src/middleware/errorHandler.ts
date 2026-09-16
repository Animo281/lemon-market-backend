import { Request, Response, NextFunction } from 'express'

// Keeps the "errors are always JSON" contract for unknown routes/methods —
// without this, Express's default finalhandler answers with an HTML page.
// Mount after all real routes, before errorHandler.
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Nicht gefunden.' })
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  // express.json() throws a SyntaxError (status 400) on malformed JSON, and
  // the body-parser throws a PayloadTooLargeError (status 413) on oversized
  // bodies — both carry a client-fault status but aren't HttpError instances.
  // Without this, either one falls through to the generic 500 below.
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: unknown }).status
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ error: 'Ungültige Anfrage — Anfrage-Format prüfen.' })
      return
    }
  }
  console.error(err)
  res.status(500).json({ error: 'Interner Serverfehler.' })
}
