# Lemon Market — Backend

Express/TypeScript API for the "Market for Lemons" classroom experiment.

## Setup

```bash
npm install
npm run dev      # development with hot reload → http://localhost:3001
npm run build    # compile to dist/
npm test         # run test suite
```

Environment variable: `PORT` (default 3001).

## API Docs

Swagger UI: **http://localhost:3001/api/docs**

## Architecture

```
src/
├── routes/           HTTP wiring only (middleware chain + controller call)
├── controllers/      Request → Service → Response mapping
├── services/         Business logic & state machine transitions
├── repositories/     Data access (in-memory Map, injectable)
├── middleware/       loadSession, requireAdmin, requirePlayer, validate, errorHandler
├── schemas/          Zod schemas for request body validation
├── mappers/          toPublic — strips adminToken + player.token before sending
├── lib/              Pure functions: gameLogic (shuffle, earnings, round computation)
└── shared/           Types + constants
```

## Game Phase Transitions

```
lobby
  └─ POST /start (admin)
       └─ seller-input
            └─ [all sellers submit]
                 └─ market
                      └─ [all buyers submit]
                           └─ round-end
                                ├─ POST /next-round (admin)
                                │    ├─ seller-input  (rounds remaining)
                                │    └─ game-end      (no rounds remaining)
                                └─ POST /toggle-info-mode (admin, optional)
```

## Auth

- **Admin routes** require `x-token: <adminToken>` (returned from `POST /session`).
- **Player routes** require `x-token: <playerToken>` (returned from `POST /session/:code/join`).
- `playerToken` ≠ `playerId` — the public `playerId` cannot be used as auth.

## Tests

```bash
npm test            # vitest run (all files in tests/)
npm run test:watch  # watch mode
```

Test coverage: `gameLogic` unit tests, `sessionService` state-machine tests, `routes` integration tests via supertest.
