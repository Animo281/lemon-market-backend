# Market for Lemons — Vollständiger Kontext

## Was ist das?
Digitale Version des Holt & Sherman (1999) Klassenexperiments.
Simuliert Akerlofs "Market for Lemons" — Marktversagen durch asymmetrische Information.
Gedacht für Seminar-/Vorlesungseinsatz (Dozent steuert, Studierende spielen).

---

## Spiellogik

### Kosten & Werte
| Qualität | Käuferwert | Kosten 1. Einheit | Kosten 2. Einheit |
|----------|------------|-------------------|-------------------|
| 1        | $4.00      | $1.40             | $2.40             |
| 2        | $8.80      | $4.60             | $5.60             |
| 3        | $13.60     | $11.00            | $12.00            |

### Phasen
- Runden 1–3: **Volle Info** (Käufer sehen Preis + Qualität)
- Runden 4–5: **Asymm. Info** (Käufer sehen nur Preis)

### Ablauf pro Runde
1. Verkäufer geben Qualität + Preis ein (verdeckt)
2. Alle bestätigt → Board wird aufgedeckt (je nach Phase)
3. Käufer kaufen in Zufallsreihenfolge (1 Einheit max)
4. Verkäufer bestätigt 2. Einheit-Verkauf (optional, gleicher Preis)
5. Rundenende → Gewinne berechnen, Tabelle updaten

### Gewinn
- Verkäufer: `Preis - Kosten` (erste Einheit günstiger als zweite)
- Käufer: `Käuferwert - Preis` (0 wenn kein Kauf)
- Optimum: Qualität 2 maximiert Gesamtüberschuss

---

## Shared Types (`/shared/types.ts`)

```ts
export type Grade = 1 | 2 | 3
export type GamePhase = 'setup' | 'seller-input' | 'market' | 'round-end' | 'game-end'
export type InfoMode = 'full' | 'asymmetric'

export interface Seller {
  id: string
  name: string
}

export interface Buyer {
  id: string
  name: string
}

export interface SellerDecision {
  sellerId: string
  grade: Grade
  price: number
  unitsSold: number
  confirmed: boolean
}

export interface BuyerDecision {
  buyerId: string
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
}

export interface GameState {
  id: string
  phase: GamePhase
  currentRound: number       // 1–5
  infoMode: InfoMode
  sellers: Seller[]
  buyers: Buyer[]
  buyerQueue: string[]       // gemischte IDs für aktuelle Runde
  currentBuyerIndex: number
  currentSellerDecisions: Record<string, Partial<SellerDecision>>
  currentBuyerDecisions: Record<string, BuyerDecision>
  results: RoundResult[]
}
```

---

## Backend API-Routen (`/backend/src/routes/game.ts`)

| Method | Route | Body | Beschreibung |
|--------|-------|------|--------------|
| POST | `/api/game/new` | `{ sellers: string[], buyers: string[] }` | Neues Spiel starten |
| GET | `/api/game/:id` | — | Aktuellen GameState holen |
| POST | `/api/game/:id/seller-decision` | `{ sellerId, grade, price }` | Verkäufer gibt Entscheidung ab |
| POST | `/api/game/:id/reveal` | — | Board aufdecken (alle Seller fertig) |
| POST | `/api/game/:id/buyer-decision` | `{ buyerId, sellerId }` | Käufer kauft (oder nicht: sellerId=null) |
| POST | `/api/game/:id/confirm-second-unit` | `{ sellerId, confirm: boolean }` | Verkäufer bestätigt 2. Einheit |
| POST | `/api/game/:id/next-round` | — | Nächste Runde starten |
| GET | `/api/game/:id/results` | — | Alle Ergebnisse holen |

State wird in-memory gehalten (Map<string, GameState>).

---

## Frontend Views

1. **SetupView** — Namen für 3 Verkäufer + 4 Käufer, Spiel starten
2. **SellerInputView** — Jeder Verkäufer gibt Qualität + Preis ein (verdeckt)
3. **MarketView** — Öffentliche Tafel; Käufer kaufen der Reihe nach
4. **RoundEndView** — Runden-Ergebnisse, Gewinne, weiter-Button
5. **ResultsView** — Komplette Tabelle aller Runden (wie Table 1 im Paper)

---

## Konstanten (`/backend/src/lib/constants.ts` + `/shared/constants.ts`)

```ts
export const BUYER_VALUES: Record<Grade, number> = { 1: 4.0, 2: 8.8, 3: 13.6 }
export const SELLER_COSTS: Record<Grade, { first: number; second: number }> = {
  1: { first: 1.4, second: 2.4 },
  2: { first: 4.6, second: 5.6 },
  3: { first: 11.0, second: 12.0 },
}
export const FULL_INFO_ROUNDS = 3
export const TOTAL_ROUNDS = 5
export const MAX_SELLER_UNITS = 2
export const MAX_BUYER_UNITS = 1
```
