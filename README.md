# ROOT (Remote Observation & Ownership Tracker)

AI land and property intelligence platform with:
- NDVI region analysis + historical NDVI timeline (Sentinel-2 via Earth Search + TiTiler)
- Citizen PID claim workflow (query-only) with government review/approval
- Role-separated dashboards (Citizen vs Government Employee)
- Polygon-based land selection with draggable vertices for claims
- Government boundary dataset (preset Chandannagar, WB) with employee-only modify/remove controls
- Tamper-evident blockchain ledger events for auth, claims, parcels, disputes, boundaries
- JWT auth + PostgreSQL persistence (Neon/Supabase/local)

## Local Run (frontend + backend)

1. Install dependencies:
   - `npm install`
2. Create env:
   - `cp .env.example .env`
3. Run both:
   - `npm run dev:all`
4. Open:
   - [http://127.0.0.1:3000](http://127.0.0.1:3000)

If `PERSISTENCE_MODE=auto`, the backend uses PostgreSQL when available, otherwise in-memory fallback.

## Important Env Vars

Backend (`.env`):
- `API_PORT=4000`
- `JWT_SECRET=...`
- `TOKEN_EXPIRY=7d`
- `EMPLOYEE_SIGNUP_CODE=gov-2026`
- `CORS_ORIGIN=http://127.0.0.1:3000,http://localhost:3000,https://your-frontend-domain`
- `PERSISTENCE_MODE=postgresql`
- `ALLOW_MEMORY_FALLBACK=false`
- `DATABASE_URL=postgresql://...` (Neon/Supabase/local)
- `DATABASE_SSL=true` (for Neon/Supabase)

Frontend (Vercel env):
- `VITE_API_BASE_URL=https://your-render-backend.onrender.com`

## Key APIs

- Auth:
  - `POST /api/auth/signup`
  - `POST /api/auth/login`
  - `GET /api/auth/me`
  - `GET /api/auth/chain/verify`
- NDVI + Geo:
  - `GET /api/geo/search?q=...`
  - `POST /api/ndvi/current`
  - `POST /api/ndvi/timeline`
- Land workflow:
  - `GET /api/land/parcels`
  - `GET /api/land/claims`
  - `POST /api/land/claims`
  - `PATCH /api/land/claims/:id/review`
  - `GET /api/land/summary`
- Government boundary dataset:
  - `GET /api/land/boundaries`
  - `POST /api/land/boundaries` (employee)
  - `PATCH /api/land/boundaries/:id` (employee)
  - `DELETE /api/land/boundaries/:id` (employee)
- Agriculture/disputes/settings/analytics:
  - `POST /api/agri/insights`
  - `GET /api/agri/insights/history`
  - `GET /api/disputes/summary`
  - `GET /api/disputes`
  - `POST /api/disputes`
  - `PATCH /api/disputes/:id/status`
  - `GET /api/disputes/:id/ledger/verify`
  - `GET/PUT /api/settings/profile`
  - `PUT /api/settings/preferences`
  - `POST /api/settings/password`
  - `GET /api/analytics/overview` (employee)

## Deploy: Vercel + Render + Neon

### 1) Neon (database)
1. Create Neon project/database.
2. Copy connection string.
3. Use it as `DATABASE_URL` on Render.

### 2) Render (backend)
1. Create Web Service from this repo.
2. Use:
   - Build: `npm install`
   - Start: `npm run server`
3. Set env vars:
   - `DATABASE_URL` (Neon URL, with `sslmode=require`)
   - `DATABASE_SSL=true`
   - `PERSISTENCE_MODE=postgresql`
   - `ALLOW_MEMORY_FALLBACK=false`
   - `JWT_SECRET` (strong random)
   - `TOKEN_EXPIRY=7d`
   - `EMPLOYEE_SIGNUP_CODE=gov-2026`
   - `CORS_ORIGIN=https://your-vercel-domain.vercel.app`

`render.yaml` is included for reference.

### 3) Vercel (frontend)
1. Import same repo in Vercel.
2. Framework: Vite.
3. Set env var:
   - `VITE_API_BASE_URL=https://your-render-backend.onrender.com`
4. Deploy.

`vercel.json` is included for SPA routing.

## Role Model

- `USER` (Citizen): submit PID claim queries only (cannot self-assign land)
- `EMPLOYEE` (Government): reviews claims, approves/rejects, manages boundaries

Employee signup restrictions:
- Email must end with `.in` or `gov.in`
- Employee ID must start with `1947` followed by digits
