# Si Cantina Sociale — AI WhatsApp Booking & Events Concierge

**Venue:** Si Cantina Sociale, V&A Waterfront, Silo District, Cape Town  
**Stack:** Next.js 14 · TypeScript · Supabase · OpenAI · WhatsApp Cloud API

---

## What This Is

A production-ready MVP that lets customers book tables and ask about events at Si Cantina Sociale entirely through WhatsApp. Bookings are captured by an AI concierge, saved to Supabase, and viewable by staff on a clean dashboard.

---

## Architecture Overview

```
WhatsApp Cloud API (inbound)
        │
        ▼
POST /api/webhooks/whatsapp
        │
        ├── services/whatsapp/parser.ts   → extract message from payload
        ├── services/bookings/service.ts  → fetch conversation history
        ├── services/ai/orchestration.ts  → classify intent + extract fields + generate reply
        │       ├── services/ai/extraction.ts   (OpenAI calls)
        │       ├── services/ai/prompt.ts        (system prompt builder)
        │       └── services/events/resolver.ts  (live event context)
        │
        ├── services/bookings/service.ts  → save reservation (when complete)
        ├── services/whatsapp/client.ts   → send reply
        └── services/bookings/service.ts  → log conversation turn

Staff dashboard (Next.js App Router server components)
  /dashboard               → today's bookings + stats
  /dashboard/bookings      → all upcoming reservations
  /dashboard/escalations   → flagged cases
  /dashboard/events        → resolved event schedule
  /dashboard/settings      → venue config (read-only)
```

---

## Folder Structure

```
.
├── app/
│   ├── api/webhooks/whatsapp/route.ts   ← WhatsApp webhook (GET verify + POST handler)
│   ├── dashboard/
│   │   ├── layout.tsx
│   │   ├── page.tsx                     ← Today's bookings
│   │   ├── bookings/page.tsx
│   │   ├── escalations/page.tsx
│   │   ├── events/page.tsx
│   │   └── settings/page.tsx
│   ├── layout.tsx
│   ├── page.tsx                         ← Redirects to /dashboard
│   └── globals.css
├── components/
│   ├── dashboard/
│   │   ├── Sidebar.tsx
│   │   ├── BookingsTable.tsx
│   │   ├── EscalationsTable.tsx
│   │   ├── EventsTable.tsx
│   │   └── StatsCard.tsx
│   └── ui/
│       ├── Badge.tsx
│       └── StatusBadge.tsx
├── lib/
│   ├── constants.ts
│   ├── utils.ts
│   └── supabase/
│       ├── client.ts                    ← Browser client
│       └── server.ts                    ← Server/service-role client
├── services/
│   ├── ai/
│   │   ├── prompt.ts                    ← System prompt + extraction prompt
│   │   ├── extraction.ts               ← OpenAI calls (intent + extraction + reply)
│   │   └── orchestration.ts            ← Main AI turn coordinator
│   ├── bookings/
│   │   └── service.ts                  ← Reservation + conversation log CRUD
│   ├── events/
│   │   └── resolver.ts                 ← DB events + recurring logic
│   └── whatsapp/
│       ├── client.ts                   ← Send messages via Graph API
│       └── parser.ts                   ← Parse inbound webhook payload
├── types/
│   └── index.ts                        ← All TypeScript types
├── supabase/
│   ├── migrations/001_initial_schema.sql
│   └── seed.sql
├── .env.example
└── README.md
```

---

## Prerequisites

- Node.js 18+
- A Supabase project (free tier works)
- An OpenAI API key (GPT-4o access recommended)
- A Meta Business account with WhatsApp Cloud API configured

---

## Installation

```bash
# 1. Clone the repo and install dependencies
cd "Rest Man"   # or your folder name
npm install

# 2. Set up environment variables
cp .env.example .env.local
# Fill in all values in .env.local

# 3. Run the dev server
npm run dev
```

The app will be at `http://localhost:3000`.

---

## Supabase Setup

### Step 1 — Create a project
Go to [supabase.com](https://supabase.com) and create a new project.

### Step 2 — Run the migration
In the Supabase SQL editor, paste and run the contents of:
```
supabase/migrations/001_initial_schema.sql
```

### Step 3 — Run the seed data
In the Supabase SQL editor, paste and run the contents of:
```
supabase/seed.sql
```

This seeds:
- Venue settings (Si Cantina Sociale config)
- Quiz Night events (2026-03-13, 2026-03-27, and 4 more forward)
- Salsa Night events (alternate Fridays)
- Sip & Paint events (2026-03-21, 2026-03-28)

### Step 4 — Get your keys
In Supabase → Settings → API:
- `NEXT_PUBLIC_SUPABASE_URL` = Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon public key
- `SUPABASE_SERVICE_ROLE_KEY` = service_role key (keep secret)

### Row Level Security (RLS)
For this MVP the service role key bypasses RLS. Before going fully public-facing, add RLS policies on the `conversation_logs` and `reservations` tables.

---

## WhatsApp Cloud API Setup

### Step 1 — Meta Developer App
1. Go to [developers.facebook.com](https://developers.facebook.com) and create an app (Business type)
2. Add the **WhatsApp** product
3. Under WhatsApp → Getting Started, note your:
   - **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **Access Token** → `WHATSAPP_ACCESS_TOKEN`

### Step 2 — Set your webhook
1. Under WhatsApp → Configuration → Webhook:
   - **Callback URL:** `https://your-domain.com/api/webhooks/whatsapp`
   - **Verify Token:** the random string you put in `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
2. Subscribe to the **messages** field

### Step 3 — Test number
During development you can use the Meta test number. For production, submit your phone number for review.

### Local development with tunnels
Use [ngrok](https://ngrok.com) to expose your local port:
```bash
ngrok http 3000
# Use the https URL as your webhook callback
```

---

## OpenAI Setup

1. Get an API key at [platform.openai.com](https://platform.openai.com)
2. The app uses:
   - `gpt-4o-mini` for intent classification and field extraction (fast + cheap)
   - `gpt-4o` for the main conversational reply (better quality)

---

## Deployment (Vercel)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set production environment variables
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add OPENAI_API_KEY
vercel env add WHATSAPP_PHONE_NUMBER_ID
vercel env add WHATSAPP_ACCESS_TOKEN
vercel env add WHATSAPP_WEBHOOK_VERIFY_TOKEN
```

After deploying, update your WhatsApp webhook URL to the Vercel production URL.

---

## Business Logic Reference

### Booking rules
| Rule | Value |
|---|---|
| Service charge threshold | > 8 guests |
| Max table size | 100 guests |
| Max venue capacity | 200 guests |
| Escalation trigger | > 100 guests, private events, complaints, unknown requests |

### Opening hours
| Days | Hours |
|---|---|
| Sunday – Thursday | 08:30 – 21:30 |
| Friday – Saturday | 08:30 – late |

### Recurring events
| Event | Pattern |
|---|---|
| Quiz Night | Every 2nd Friday, starting 2026-03-13 (14-day interval) |
| Salsa Night | Alternate Fridays, starting 2026-03-20 (14-day interval) |
| Sip & Paint | Fixed dates only — seeded in database |

Database records override computed recurring events. Set `cancelled = true` on any event record to suppress that specific occurrence.

---

## Extending the MVP

| Feature | Approach |
|---|---|
| Booking confirmation emails | Add Resend/Nodemailer in `createReservation()` |
| Cancel/reschedule via WhatsApp | Add intent + action in orchestration |
| Dashboard auth | Add Supabase Auth + middleware |
| Webhook signature verification | Verify `X-Hub-Signature-256` header in POST handler |
| Capacity checks | Query `reservations` by date before confirming |
| Multi-venue support | Add `venue_id` FK across tables |
| WhatsApp template messages | Use `sendWhatsAppMessage()` variants for approved templates |

---

## License

Private — Si Cantina Sociale internal use only.
