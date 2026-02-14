<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ROOT (Remote Observation & Ownership Tracker)

Land intelligence platform with:
- NDVI-based parcel analysis (Leaflet + Sentinel via Earth Search + TiTiler)
- Blockchain-style tamper-evident auth ledger
- Secure login/signup backend with JWT + PostgreSQL (or in-memory demo mode)
- Land dispute workflow with map-based parcel selection (2-click rectangle)

## Local Setup

Prerequisites:
- Node.js 18+ (Node 20+ recommended)

### Quick Start (works on Windows without PostgreSQL)

1. Clone repo and open project folder.
2. Install dependencies:
   `npm install`
3. Copy env template:
   - PowerShell: `Copy-Item .env.example .env`
   - CMD: `copy .env.example .env`
4. Run frontend + backend together:
   `npm run dev:all`
5. Open:
   [http://127.0.0.1:3000](http://127.0.0.1:3000)

In this mode (`PERSISTENCE_MODE=auto`), backend will use PostgreSQL if available, otherwise it auto-falls back to in-memory mode so the app still runs.

### PostgreSQL Mode (persistent storage)

1. Install PostgreSQL and create DB `root_land`.
2. Update `.env`:
   - `PERSISTENCE_MODE=postgresql`
   - `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME`
   - or `DATABASE_URL=postgresql://...`
3. Run:
   - terminal 1: `npm run server`
   - terminal 2: `npm run dev`

### Supabase PostgreSQL Mode

Supabase gives you managed PostgreSQL. This project backend (Express) still runs on your machine/server, but stores all data in Supabase DB.

1. In Supabase dashboard:
   - Create project
   - Open `Project Settings -> Database -> Connection string`
   - Copy the **pooler** connection string
2. In local `.env`, set:
   - `SUPABASE_DB_URL=your_pooler_url`
   - `PERSISTENCE_MODE=postgresql`
   - `ALLOW_MEMORY_FALLBACK=false`
   - `DATABASE_SSL=true`
3. Run with strict Supabase mode:
   - backend only: `npm run server:supabase`
   - frontend + backend: `npm run dev:supabase`
4. Check:
   - `http://127.0.0.1:4000/api/health`
   - response should include `"persistence":"postgresql"`

## Auth API

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/auth/chain/verify`
- `POST /api/agri/insights`
- `GET /api/agri/insights/history` (authenticated user)
- `GET /api/disputes/summary` (authenticated user)
- `GET /api/disputes` (authenticated user)
- `POST /api/disputes` (authenticated user)
- `PATCH /api/disputes/:id/status` (authenticated user)
- `GET /api/disputes/:id/ledger/verify` (authenticated user)
- `GET /api/settings/profile` (authenticated user)
- `PUT /api/settings/profile` (authenticated user)
- `PUT /api/settings/preferences` (authenticated user)
- `POST /api/settings/password` (authenticated user)
- `GET /api/analytics/overview` (government employee only)

Auth chain data is stored in:
- PostgreSQL tables (`users`, `chain_blocks`, `agri_insights`, `user_settings`, `land_disputes`, `dispute_events`) when PostgreSQL mode is active
- In-memory database when demo mode fallback is active

Dispute blockchain notes:
- each dispute create/status event appends a chain block
- each event carries a dispute snapshot hash
- map-selected parcel bounds are stored in `selection_bounds`

Role model:
- `USER` (citizen): sees only own records/disputes/history
- `EMPLOYEE` (government employee): sees global metrics, cross-user disputes, and governance analytics
