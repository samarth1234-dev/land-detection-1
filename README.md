<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ROOT (Remote Observation & Ownership Tracker)

Land intelligence platform with:
- NDVI-based parcel analysis (Leaflet + Sentinel via Earth Search + TiTiler)
- Blockchain-style tamper-evident auth ledger
- Secure login/signup backend with JWT

## Local Setup

Prerequisites:
- Node.js 18+

1. Install dependencies:
   `npm install`
2. Create `.env` in project root:
   - `GEMINI_API_KEY=your_key`
   - `JWT_SECRET=your_strong_secret`
3. Start backend API (terminal 1):
   `npm run server`
4. Start frontend (terminal 2):
   `npm run dev`
5. Open:
   [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Auth API

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/auth/chain/verify`

Auth chain data is stored in:
- `backend/data/users.json`
- `backend/data/auth-chain.json`
