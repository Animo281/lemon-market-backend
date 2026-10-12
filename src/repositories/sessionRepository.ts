import { Session } from '../shared/types'

export interface SessionRepository {
  getByCode(code: string): Session | undefined
  save(session: Session): void
}

export function createMemoryRepository(initialSessions: Session[] = []): SessionRepository {
  const sessions = new Map<string, Session>()
  const codeToId = new Map<string, string>()

  for (const session of initialSessions) {
    sessions.set(session.id, session)
    codeToId.set(session.code.toUpperCase(), session.id)
  }

  return {
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
