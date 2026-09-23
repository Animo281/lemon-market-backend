import { Player } from './types'

export type Viewer =
  | { kind: 'admin' }
  | { kind: 'player'; player: Player }
  | { kind: 'anonymous' }
