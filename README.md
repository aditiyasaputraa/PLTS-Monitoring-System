# PLTS monitoring deployment bundle

Production-shaped serverless deployment for:

```text
Huawei + Kehua + SMA APIs
        ↓
GitHub Actions (cron-job.org / 15-minute schedule)
        ↓
Supabase: current snapshot + retained history
        ↓
Vercel: Vite/React dashboard
```

## Repository layout

```text
backend/                     Multi-vendor scraper logic (Huawei, Kehua, SMA), Supabase adapter
frontend/                    Vite/React dashboard deployed to Vercel
supabase/                    SQL schema and database setup notes
.github/workflows/scraper.yml Automated 15-minute scheduled scraping workflow
```

No login credentials, live cookies, raw HAR files, browser profiles, generated scrape output, `node_modules`, or frontend build output are included.

## Deployment order

### 1. Create the Supabase database

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run [`supabase/schema.sql`](supabase/schema.sql).
4. Copy the project URL, anon key, and server-side secret key.

### 2. Configure GitHub Actions Secrets

Set these repository secrets in **GitHub Settings -> Secrets and variables -> Actions**:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
HUAWEI_USERNAME (and HUAWEI_USERNAME_2..7)
HUAWEI_PASSWORD (and HUAWEI_PASSWORD_2..7)
KEHUA_USERNAME (and KEHUA_USERNAME_2..8)
KEHUA_PASSWORD (and KEHUA_PASSWORD_2..8)
SMA_USERNAME (and SMA_USERNAME_2..4)
SMA_PASSWORD (and SMA_PASSWORD_2..4)
```

The workflow runs every 15 minutes automatically, or can be triggered via `cron-job.org` / workflow dispatch.

### 3. Deploy the frontend on Vercel

Import the GitHub repository into Vercel and set:

```text
Root Directory: frontend
Framework: Vite
Build Command: npm run build
Output Directory: dist
Node.js Version: 22.x
```

Add Vercel Environment Variables:

```text
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

## Database behavior

The backend writes normalized monitoring data, not raw authenticated HTTP responses.

- `monitoring_current`: one row, updated after every scrape.
- `monitoring_snapshots`: historical rows saved at the configured history interval.
- Old history rows are deleted according to `HISTORY_RETENTION_DAYS`.

API endpoints:

```text
GET /health
GET /ready
GET /api/status
GET /api/current
GET /api/history?limit=24
GET /api/history?limit=24&include_payload=true
```

Each successful refresh also upserts one row per station and local calendar day
into `monitoring_site_daily`. Apply
`supabase/migrations/20260803000000_site_daily_rollups.sql` before deploying this
version. These durable facts are the source for comparable long-term site energy
and revenue charts; raw hourly snapshots can continue using their normal
retention window.

History responses are capped at 168 rows per request.

The automated scraping workflow runs every 15 minutes via GitHub Actions (`.github/workflows/scraper.yml`), triggered automatically or via `cron-job.org`. Each execution produces an updated monitoring snapshot directly to Supabase.

## Local development

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn api:app --reload --host 0.0.0.0 --port 8000
```

The backend loads `backend/.env` automatically for local development. Cookie
JSON may be formatted on one line or across multiple lines. Existing process
environment variables always take precedence over values in the file.

For a liveness-only smoke test without scraping or Supabase access:

```bash
AUTO_SCRAPE=false uvicorn api:app --host 127.0.0.1 --port 8000
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

## Security

- Keep the repository private.
- Rotate any password or session token that was previously uploaded or committed.
- Never put `SUPABASE_SECRET_KEY`, cookies, or passwords in Vercel.
- Never use secrets in variables prefixed with `VITE_`; those values are shipped to browsers.
- Store all Kehua credentials, including `KEHUA_ACCOUNTS_JSON`, only on the backend. The backend refreshes each account's authorization automatically when its token expires.
