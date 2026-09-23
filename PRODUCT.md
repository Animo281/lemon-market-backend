# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary:** University or secondary-school lecturers/instructors running a seminar or lecture. They operate the admin dashboard on a laptop or desktop, projected or shared screen, in a classroom setting under bright ambient light. They need clear control over game flow and real-time status at a glance.

**Secondary:** Students (3–20 per session) participating as sellers or buyers. They join on their own phones or laptops, interacting in short bursts (30–90 seconds per turn), under mixed lighting. Mobile-first is critical for the player view.

## Product Purpose

Lemon-Market is a real-time multiplayer classroom experiment that lets students live through Akerlof's "Market for Lemons" — the economic theory of market failure caused by information asymmetry. A lecturer creates a session, students join as sellers or buyers, and they play through a configurable number of rounds (5 by default). Every round starts with full quality information; the lecturer manually switches to hidden quality — typically after a few rounds, once prices have settled — using an admin control, no fixed round count required. The shift reveals how asymmetric information collapses market efficiency.

Success means: students feel the market fail in real time, not just read about it. The experiment is self-contained, runs in under 30 minutes, and produces a data set (profit tables, supply/demand graphs, total surplus) the lecturer uses for post-game discussion.

## Positioning

The only classroom economics experiment that makes market failure a lived experience — not a case study. While other tools simulate markets abstractly, Lemon-Market puts students in roles with real incentives, hidden information, and time pressure, producing authentic behavioral data that drives the debrief.

## Constraints

- German-language UI (all copy, labels, phases in German)
- No accounts or login — sessions identified by a 4-character code
- Runs in modern browsers; no native app
- Tailwind CSS + React; no UI component library may be introduced
- ThemeToggle (dark/light) must remain functional

Two constraints from an earlier visual-redesign task ("shared types must not change",
"backend API routes must not change", "landing page excluded") scoped that specific
piece of work, not the product going forward — the host-configurable economics feature
intentionally changes `/shared/types.ts`, `POST /session`, `PATCH /config`, and the
`LandingView` config form. Don't read them as standing rules for future work either.

## Accessibility

Standard web accessibility; students use a range of devices. Focus states and color contrast must hold at both dark and light theme.
