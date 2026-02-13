<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ROOT (Remote Observation & Ownership Tracker)

Land intelligence platform with:
- NDVI-based parcel analysis (Leaflet + Sentinel via Earth Search + TiTiler)
- Blockchain-style tamper-evident auth ledger
- Secure login/signup backend with JWT + PostgreSQL persistence
- Land dispute workflow with map-based parcel selection (2-click rectangle)

## Local Setup

Prerequisites:
- Node.js 18+
- PostgreSQL 14+

1. Install dependencies:
   `npm install`
2. Create PostgreSQL database:
   `createdb root_land`
3. Create `.env` in project root:
   - `GEMINI_API_KEY=your_key`
   - `JWT_SECRET=your_strong_secret`
   - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/root_land`
4. Start backend API (terminal 1):
   `npm run server`
5. Start frontend (terminal 2):
   `npm run dev`
6. Open:
   [http://127.0.0.1:3000](http://127.0.0.1:3000)

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

Auth chain data is stored in:
- `users` table (PostgreSQL)
- `chain_blocks` table (PostgreSQL)
- `agri_insights` table (PostgreSQL)
- `user_settings` table (PostgreSQL)
- `land_disputes` table (PostgreSQL)
- `dispute_events` table (PostgreSQL)

Dispute blockchain notes:
- each dispute create/status event appends a chain block
- each event carries a dispute snapshot hash
- map-selected parcel bounds are stored in `selection_bounds`
