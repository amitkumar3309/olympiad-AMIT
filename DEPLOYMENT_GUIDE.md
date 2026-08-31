# DEPLOYMENT_GUIDE.md

_Last updated: 2026-08-11 (Milestone 6 — Practice Zone)._

Target: **₹0 cost**. Everything below uses free tiers. Do not introduce a paid service without discussing it with the owner first (per [`CLAUDE.md`](CLAUDE.md)).

## Local Development

Prerequisites: Node.js (LTS), npm, and either a local MongoDB install or an Atlas free-tier cluster (see [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) for Atlas setup steps).

1. Install dependencies (first time only, or after a dependency change):
   ```bash
   npm install --prefix backend
   npm install --prefix frontend
   ```
2. Create `backend/.env` (not committed) with at least:
   ```
   MONGO_URI=mongodb://localhost:27017/amit-olympiad
   JWT_SECRET=some-long-random-dev-string
   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD_HASH=<generated hash, see ENVIRONMENT_VARIABLES.md>
   ```
3. Run both servers (matches `.claude/launch.json` ports — backend `8081`, frontend `5173`):
   ```bash
   npm run dev --prefix backend
   ```
   ```bash
   npm run dev --prefix frontend
   ```
4. Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to `http://localhost:8081` automatically (`frontend/vite.config.ts`) — you do not need CORS configured for local dev.

## Production Deployment (Vercel, free tier)

Two **separate** Vercel projects — this is intentional (see [`DECISIONS.md`](DECISIONS.md)), not a mistake to "fix" into one project.

### Backend project
1. In Vercel, import the repo but set the project's **Root Directory** to `backend/`.
2. Vercel auto-detects `backend/api/index.ts` as a serverless function (via `@vercel/node`, already a dependency) and `backend/vercel.json` rewrites all paths to it.
   - **The backend must have no `build` script.** `@vercel/node` compiles the TypeScript entrypoint itself. If a script named `build` exists, Vercel runs it and then fails with `No Output Directory named "public" found`. The local type-emitting command is named `compile` for exactly this reason — do not rename it back.
3. Add the env vars from [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) (backend table) in Settings → Environment Variables.
4. Deploy. Note the resulting production URL (e.g. `https://amit-olympiad.vercel.app`).

### Frontend project
1. In Vercel, import the repo again as a **second** project, Root Directory `frontend/`.
2. Build command `vite build` / `tsc -b && vite build` (from `package.json`'s `build` script) — Vercel auto-detects the Vite framework preset.
3. **Important**: `frontend/vercel.json` hardcodes the backend URL in its `/api/*` rewrite. If your backend's deployed URL differs from `https://amit-olympiad.vercel.app`, you must edit that file before/after deploying to point at your actual backend URL, then redeploy the frontend.
4. Set the backend project's `FRONTEND_URL` env var to this frontend's production URL, then redeploy the **backend** too (so CORS allows it).
5. Deploy.

### Free-tier cost notes
- Vercel Hobby plan: free for both projects, sufficient for MVP traffic.
- MongoDB Atlas M0 cluster: free, 512MB storage — sufficient for MVP scale.
- No paid SMS/OTP provider, no paid payment gateway, no paid email provider are integrated yet — none should be added without discussing cost with the owner first, and free-tier options (e.g. a free email API tier) should be preferred when these are eventually built.

## What is NOT required (avoid over-engineering the MVP)

- No need for a CDN, load balancer, or dedicated server — Vercel's free tier serverless functions are sufficient at MVP scale.
- No need for a paid MongoDB tier until data/traffic actually exceeds the M0 free tier limits.
- No CI/CD pipeline is currently configured (no GitHub Actions) — Vercel's git-integration auto-deploy on push is sufficient for now; don't add a separate paid CI service.

## Verifying a deployment works

1. Visit the frontend production URL, confirm the landing page loads.
2. Try registering a test student — confirms frontend → backend → MongoDB write path end-to-end.
3. Log out, log back in — confirms the JWT cookie round-trips correctly across the frontend/backend domain split (this is the step most likely to break if `sameSite`/`secure`/CORS env vars are misconfigured — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)).
4. Visit `/admin` and log in with the admin credentials you configured.

---

## Post-deploy data steps

Vercel deploys **code**. Nothing below is data Vercel can put in place for you, and the app looks broken — or merely empty — until these are run. All are run from the **`backend` directory**, and all read `MONGO_URI` from `backend/.env`, which is the production Atlas database.

Every one is report-only by default. Run it without a flag first, read the output, then add the flag.

**1. Remove pre-Milestone-4 question documents.** The current `Question` model cannot read them at all (`subject` changed from `String` to `ObjectId`, which is a cast error rather than a tolerable missing field), so the admin question list errors on any of them.

```bash
cd backend && npx tsx scripts/migrate-questions.ts --delete
```

**2. Publish a question bank.** Without this the Practice Zone correctly reports "nothing to practise yet", and the daily challenge says "no challenge today" — both only ever offer *published* questions matching the student's own class. Two banks exist, and each script is report-only until `--write`, so run it once without the flag first and read what it says it would do.

```bash
cd backend && npx tsx scripts/seed-class12.ts --write
```

```bash
cd backend && npx tsx scripts/seed-class9.ts --write
```

**2b. Provision the Class 9 demo account and challenge** (optional — only for a demonstration). Creates one verified Class 9 student, records the entry fee as captured against it, and pins a chosen daily challenge for today. It **refuses** to run if no Class 9 question is published, and it writes no practice history, no streak and no XP beyond the one award a real registration also grants. `--days=3` pins the next two days as well.

```bash
cd backend && npx tsx scripts/seed-demo.ts --write --days=3
```

**3. Backfill activity for pre-Milestone-5 accounts** (optional). Gives them the enrolment XP they already earned instead of a blank dashboard. Skipping it is safe — they simply start from zero.

```bash
cd backend && npx tsx scripts/backfill-activity.ts --write
```

**4. Confirm email delivery.** Login is blocked until a student verifies their address, and admin promotion requires a verified account, so this gates real use more than anything else here.

```bash
npm run verify:email --prefix backend -- you@example.com
```

### Checking it worked

```bash
cd backend && npx tsx scripts/where-is-data.ts
```

Read-only. Prints the database actually connected to, every collection's real name, and a document count for each. Two things to check:

- `Connected to database` must name the `amit-olympiad` database on your Atlas cluster. If it says `localhost`, the run never reached production — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
- Visit `/ready` on the **deployed** backend and compare its `dbName`. Vercel's `MONGO_URI` and your local `backend/.env` are configured independently, so if they disagree your machine and your live site are working on different databases.

### If Atlas is unreachable from your machine

`querySrv ECONNREFUSED` means the `mongodb+srv://` DNS lookup was refused by your resolver — **not** an Atlas, password or IP-allowlist problem, because nothing ever reached Atlas. Switch DNS to `1.1.1.1`, disconnect any VPN, or generate a non-SRV connection string that needs no SRV lookup:

```bash
cd backend && npx tsx scripts/atlas-direct-uri.ts
```
