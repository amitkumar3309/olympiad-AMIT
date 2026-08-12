# ENVIRONMENT_VARIABLES.md

No real secrets are stored in this file or anywhere in the repo. `.env` files are gitignored (verified with `git check-ignore`; `backend/.env` has never been committed).

**`backend/.env.example` now exists** with placeholder values only — keep it in sync with the table below. The frontend still reads no environment variables, so it needs no `.env.example`.

**How env vars are loaded**: `backend/src/config/env.ts` loads `backend/.env` and validates everything through a zod schema, exporting a typed `env` object. `backend/src/config/index.ts` derives the app-wide typed `config` from it. **No other module reads `process.env` directly** — add new variables to the schema in `env.ts`, not as ad-hoc `process.env` reads.

**The `.env` path is anchored to the backend package root** (`path.resolve(__dirname, '..', '..', '.env')`), not to `process.cwd()`. This matters more than it sounds: `dotenv.config()` with no argument searches the *current directory*, so running a script from `backend/scripts/` found no `.env`, loaded **zero** variables, and every value silently fell back to its default — including `MONGO_URI`, which defaults to localhost. A seed script then published 208 questions to a local database and reported success while production stayed empty. The tell-tale sign was `injected env (0)` in the first line of output, alongside `JWT_SECRET is not set` and `SMTP is not configured` warnings.

If you ever see `injected env (0)`, **stop** — nothing you configured is in effect.

Two behaviours worth knowing:
- `dotenv.config()` is **skipped when `NODE_ENV=test`** (vitest sets this automatically) so the test suite can never silently pick up your real Atlas URI or JWT secret.
- Validation is **fail-closed in production for `JWT_SECRET`**: if it is unset when `NODE_ENV=production`, the process throws at startup instead of falling back to an insecure default. Locally it warns and uses a development-only default.

## Backend (`backend/`)

| Variable | Required | Purpose | Where to obtain it | Example format | Dev usage | Prod usage |
|---|---|---|---|---|---|---|
| `MONGO_URI` | Recommended (has an insecure localhost default) | MongoDB connection string used by Mongoose. **Must include the database name after the host** (`/amit-olympiad`) — without it MongoDB silently uses its default database `test` and your data appears to vanish. Check `GET /ready`, which reports `dbName`. | MongoDB Atlas free-tier cluster connection string, or a local MongoDB install. | `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/amit-olympiad` | Defaults to `mongodb://localhost:27017/amit-olympiad` if unset — requires a local MongoDB running. | **Must** be set to an Atlas (or other hosted) connection string — a Vercel serverless function cannot reach `localhost`. |
| `JWT_SECRET` | **Required in production** (server refuses to start without it) | Signs/verifies session JWTs. | Generate yourself — any long random string (e.g. `openssl rand -hex 32`). | `9f2c6e...(64 hex chars)` | Falls back to a development-only default with a logged warning if unset. | **Must** be set — startup throws if missing, by design, so a production deploy can never sign tokens with a public default (see [`SECURITY.md`](SECURITY.md)). |
| `ADMIN_EMAIL` | Required for admin login to work at all | The **root super administrator's** login email. Since Milestone 3 this account holds the `superadmin` role — the only role that can grant or revoke admin rights — and is the bootstrap identity that creates the first admin. Additional admins are *promoted* accounts and do not need env vars. | You choose it. | `admin@example.com` | Must be set for `/admin` to be usable locally. | Same. |
| `ADMIN_PASSWORD_HASH` | Required for admin login to work at all | bcrypt hash (never plaintext) of the root super administrator's password. Changing these two variables is the **only** way to withdraw super-admin access, since the account has no database record and cannot be suspended from the UI. | Generate with a short script using `bcryptjs` (see Dev usage) — **never** put the plaintext password in an env var. | `$2a$10$examplehashexamplehashexamplehashexamplehas` | Generate locally: `node -e "console.log(require('bcryptjs').hashSync('yourPassword', 10))"` run from inside `backend/`, then copy the printed hash. | Set the generated hash as the Vercel env var; never the plaintext. |
| `FRONTEND_URL` | Recommended in production | Adds the deployed frontend's origin to the CORS allow-list. | The frontend's Vercel production URL. | `https://amit-olympiad-frontend.vercel.app` | Optional locally (localhost:5173 is always allowed). | Should be set in production. If omitted, CORS allows only `localhost:5173`, which will block your real frontend — it no longer falls back to allowing any origin. A warning is logged at startup. |
| `NODE_ENV` | Set automatically by Vercel | Controls `isProd` branching (cookie `secure`/`sameSite`, whether `app.listen` runs). | N/A — Vercel sets this to `production` automatically. | `production` | Usually unset locally (`tsx` runs without it, `isProd` is `false`). | Set to `production` automatically by Vercel. Do not set manually elsewhere. |
| `PORT` | Optional | Local server port. | N/A | `8081` | Matches `.claude/launch.json` (`8081`). Not used in production (Vercel manages the port for serverless functions). | Unused. |

## Frontend (`frontend/`)

No environment variables are read anywhere in the frontend source (`src/api/client.ts` uses relative paths like `/api/auth/login`, resolved via the Vite dev proxy locally and via `vercel.json`'s rewrite in production). Nothing to configure here today.

## Beginner instructions: generating `ADMIN_PASSWORD_HASH`

1. Open a terminal in the `backend/` folder.
2. Make sure dependencies are installed: `npm install` (only needed once).
3. Run:
   ```bash
   node -e "console.log(require('bcryptjs').hashSync('YOUR_CHOSEN_PASSWORD', 10))"
   ```
4. Copy the printed string (starts with `$2a$10$...`) — that is your `ADMIN_PASSWORD_HASH` value. Do not commit it to a public repo; put it only in your local `.env` file or your Vercel project's environment variable settings.
5. Set `ADMIN_EMAIL` to whatever email you want to log in with (it does not need to be a real mailbox — it's just compared as a string).

## Beginner instructions: MongoDB Atlas free tier (if not already set up)

1. Go to mongodb.com/atlas and create a free account.
2. Create a free "M0" cluster (no cost).
3. Under "Database Access," create a database user with a username/password.
4. Under "Network Access," allow access from anywhere (`0.0.0.0/0`) for now — Vercel serverless functions don't have a fixed IP, so this is the simplest free-tier option (a real production hardening step later would be to restrict this, but Atlas free tier doesn't support Vercel's dynamic IPs well without it).
5. Click "Connect" → "Drivers" and copy the connection string — it looks like `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`.
6. Replace `<user>`/`<password>` with the database user you created, and add `/amit-olympiad` before the `?` to select the database name, e.g.:
   `mongodb+srv://myuser:mypassword@cluster0.xxxxx.mongodb.net/amit-olympiad?retryWrites=true&w=majority`
7. That full string is your `MONGO_URI`.

## Beginner instructions: setting env vars on Vercel

1. Open your project on vercel.com.
2. Go to Settings → Environment Variables.
3. Add each variable name/value from the tables above, one at a time, for the "Production" environment (and "Preview"/"Development" if you want preview deployments to work too).
4. Redeploy after adding/changing env vars — Vercel does not apply new env vars to an already-running deployment.


## Generating a JWT_SECRET

Run this from inside `backend/` and paste the output as `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Keeping `.env.example` in sync

`backend/.env.example` is the template a new contributor copies to `.env`. Whenever you add a variable to the zod schema in `backend/src/config/env.ts`, add it to **both** `.env.example` (placeholder value) and the table above in the same change.


---

## Milestone 2 additions — tokens, auth policy, and email

### Token lifetimes (all optional)

| Variable | Required | Purpose | Example | Notes |
|---|---|---|---|---|
| `ACCESS_TOKEN_TTL` | optional (default `15m`) | Lifetime of the short access-token JWT. | `15m` | Also the maximum time a revoked session can linger — see [`SECURITY.md`](SECURITY.md). Shorter is safer but means more refresh traffic. |
| `REFRESH_TOKEN_TTL_DAYS` | optional (default `30`) | How long a student stays signed in without re-entering a password. | `30` | Rotated on every use. |
| `ADMIN_TOKEN_TTL` | optional (default `8h`) | Admin access-token lifetime. | `8h` | Admins get no refresh token, so this is how often they re-authenticate. |

### Auth policy (all optional)

| Variable | Required | Purpose | Example | Notes |
|---|---|---|---|---|
| `REQUIRE_EMAIL_VERIFICATION` | optional (default `true`) | Whether students must click the emailed link before they can sign in. | `true` | **Escape hatch**: set to `false` only if mail delivery breaks and you need a way in. Accepts `true`/`false`/`1`/`0`. |
| `MAX_FAILED_LOGINS` | optional (default `5`) | Failed attempts before an account locks. | `5` | |
| `ACCOUNT_LOCK_MINUTES` | optional (default `15`) | How long the lock lasts. | `15` | |

### Email / SMTP

| Variable | Required | Purpose | Where to get it | Example |
|---|---|---|---|---|
| `SMTP_HOST` | required to send real email | SMTP server hostname. | Your email provider's dashboard. | `smtp-relay.brevo.com` |
| `SMTP_PORT` | required to send real email | SMTP port. | Same. | `587` |
| `SMTP_USER` | required to send real email | SMTP login. | Same. | `you@smtp-brevo.com` |
| `SMTP_PASS` | required to send real email | SMTP key/password. **A secret.** | Same. | `xsmtpsib-…` |
| `SMTP_SECURE` | optional (default `false`) | Implicit TLS. | — | `false` for port 587 (STARTTLS), `true` for 465. |
| `EMAIL_FROM` | optional (has a placeholder default) | The From address recipients see. | You choose, but your provider must authorise the domain. | `AMIT Olympiad <no-reply@yourdomain.com>` |

**If SMTP is unset, the app still works**: verification and reset emails are written to the backend log (including the real, working link) instead of being sent. That keeps local development fully testable before you sign up for anything. It is **not** acceptable in production — real students cannot read your server log.

`FRONTEND_URL` gains a second job in Milestone 2: it is the base for the links inside those emails. If it is wrong or unset in production, links will point at `http://localhost:5173` and be useless to students.

---

## Beginner instructions: free SMTP with Brevo (recommended)

Brevo's free tier allows 300 emails/day, needs no credit card, and works over plain SMTP. Any equivalent provider (Resend, Mailtrap, or a Gmail app password) works the same way — only the four `SMTP_*` values change.

1. Go to **brevo.com** and create a free account. Confirm your own email address when they ask.
2. In the left sidebar, open **Transactional** → **Settings** → **SMTP & API**, then choose the **SMTP** tab.
   (If you land on a "Campaigns" screen, look for the account menu → *Transactional*.)
3. You will see values labelled something like:
   - **SMTP server**: `smtp-relay.brevo.com` → this is your `SMTP_HOST`
   - **Port**: `587` → this is your `SMTP_PORT`
   - **Login**: an address ending in `@smtp-brevo.com` → this is your `SMTP_USER`
4. Click **Generate a new SMTP key** (sometimes "Create a new SMTP key"). Copy the key **immediately** — it is shown only once. That value is your `SMTP_PASS`.
5. Authorise a sender address: go to **Senders, Domains & Dedicated IPs** → **Senders** → **Add a sender**, and add the address you want mail to come from. Brevo emails you a confirmation link; click it.
   - If you do not own a domain, use a personal address here for now. Mail sent from an unauthorised address is rejected or lands in spam.
   - Whatever you authorise becomes your `EMAIL_FROM`, in the form `AMIT Olympiad <that-address>`.
6. Open `backend/.env` (create it by copying `backend/.env.example` if it does not exist) and fill in:
   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=<the login from step 3>
   SMTP_PASS=<the key from step 4>
   SMTP_SECURE=false
   EMAIL_FROM=AMIT Olympiad <the address you authorised in step 5>
   ```
7. Restart the backend (`npm run dev --prefix backend`). The startup warning about SMTP being unconfigured should disappear.
8. Test it: register a student through the site with an address you can actually read, and confirm the verification email arrives. If nothing arrives, check the backend log — a delivery failure is logged there with the provider's reason.

### Setting the same values on Vercel (production)

1. Open your **backend** project on vercel.com → **Settings** → **Environment Variables**.
2. Add each of the six `SMTP_*` / `EMAIL_FROM` values from step 6, for the **Production** environment.
3. While you are there, confirm `FRONTEND_URL` is set to your real frontend URL — the emailed links are built from it.
4. **Redeploy the backend.** Vercel does not apply new environment variables to an already-running deployment.

Never paste these values into a public repository, issue, or screenshot; `SMTP_PASS` is a live credential.
