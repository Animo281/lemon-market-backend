import { Session } from '../shared/types'

export interface SessionRepository {
  getById(id: string): Session | undefined
  getByCode(code: string): Session | undefined
  save(session: Session): void
}

export function createMemoryRepository(): SessionRepository {
  const sessions = new Map<string, Session>()
  const codeToId = new Map<string, string>()

  return {
    getById: (id) => sessions.get(id),
    getByCode: (code) => {
      const id = codeToId.get(code.toUpperCase())
      return id ? sessions.get(id) : undefined
    },
    save: (session) => {
      sessions.set(session.id, session)
      codeToId.set(session.code, session.id)
    },
  }
}
