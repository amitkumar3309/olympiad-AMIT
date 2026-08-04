# ENVIRONMENT_VARIABLES.md

No real secrets are stored in this file or anywhere in the repo. `.env` files are gitignored. **No `.env.example` files exist yet** for either app — create them (placeholder values only) the next time these are touched, matching the tables below.

## Backend (`backend/`)

| Variable | Required | Purpose | Where to obtain it | Example format | Dev usage | Prod usage |
|---|---|---|---|---|---|---|
| `MONGO_URI` | Recommended (has an insecure localhost default) | MongoDB connection string used by Mongoose. | MongoDB Atlas free-tier cluster connection string, or a local MongoDB install. | `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/amit-olympiad` | Defaults to `mongodb://localhost:27017/amit-olympiad` if unset — requires a local MongoDB running. | **Must** be set to an Atlas (or other hosted) connection string — a Vercel serverless function cannot reach `localhost`. |
| `JWT_SECRET` | Strongly recommended (insecure default exists) | Signs/verifies session JWTs. | Generate yourself — any long random string (e.g. `openssl rand -hex 32`). | `9f2c6e...(64 hex chars)` | Falls back to `dev_insecure_secret_change_me` with a console warning if unset. | Must be set to a strong random value. If left unset, all sessions become forgeable (see [`SECURITY.md`](SECURITY.md)). |
| `ADMIN_EMAIL` | Required for admin login to work at all | The single admin account's login email. | You choose it. | `admin@example.com` | Must be set for `/admin` to be usable locally. | Same. |
| `ADMIN_PASSWORD_HASH` | Required for admin login to work at all | bcrypt hash (never plaintext) of the admin password. | Generate with a short script using `bcryptjs` (see Dev usage) — **never** put the plaintext password in an env var. | `$2a$10$examplehashexamplehashexamplehashexamplehas` | Generate locally: `node -e "console.log(require('bcryptjs').hashSync('yourPassword', 10))"` run from inside `backend/`, then copy the printed hash. | Set the generated hash as the Vercel env var; never the plaintext. |
| `FRONTEND_URL` | Recommended in production | Adds the deployed frontend's origin to the CORS allow-list. | The frontend's Vercel production URL. | `https://amit-olympiad-frontend.vercel.app` | Optional locally (localhost:5173 is always allowed). | Should be set in production — see the CORS fail-open issue in [`SECURITY.md`](SECURITY.md) if omitted. |
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
