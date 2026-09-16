# Lemon Market — Backend

Express/TypeScript API for the "Market for Lemons" classroom experiment. Simulates an information-asymmetry market: sellers grade their goods (1–3), buyers can only sometimes see the grade, and the round settles into supply/demand curves, an equilibrium, and an efficiency score.

## Setup

```bash
npm install
npm run dev      # development with hot reload → http://localhost:3001
npm run build    # compile to dist/
npm start        # production (requires build)
npm test         # run test suite
```

Environment variable: `PORT` (default 3001).

## API Docs

Swagger UI: **http://localhost:3001/api/docs**

The spec lives in `src/docs/openapi.ts` as a plain object — no `swagger-jsdoc` annotation scanning, it's handed straight to `swagger-ui-express`.

Available schemas in Swagger: `PublicSession`, `PublicPlayer`, `RoundResult`, `RoundMetrics`, `AvailableOffer`, `Error`.

## Architecture

```
src/
├── routes/           HTTP wiring only (middleware chain + controller call)
├── controllers/      Request → Service → Response mapping
├── services/
│   ├── sessionService    Business logic & state machine transitions
│   └── gameAnalytics     Supply/demand curves, equilibrium, WTP, surplus
├── repositories/     Data access (in-memory Map, injectable)
├── middleware/       loadSession, requireAdmin, requirePlayer, validate, errorHandler
├── schemas/          Zod schemas for request body validation
├── mappers/          toPublic — strips adminToken + player.token before sending
├── lib/              Pure functions: gameLogic (shuffle, earnings, round computation)
├── docs/             openapi.ts — hand-written OpenAPI 3.0 spec for Swagger UI
└── shared/           Types + constants (BUYER_VALUES, SELLER_COSTS, limits)
```

## Economics / Game Model

The market has 3 quality grades. Buyer willingness-to-pay and seller cost both scale with grade (`src/shared/constants.ts`):

| Grade | Buyer WTP (`BUYER_VALUES`) | Seller marginal cost, 1st unit (`SELLER_COSTS[grade].first`) |
|-------|-----------------------------|----------------------------------------------------------------|
| 1     | 4.0                          | 1.4                                                             |
| 2     | 8.8                          | 4.6                                                             |
| 3     | 13.6                         | 11.0                                                            |

Each additional unit a seller offers costs +1.00 more: `sellerCost(grade, unitIndex) = SELLER_COSTS[grade].first + unitIndex * 1.00` (0-based index).

- **Buyer earnings** on a purchase: `BUYER_VALUES[grade] - price`, rounded to 2 decimals. A pass (`sellerId: null`) earns 0.
- **Seller earnings**: sum of `price - sellerCost(grade, i)` over each unit actually sold.
- **`theoreticalMaxSurplus`**: `numBuyers * (BUYER_VALUES[2] - sellerCost(2, 0))` = `numBuyers * 4.2` — the surplus if every buyer got a grade-2 lemon at the seller's marginal cost of the first unit.

### `infoMode` — what it actually changes

- **`full`**: seller grade is visible in `availableOffers`; the demand curve uses `bestGradeWTP` — the WTP of the *highest* grade currently on offer.
- **`asymmetric`**: grade is masked to `null` in `availableOffers`; the demand curve uses `calcAsymmetricWTP` — the *average* WTP across all offered grades (the classic "lemons" adverse-selection setup).
- With no offers at all, both modes fall back to `BUYER_VALUES[2]` = 8.8.

Toggled via `POST /session/:code/toggle-info-mode` — works in **any** phase, not just between rounds.

### `RoundMetrics` fields

Computed live during `market`/`round-end` (`currentRoundMetrics`) and stored per finished round (`results[].metrics`):

- `supplyCurve` — one entry per unit offered, at that seller's ask price, sorted ascending.
- `demandCurve` — `numBuyers` entries, each the current WTP (see `infoMode` above).
- `equilibrium` — walks both sorted curves for the last index where `demand[i] >= supply[i]`; price is the midpoint of `supply[i]`/`demand[i]` at that index. `null` if no match.
- `efficiency` — `totalSurplus / theoreticalMaxSurplus`, or `0` if the max is `0`.
- `avgTransactionPrice` — average ask price across sold units, `null` if nothing sold yet.
- `transactions` — count of sold units.

`currentRoundMetrics` on the session is `null` outside `market`/`round-end` (e.g. `lobby`, `seller-input`).

## Response shape — `GET /session/:code`

`toPublic()` (`src/mappers/toPublic.ts`) takes the internal `Session` and:

- **removes** `adminToken` and every player's `token` (never sent to clients)
- **adds** `currentPlayerId` (whose turn it is in `market`, else `null`), `availableOffers`, `economics` (the `BUYER_VALUES`/`SELLER_COSTS` tables, so clients don't hardcode them), `limits`, and `currentRoundMetrics`

## Routes

| Method   | Path                              | Auth    | Description                                      |
|----------|-----------------------------------|---------|--------------------------------------------------|
| `POST`   | `/api/session`                    | public  | Create session → `{ code, adminToken, sessionId }` |
| `GET`    | `/api/session/:code`              | public  | Get current session state                        |
| `POST`   | `/api/session/:code/join`         | public  | Join as seller/buyer → `{ playerToken, playerId }` |
| `POST`   | `/api/session/:code/start`        | admin   | Start game (lobby → seller-input)                |
| `PATCH`  | `/api/session/:code/config`       | admin   | Update config while in lobby                     |
| `POST`   | `/api/session/:code/seller-decision` | player (seller) | Submit grade + price + units          |
| `POST`   | `/api/session/:code/buyer-decision`  | player (buyer)  | Buy from seller (or pass with `null`) |
| `POST`   | `/api/session/:code/toggle-info-mode` | admin  | Switch info mode (full ↔ asymmetric), any phase |
| `POST`   | `/api/session/:code/next-round`   | admin   | Advance to next round or end game                |
| `POST`   | `/api/session/:code/skip-buyer`   | admin   | Skip current buyer's turn (market phase)         |
| `POST`   | `/api/session/:code/force-advance`| admin   | Force-submit defaults for idle sellers → market  |
| `DELETE` | `/api/session/:code/players/:id`  | admin   | Kick player from session, any phase              |

## Game Phase Transitions

```
lobby
  ├─ PATCH /config (admin, any time in lobby)
  └─ POST /start (admin)
       └─ seller-input
            ├─ POST /force-advance (admin — submits defaults for missing sellers)
            └─ [all sellers submit]
                 └─ market
                      ├─ POST /skip-buyer (admin — skips current buyer)
                      └─ [all buyers submit]
                           └─ round-end
                                └─ POST /next-round (admin)
                                     ├─ seller-input  (rounds remaining)
                                     └─ game-end      (no rounds remaining)

Admin-only overrides, unrestricted by phase:
  POST /toggle-info-mode  — switch full ↔ asymmetric, works at any point
  DELETE /players/:id     — kick a player, works at any point including game-end
```

## Auth

- **Admin routes** require `x-token: <adminToken>` (returned from `POST /session`).
- **Player routes** require `x-token: <playerToken>` (returned from `POST /session/:code/join`).
- `playerToken` ≠ `playerId` — the public `playerId` cannot be used as auth.

## Configuration & Limits

| Setting          | Default | Hard limit (`shared/constants.ts`)   |
|-------------------|---------|----------------------------------------|
| `numSellers`      | 3       | `MAX_SELLERS_LIMIT` = 10               |
| `numBuyers`       | 4       | `MAX_BUYERS_LIMIT` = 20                |
| `maxSellerUnits`  | 2       | `MAX_SELLER_UNITS_LIMIT` = 5            |
| `totalRounds`     | 5       | `MAX_ROUNDS_LIMIT` = 20                 |

Hard limits are enforced in the Zod schemas (`src/schemas/session.ts`) and echoed back to clients as `limits` on every session response. `numSellers`/`numBuyers` are capped so a bogus value (`numBuyers: 1e9`) can't reach the `Array(n)` allocation in the demand-curve calculation and crash or exhaust memory — it's rejected as a normal 400 instead. A seller's `unitsOffered` is additionally clamped server-side to `[1, maxSellerUnits]` regardless of what's submitted. Config (`PATCH /config`) only works while the session is in `lobby`.

## Error Format

All error messages are German (the product's UI language) and are safe to show to the end user as-is.

- **Domain errors** (`HttpError`, thrown by services): `{ "error": "<message>" }` with the matching status — 400 (bad input/wrong phase), 403 (auth), 404 (not found), or 409 (conflict, e.g. slot taken). Example: `{ "error": "Bei diesem Stand ist alles verkauft." }`.
- **Validation errors** (Zod, via the `validate` middleware): always 400, `{ "error": "Eingabe ungültig — bitte Werte prüfen.", "issues": [...] }` with the raw Zod issue list.
- **Malformed JSON / oversized body**: 400 `{ "error": "Ungültige Anfrage — Anfrage-Format prüfen." }` — `express.json()`'s `SyntaxError`/`PayloadTooLargeError` are recognized in `errorHandler` instead of falling through to a generic 500.
- **Unknown route or method**: 404 `{ "error": "Nicht gefunden." }` (`notFoundHandler`, mounted after the router) — kept in the same JSON shape as every other error instead of Express's default HTML page.
- **Unexpected errors**: 500 `{ "error": "Interner Serverfehler." }`; the original error is logged server-side, never leaked to the client.

## Viewer-aware responses (hidden grade in asymmetric mode)

`GET /:code` and every mutating route run a non-throwing `resolveViewer` middleware (`src/middleware/sessionMiddleware.ts`) that inspects `x-token` and classifies the caller as `admin`, a specific `player`, or `anonymous` — without requiring the header. `toPublic()` (`src/mappers/toPublic.ts`) uses that to decide what `currentSellerDecisions[].grade` shows: the raw grade only reaches the admin and the seller who set it. Everyone else sees it masked to `undefined` whenever `infoMode === 'asymmetric'` — matching the masking `computeAvailableOffers` already did for `availableOffers`, but now applied to the full session payload too. Clients that want their own grade reflected back (a seller viewing their own board) must send their `x-token` on `GET /:code`, not just on mutating calls.

## Persistence

`createMemoryRepository()` (`src/repositories/sessionRepository.ts`) is a plain in-memory `Map` — no database, no TTL, no cleanup job. Restarting the process discards every session, and it does not support running more than one backend instance behind a load balancer.

Session codes are 4 characters drawn uniformly from `A-Z0-9`, generated with up to 20 collision-retry attempts before failing with a 500. Code lookup is case-insensitive (`getByCode` uppercases before matching).

## Known Limitations

- No reconnect mechanism — clients are responsible for persisting their own `playerToken`/`adminToken` across page reloads.
- Buyer turn order (`buyerQueue`/`currentPlayerId`) is computed and exposed, but not enforced — any buyer can act at any time during `market`, not just the one whose turn it visually is. Enforcing it would need either accepting jerkier UX over 2s polling or a push channel; left as a deliberate simplification for now.
- `theoreticalMaxSurplus` and the demand curve use the session's *configured* `numBuyers`, not the number who actually joined — a session that starts under-filled reports a lower efficiency than it should.
- No rate limiting, no `helmet`, fully open CORS — acceptable for a single-instance classroom tool, not for a public deployment.
- Toggling info mode while still in `lobby` has no effect: `startGame` always resets `infoMode` to `'full'` (rounds 1–3 are always full-info by design). The toggle isn't blocked in the lobby, so it can look like it did something when it didn't.

## Tests

```bash
npm test            # vitest run (all files in tests/)
npm run test:watch  # watch mode
```

86 tests across 4 files:
- `gameAnalytics.test.ts` (24) — equilibrium, WTP, `theoreticalMaxSurplus`, round metrics
- `sessionService.test.ts` (19) — state-machine transition tests
- `routes.session.test.ts` (34) — integration tests via supertest, incl. the prototype-pollution guard, asymmetric-mode grade masking, oversized/malformed input, and the JSON 404
- `gameLogic.test.ts` (9) — shuffle, earnings, round computation unit tests
