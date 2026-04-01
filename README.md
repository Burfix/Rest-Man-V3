# ForgeStack

**The operating brain for restaurant GMs.**

ForgeStack turns fragmented restaurant data into a single operating intelligence layer. At any moment it knows: what is the highest-risk issue right now, what action produces the fastest result, and what happens if nothing is done. It does not report — it operates.

---

## What it does

- Monitors revenue pace, labour cost, duties completion, maintenance status, and compliance in real time
- Generates a single operating score and grade (A–F) updated every 3 minutes
- Surfaces a prioritised action queue — not a list of metrics
- Issues consequence language tied to guest experience, financial impact, or legal risk
- Tracks GM accountability and scores performance daily
- Delivers a morning brief and end-of-day sync via email

---

## Architecture

```
Next.js 14 App Router (server components + client leaves)
Supabase (Postgres + row-level security + service-role client)
Vercel (deployment + cron jobs)
Resend (transactional email)
MICROS POS (revenue sync via micros_sales_daily)
```

**Core intelligence stack:**

```
services/brain/operating-brain.ts        ← runOperatingBrain() — master orchestrator
services/brain/voice-generator.ts        ← 18-state situational briefing
services/intelligence/context-builder.ts ← buildOperationsContext() — all module data
services/intelligence/signal-detector.ts ← detectSignals() — S1–S11 cross-module signals
services/forecasting/forecast-engine.ts  ← historical pattern-based revenue projection
services/accountability/score-calculator.ts ← GM performance scoring
```

**Command Center (dashboard first screen):**

```
Layer 1 — HeroStrip: score + grade + voice line + 4 KPI pills + sync
Layer 2 — PriorityActionBoard: ranked action cards + brain recommendation + score bars
Layer 3 — ServicePulse, CommandFeed, BusinessStatusRail, FeedbackLoop
```

---

## Operating score

| Module      | Weight |
|-------------|--------|
| Revenue     | 30 pts |
| Labour      | 20 pts |
| Duties      | 20 pts |
| Maintenance | 15 pts |
| Compliance  | 15 pts |

Grades: A (90+) · B (80–89) · C (65–79) · D (50–64) · F (<50)

---

## Current pilots

- **Si Cantina Sociale** — V&A Waterfront, Cape Town
- **Primi** — Camps Bay, Cape Town

---

## Roadmap

- [ ] Inventory module
- [ ] WhatsApp alert delivery
- [ ] Mobile-native app
- [ ] Multi-brand support
- [ ] API for third-party integrations
- [ ] Predictive staffing recommendations
- [ ] AI-powered shift briefings

---

## Status

Active development. Founder-led. Pilots live.

---

*Built by Burfix · Cape Town*
