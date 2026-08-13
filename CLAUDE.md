# Market for Lemons

Monorepo: Express/TypeScript Backend + React/TypeScript Frontend.

## Struktur
```
/backend   → Node.js + Express + TypeScript (Port 3001)
/frontend  → React + Vite + TypeScript + Tailwind (Port 5173)
/shared    → Gemeinsame TypeScript-Typen
```

## Befehle
```bash
cd backend && npm run dev
cd frontend && npm run dev
```

## Regeln
- Kein unnötiges Refactoring ohne Absprache
- Typen immer explizit (kein `any`)
- Shared Types in `/shared/types.ts`
- Kontext: CONTEXT.md
