import { Session } from '../../../shared/types'

const sessions = new Map<string, Session>()
const codeToId = new Map<string, string>()

export const getSession = (id: string): Session | undefined => sessions.get(id)

export const getSessionByCode = (code: string): Session | undefined => {
  const id = codeToId.get(code.toUpperCase())
  return id ? sessions.get(id) : undefined
}

export const setSession = (session: Session): void => {
  sessions.set(session.id, session)
  codeToId.set(session.code, session.id)
}
