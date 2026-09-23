# Lemon Market — Backend

Express/TypeScript API for the "Market for Lemons" classroom experiment. Simulates an information-asymmetry market: sellers grade their goods (1–3), buyers can only sometimes see the grade, and the round settles into supply/demand curves, an equilibrium, and an efficiency score.

## Setup

```bash
npm install
npm run dev      # development with hot reload → http://localhost:3001
npm run build    # compile to dist/
npm start        # production (requires build)
npm test         # run test suite
npm run test:worker      # Workers runtime + Durable Object integration tests
npm run deploy:dry-run   # validate the Cloudflare bundle without deploying
```

Environment variable: `PORT` (default 3001).

## API Docs

Swagger UI: **http://localhost:3001/api/docs**

The spec lives in `src/docs/openapi.ts` as a plain object — no `swagger-jsdoc` annotation scanning, it's handed straight to `swagger-ui-express`.

Available schemas in Swagger: `PublicSession`, `PublicPlayer`, `RoundResult`, `RoundMetrics`, `AvailableOffer`, `Error`.

The Cloudflare Worker serves a lightweight documentation page at `/api/docs` and the
same OpenAPI document at `/api/openapi.json`.

## Cloudflare deployment

`wrangler.jsonc` defines one Worker (`lemon-market-game`) with React static assets and
one SQLite-backed `SessionDurableObject` per four-character session code. Only `/api/*`
runs Worker code first; client-side routes use the Static Assets SPA fallback.

```bash
npm run build:frontend
npm run build
npm run typecheck:worker
npm run test:all
npm run deploy:dry-run
npm run deploy
```

No production secrets are required. Wrangler keeps Cloudflare credentials in its local
credential store; admin and player tokens are generated at runtime and stored only in
the session Durable Object.

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
└── shared/           Types + constants (DEFAULT_BUYER_VALUES, DEFAULT_SELLER_FIRST_COSTS, UNIT_COST_STEP, limits)
```

## Economics / Game Model

The market has 3 quality grades. Buyer willingness-to-pay and seller cost both scale with
grade, but — unlike earlier versions of this app — they are **not** hardcoded constants:
each session stores its own `economics: { buyerValues, sellerFirstCosts }`
(`src/shared/types.ts`), set at `POST /session` and editable via `PATCH /config` while
still in `lobby`, same as `maxSellerUnits`/`totalRounds`. Omitting `economics` on create
falls back to the Holt & Sherman (1999) paper's own numbers
(`DEFAULT_ECONOMICS` in `src/shared/constants.ts`):

| Grade | Buyer WTP (`buyerValues`) | Seller marginal cost, 1st unit (`sellerFirstCosts`) |
|-------|-----------------------------|----------------------------------------------------------------|
| 1     | 4.0                          | 1.4                                                             |
| 2     | 8.8                          | 4.6                                                             |
| 3     | 13.6                         | 11.0                                                            |

Both tables are Zod-validated (`src/schemas/session.ts`) to be strictly increasing over
grades 1→2→3 — a host can shift the numbers, but not invert which grade is "best".

Each additional unit a seller offers costs +1.00 more, regardless of the session's
economics — this is a fixed game rule, not a per-session parameter:
`sellerCost(sellerFirstCosts, grade, unitIndex) = sellerFirstCosts[grade] + unitIndex * UNIT_COST_STEP` (0-based index, `UNIT_COST_STEP = 1.00`).

- **Buyer earnings** on a purchase: `economics.buyerValues[grade] - price`, rounded to 2 decimals. A pass (`sellerId: null`) earns 0.
- **Seller earnings**: sum of `price - sellerCost(economics.sellerFirstCosts, grade, i)` over each unit actually sold.
- **`theoreticalMaxSurplus`**: searches all three grades and picks the best one — `Σ max(0, buyerValues[g] - sellerCost(sellerFirstCosts, g, ⌊i/numSellers⌋))` over `i = 0..min(numBuyers, numSellers*maxSellerUnits)-1`, capped at each unit's real marginal cost (a seller's 2nd/3rd unit is priced higher than their 1st). With host-configurable economics, grade 2 is no longer guaranteed to be optimal, so this can't just assume it the way the original Holt & Sherman classroom setup could.

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
- **adds** `currentPlayerId` (whose turn it is in `market`, else `null`), `availableOffers`, `economics` (the session's own `buyerValues`/`sellerFirstCosts`, viewer-masked — see below), `limits`, and `currentRoundMetrics`

## Routes

| Method   | Path                              | Auth    | Description                                      |
|----------|-----------------------------------|---------|--------------------------------------------------|
| `POST`   | `/api/session`                    | public  | Create session (`numSellers`, `numBuyers`, `maxSellerUnits`, `totalRounds`, optional `economics`) → `{ code, adminToken, sessionId }` |
| `GET`    | `/api/session/:code`              | public  | Get current session state                        |
| `POST`   | `/api/session/:code/join`         | public  | Join as seller/buyer → `{ playerToken, playerId }` |
| `POST`   | `/api/session/:code/start`        | admin   | Start game (lobby → seller-input)                |
| `PATCH`  | `/api/session/:code/config`       | admin   | Update config while in lobby (`maxSellerUnits`, `totalRounds`, `economics`) |
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
  POST /toggle-info-mode  — switch full ↔ asymmetric, works at any point. There is no
                            automatic switch after N rounds — every round starts back at
                            'full' (`startGame`/`createSession` both default to it), and
                            the host decides when to flip it, typically at a round-end
                            screen. This is a deliberate product choice, not a gap: it
                            lets the same lecturer demo the effect at a moment of their
                            choosing instead of a fixed round count.
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
| `economics`       | `DEFAULT_ECONOMICS` (Holt & Sherman values) | both tables > 0 and strictly increasing over grades 1→2→3 |

Hard limits are enforced in the Zod schemas (`src/schemas/session.ts`) and echoed back to clients as `limits` on every session response. `numSellers`/`numBuyers` are capped so a bogus value (`numBuyers: 1e9`) can't reach the `Array(n)` allocation in the demand-curve calculation and crash or exhaust memory — it's rejected as a normal 400 instead. A seller's `unitsOffered` is additionally clamped server-side to `[1, maxSellerUnits]` regardless of what's submitted. Config (`PATCH /config`) only works while the session is in `lobby`.

## Error Format

All error messages are German (the product's UI language) and are safe to show to the end user as-is.

- **Domain errors** (`HttpError`, thrown by services): `{ "error": "<message>" }` with the matching status — 400 (bad input/wrong phase), 403 (auth), 404 (not found), or 409 (conflict, e.g. slot taken). Example: `{ "error": "Bei diesem Stand ist alles verkauft." }`.
- **Validation errors** (Zod, via the `validate` middleware): always 400, `{ "error": "Eingabe ungültig — bitte Werte prüfen.", "issues": [...] }` with the raw Zod issue list.
- **Malformed JSON / oversized body**: 400 `{ "error": "Ungültige Anfrage — Anfrage-Format prüfen." }` — `express.json()`'s `SyntaxError`/`PayloadTooLargeError` are recognized in `errorHandler` instead of falling through to a generic 500.
- **Unknown route or method**: 404 `{ "error": "Nicht gefunden." }` (`notFoundHandler`, mounted after the router) — kept in the same JSON shape as every other error instead of Express's default HTML page.
- **Unexpected errors**: 500 `{ "error": "Interner Serverfehler." }`; the original error is logged server-side, never leaked to the client.

## Viewer-aware responses (hidden grade in asymmetric mode)

`GET /:code` and every mutating route run a non-throwing `resolveViewer` middleware (`src/middleware/sessionMiddleware.ts`) that inspects `x-token` and classifies the caller as `admin`, a specific `player`, or `anonymous` — without requiring the header. `toPublic()` (`src/mappers/toPublic.ts`) uses that to decide what several fields show:

- **`currentSellerDecisions[].grade`** — the raw grade only reaches the admin and the
  seller who set it. Everyone else sees it masked to `undefined` whenever
  `infoMode === 'asymmetric'` — matching the masking `computeAvailableOffers` already did
  for `availableOffers`, but applied to the full session payload too.
- **`currentBuyerDecisions[].grade`/`.earnings`** — masked to `null`/`0` for everyone
  except the admin while the market is still open in `asymmetric` mode (`infoMode ===
  'asymmetric' && phase === 'market'`) — **including for the buyer who made that exact
  purchase**. `earnings = buyerValues[grade] - price` arithmetically reveals the grade
  even with `grade` itself hidden, so both fields are stripped together. This mirrors the
  paper's procedure: buyers don't learn what they bought until the round ends and the
  instructor writes the grades on the board. `session.results[]` (past rounds) is never
  masked — that's the reveal moment, matching Table 1 in the paper.
- **`currentRoundMetrics`** — `null` for non-admins under the same hidden-market
  condition, since `totalBuyerProfit` and `demandCurve` are themselves derived from
  buyer earnings and would leak the same information a different way.
- **`economics`** — split by role, mirroring the paper's own instructions ("do not
  reveal the private information tables of sellers' costs and buyers' values"): a buyer
  only ever gets `buyerValues`, a seller only `sellerFirstCosts`, admin gets both,
  anonymous gets neither.

Clients that want their own grade/earnings reflected back (a seller viewing their own board, a buyer after round-end) must send their `x-token` on `GET /:code`, not just on mutating calls.

## Buyer shopping order

Buyers are drawn into a shuffled `buyerQueue` at the start of each round and must act in
that order — `POST /buyer-decision` from anyone other than `getCurrentPlayerId(session)`
is rejected with 400 ("Du bist noch nicht an der Reihe."). This matches the paper's
procedure (buyers drawn by lot, shopping one at a time so later buyers see which stands
already sold out) and closes what used to be a free-for-all: any buyer could act at any
moment during `market`. `POST /skip-buyer` (admin) remains the way to unblock a round
when the current buyer has disconnected.

## Persistence

`createMemoryRepository()` (`src/repositories/sessionRepository.ts`) is a plain in-memory `Map` — no database, no TTL, no cleanup job. Restarting the process discards every session, and it does not support running more than one backend instance behind a load balancer.

Session codes are 4 characters drawn uniformly from `A-Z0-9`, generated with up to 20 collision-retry attempts before failing with a 500. Code lookup is case-insensitive (`getByCode` uppercases before matching).

## Known Limitations

- No reconnect mechanism — clients are responsible for persisting their own `playerToken`/`adminToken` across page reloads.
- `theoreticalMaxSurplus` and the demand curve use the session's *configured* `numBuyers`, not the number who actually joined — a session that starts under-filled reports a lower efficiency than it should.
- No rate limiting, no `helmet`, fully open CORS — acceptable for a single-instance classroom tool, not for a public deployment.
- Toggling info mode while still in `lobby` has no effect: `startGame` always resets `infoMode` to `'full'`. The toggle isn't blocked in the lobby, so it can look like it did something when it didn't.
- Buyer shopping order is now enforced server-side (see "Buyer shopping order" above), but
  it's still 2-second polling underneath, not a push channel — a buyer whose turn just
  started can wait up to ~2s to see the "Du bist dran" state flip.

## Tests

```bash
npm test            # vitest run (all files in tests/)
npm run test:watch  # watch mode
```

94 tests across 4 files, plus 7 more via `npm run test:worker` (Durable Object integration):
- `gameAnalytics.test.ts` (26) — equilibrium, WTP, `theoreticalMaxSurplus` (capacity- and grade-search-aware), round metrics
- `sessionService.test.ts` (24) — state-machine transition tests, incl. buyer-turn-order enforcement
- `routes.session.test.ts` (30) — integration tests via supertest, incl. the prototype-pollution guard, asymmetric-mode grade masking (both seller- and buyer-side), per-role economics masking, host-configurable economics, and the JSON 404
- `gameLogic.test.ts` (14) — shuffle, earnings, round computation unit tests
