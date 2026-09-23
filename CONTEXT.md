# Market for Lemons — Vollständiger Kontext

## Was ist das?
Digitale Version des Holt & Sherman (1999) Klassenexperiments.
Simuliert Akerlofs "Market for Lemons" — Marktversagen durch asymmetrische Information.
Gedacht für Seminar-/Vorlesungseinsatz (Dozent steuert, Studierende spielen).

---

## Spiellogik

### Kosten & Werte — pro Session konfigurierbar

Jede Session speichert ihre eigene `economics: { buyerValues, sellerFirstCosts }`
(`shared/types.ts`), vom Dozenten bei `POST /session` gesetzt und in der Lobby über
`PATCH /session/:code/config` änderbar — genau wie `maxSellerUnits`/`totalRounds`. Ohne
Angabe gelten die Holt & Sherman (1999) Standardwerte (`DEFAULT_ECONOMICS` in
`shared/constants.ts`):

| Qualität | Käuferwert | Kosten 1. Einheit |
|----------|------------|-------------------|
| 1        | $4.00      | $1.40             |
| 2        | $8.80      | $4.60             |
| 3        | $13.60     | $11.00            |

Jede weitere Einheit kostet +$1.00 mehr — das ist eine feste Spielregel
(`UNIT_COST_STEP`), keine Session-Einstellung:
`sellerCost(sellerFirstCosts, grade, unitIndex) = sellerFirstCosts[grade] + unitIndex * 1.00`.

Beide Tabellen müssen streng über die Qualitäten steigen (Q1 < Q2 < Q3), sonst lehnt Zod
die Anfrage ab (`schemas/session.ts`).

**Private Information:** Käufer sehen in `economics` nur `buyerValues`, Verkäufer nur
`sellerFirstCosts`, nur der Admin sieht beides — die Response wird pro Betrachter
maskiert (`mappers/toPublic.ts`), genau wie im Paper vorgeschrieben ("do not reveal the
private information tables").

### Phasen

- Jede Runde startet mit `infoMode: 'full'` (Käufer sehen Preis + Qualität).
- Der Wechsel zu `'asymmetric'` (Käufer sehen nur Preis) passiert **ausschließlich**
  über den manuellen Admin-Button `POST /toggle-info-mode` — es gibt **keine**
  automatische Umschaltung nach einer festen Rundenzahl. Der Dozent entscheidet den
  Zeitpunkt selbst, üblicherweise am Rundenende-Bildschirm nach ein paar
  Voll-Info-Runden.

### Ablauf pro Runde

1. Verkäufer geben Qualität + Preis + Stückzahl (1…`maxSellerUnits`) ein (verdeckt)
2. Alle bestätigt → Board wird aufgedeckt (je nach `infoMode`)
3. Käufer kaufen **in der ausgelosten Reihenfolge, einer nach dem anderen** —
   `POST /buyer-decision` von jemand anderem als dem aktuellen Käufer
   (`currentPlayerId`) wird mit 400 abgelehnt
4. Rundenende → Gewinne berechnet, Ergebnistabelle aktualisiert

Es gibt keinen gesonderten Bestätigungsschritt für die zweite Einheit — der Verkäufer
legt `unitsOffered` (wie viele Einheiten zu diesem Preis/dieser Qualität feilgeboten
werden) bereits bei der Preis-/Qualitätsentscheidung fest. Ein Kauf verbraucht
automatisch die nächste noch verfügbare Einheit.

### Gewinn
- Verkäufer: `Preis − sellerCost(sellerFirstCosts, Qualität, Einheitenindex)`, summiert
  über alle verkauften Einheiten (erste Einheit günstiger als zweite)
- Käufer: `buyerValues[Qualität] − Preis` (0 wenn kein Kauf)
- `theoreticalMaxSurplus` sucht die beste Qualität selbst (kapazitäts- und
  grenzkostenbewusst), statt Qualität 2 anzunehmen — siehe `services/gameAnalytics.ts`
- Bei den Holt-Standardwerten (3 Verkäufer / 4 Käufer / 2 Einheiten) ist das weiterhin
  Qualität 2, wie im Paper

### Sichtbarkeit während asymmetrischer Information

Solange `infoMode === 'asymmetric'` und die Runde noch offen ist (`phase === 'market'`):
- Verkäufer-Qualität ist für alle außer Admin und dem Verkäufer selbst maskiert
  (bereits vor der aktuellen Änderung so)
- **Käufer-Qualität und -Gewinn sind ebenfalls maskiert — auch für den Käufer, der
  gerade selbst gekauft hat.** Aus `Gewinn = Käuferwert − Preis` ließe sich die
  Qualität sonst sofort zurückrechnen. Erst am Rundenende (`results[]`) wird beides
  aufgedeckt — das entspricht der Tafel im Paper, die erst nach Rundenschluss
  geschrieben wird.
- `currentRoundMetrics` ist für Nicht-Admins in dieser Phase `null`, aus demselben Grund
  (die Kennzahlen sind selbst aus Käufer-Gewinnen abgeleitet).

---

## Shared Types (`/shared/types.ts`)

```ts
export type Grade = 1 | 2 | 3
export type GamePhase = 'lobby' | 'seller-input' | 'market' | 'round-end' | 'game-end'
export type InfoMode = 'full' | 'asymmetric'

export interface EconomicsConfig {
  buyerValues: Record<Grade, number>
  sellerFirstCosts: Record<Grade, number>
}

export interface Seller {
  id: string
  name: string
}

export interface Buyer {
  id: string
  name: string
}

export interface SellerDecision {
  playerId: string
  grade: Grade
  price: number
  unitsOffered: number
  unitsSold: number
  earnings: number
}

export interface BuyerDecision {
  playerId: string
  sellerId: string | null   // null = kein Kauf
  grade: Grade | null
  price: number | null
  earnings: number
}

export interface RoundResult {
  round: number
  infoMode: InfoMode
  sellerDecisions: SellerDecision[]
  buyerDecisions: BuyerDecision[]
  totalSurplus: number
  metrics: RoundMetrics
}

export interface Session {
  id: string
  code: string
  adminToken: string
  numSellers: number
  numBuyers: number
  maxSellerUnits: number
  totalRounds: number
  economics: EconomicsConfig
  phase: GamePhase
  currentRound: number
  infoMode: InfoMode
  players: Player[]
  buyerQueue: string[]       // gemischte IDs für aktuelle Runde
  currentBuyerIndex: number
  currentSellerDecisions: Record<string, Partial<SellerDecision>>
  currentBuyerDecisions: Record<string, BuyerDecision>
  results: RoundResult[]
}
```

---

## Backend API-Routen (`/backend/src/routes/session.ts`)

| Method | Route | Body | Beschreibung |
|--------|-------|------|--------------|
| POST | `/api/session` | `{ numSellers, numBuyers, maxSellerUnits?, totalRounds?, economics? }` | Neue Session anlegen → `{ code, adminToken, sessionId }` |
| GET | `/api/session/:code` | — | Aktuellen (viewer-maskierten) Session-State holen |
| POST | `/api/session/:code/join` | `{ name, role, slotIndex }` | Als Verkäufer/Käufer beitreten |
| POST | `/api/session/:code/start` | — | Spiel starten (Admin) |
| PATCH | `/api/session/:code/config` | `{ maxSellerUnits?, totalRounds?, economics? }` | Einstellungen ändern, nur in `lobby` (Admin) |
| POST | `/api/session/:code/seller-decision` | `{ grade, price, unitsOffered? }` | Verkäufer gibt Entscheidung ab |
| POST | `/api/session/:code/buyer-decision` | `{ sellerId }` | Käufer kauft (oder nicht: `sellerId: null`) — nur wenn dieser Käufer an der Reihe ist |
| POST | `/api/session/:code/toggle-info-mode` | — | Info-Modus umschalten (Admin, jede Phase) |
| POST | `/api/session/:code/next-round` | — | Nächste Runde starten (Admin) |
| POST | `/api/session/:code/skip-buyer` | — | Aktuellen Käufer überspringen (Admin) |
| POST | `/api/session/:code/force-advance` | — | Fehlende Verkäuferentscheidungen mit Platzhalter füllen (Admin) |
| DELETE | `/api/session/:code/players/:playerId` | — | Spieler entfernen (Admin) |

State wird in-memory gehalten (`Map<string, Session>`), im Cloudflare-Deployment pro
Session in einer eigenen Durable Object (`src/worker.ts`).

---

## Frontend Views (`lemon-market-frontend/src/views`)

1. **LandingView** — Session anlegen: Verkäufer-/Käuferzahl, optional Preise & weitere
   Parameter, Session starten
2. **JoinView** — Session-Code eingeben, Platz als Verkäufer/Käufer wählen
3. **AdminView** — Steuerpult: Rundenfortschritt, Info-Modus umschalten, Spieler
   verwalten, Ergebnisse
4. **PlayerView** — forkt nach Rolle in `SellerView`/`BuyerView`, beide rendern die
   „Abendmarkt"-Szene

---

## Konstanten (`/backend/src/shared/constants.ts` + `/frontend/src/shared/constants.ts`)

```ts
export const DEFAULT_BUYER_VALUES: Record<Grade, number> = { 1: 4.0, 2: 8.8, 3: 13.6 }
export const DEFAULT_SELLER_FIRST_COSTS: Record<Grade, number> = { 1: 1.4, 2: 4.6, 3: 11.0 }
export const DEFAULT_ECONOMICS: EconomicsConfig = {
  buyerValues: DEFAULT_BUYER_VALUES,
  sellerFirstCosts: DEFAULT_SELLER_FIRST_COSTS,
}
export const UNIT_COST_STEP = 1.00

export const DEFAULT_TOTAL_ROUNDS = 5
export const DEFAULT_MAX_SELLER_UNITS = 2
export const MAX_SELLER_UNITS_LIMIT = 5
export const MAX_ROUNDS_LIMIT = 20
export const MAX_SELLERS_LIMIT = 10
export const MAX_BUYERS_LIMIT = 20
```

Es gibt **keine** `FULL_INFO_ROUNDS`- oder `MAX_BUYER_UNITS`-Konstante — der Phasenwechsel
ist rein admin-gesteuert (siehe oben), und "Käufer kauft maximal 1 Einheit pro Runde" ist
strukturell durch die Datenmodellierung erzwungen (`BuyerDecision` hat kein
Mengenfeld), nicht über eine eigene Konstante.
