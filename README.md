<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ROOT (Remote Observation & Ownership Tracker)

Land intelligence platform with:
- NDVI-based parcel analysis (Leaflet + Sentinel via Earth Search + TiTiler)
- Blockchain-style tamper-evident auth ledger
- Secure login/signup backend with JWT + PostgreSQL persistence

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

Auth chain data is stored in:
- `users` table (PostgreSQL)
- `chain_blocks` table (PostgreSQL)
- `agri_insights` table (PostgreSQL)
