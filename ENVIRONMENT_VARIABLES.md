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
| `FRONTEND_URL` | **Required in production** | Two jobs. (1) It is the base of every link inside a verification or password-reset email. (2) It adds the deployed frontend's origin to the CORS allow-list. | The frontend's Vercel production URL. | `https://amit-olympiad-frontend.vercel.app` | Optional locally (localhost:5173 is always allowed). | **If unset in production, every emailed link points at `http://localhost:5173` and no student can verify their address — so none of them can log in, because login requires a verified address.** The email row still reports as *sent*, which is why this is easy to miss; `/admin/email-deliveries` now shows a banner when it happens, and an error is logged at startup. CORS is also restricted to localhost, though that half is survivable because the frontend proxies `/api/*` through a Vercel rewrite. |
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
| ~~`ADMIN_TOKEN_TTL`~~ | **removed in Milestone 11** | — | — | The super admin now has a database account and a rotating refresh token like everybody else, so it uses `ACCESS_TOKEN_TTL`. Harmless if still set anywhere — it is ignored. |

### Auth policy (all optional)

| Variable | Required | Purpose | Example | Notes |
|---|---|---|---|---|
| `REQUIRE_EMAIL_VERIFICATION` | optional (default `true`) | Whether students must click the emailed link before they can sign in. | `true` | **Escape hatch**: set to `false` only if mail delivery breaks and you need a way in. Accepts `true`/`false`/`1`/`0`. **`npm run dev:local` forces this to `false`** (Milestone 7) and points SMTP at a dead local port, so local work neither waits for a link nor emails a real person — see [`DECISIONS.md`](DECISIONS.md). Set it explicitly in the environment to override for one run. |
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

**And a third, since the 2026-08-17 security audit: it decides which browser origin may make a state-changing request.** `middleware/csrf.ts` checks every `POST`/`PUT`/`PATCH`/`DELETE` against the CORS allow-list, and in production that list is `FRONTEND_URL` and nothing else — `http://localhost:5173` is no longer admitted there. So the failure mode of getting this wrong is now visible immediately rather than only in somebody's inbox: **every write returns 403**. It must match the origin the browser is actually on, character for character — scheme included, no path, no trailing slash — which matters if the site is reachable at both a custom domain and a `*.vercel.app` one. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

### Performance recommendations (Milestone 16)

| Variable | Required | Purpose | Where to get it | Example |
|---|---|---|---|---|
| `RECOMMENDATION_ENGINE` | optional (default `statistical-v1`) | Which registered recommendation engine derives a student's advice. | Nowhere — it names code in this repository, not an external service. | `statistical-v1` |

**There is nothing to obtain and nothing to pay for.** The default engine counts the student's own answered questions and compares them using confidence intervals; it makes no network calls and needs no credentials. Leaving this variable unset entirely is the supported configuration, and is what production should run.

It exists so that an alternative engine — a trained model, or a language model — can be selected without changing the route, the response shape or the page. Setting it to a name that has not been registered in code is **not fatal**: the service logs one warning and falls back to the statistical engine, because a typo in an environment variable should not take a panel off the analytics page.

Recommendations themselves use **no AI** and never will without a further decision — see the Milestone 16 ADR. The one place a model *is* used is question drafting, below.

### AI question drafting (Milestone 17, extended in Milestone 20)

| Variable | Required | Purpose | Where to get it | Example |
|---|---|---|---|---|
| `GEMINI_API_KEY` | **optional** | Lets Google Gemini write first drafts on the admin **AI Question Generator** page, and — since Milestone 21 Phase E — read questions off **uploaded photographs** in the bulk importer. Those are the only two uses. **A secret.** Without it both are unavailable and everything else, including Excel and Word import, works normally. | Google AI Studio — see below. | `AIzaSy…` |
| `GEMINI_MODEL` | optional (default `gemini-flash-latest`) | Which model to call. **Leave it as the rolling alias** unless you need a pinned version — Google retires exact model names on their own schedule, and a pinned one will eventually stop working with "this model is no longer available". The page has a **"Which models can my key use?"** button that asks your key directly, so the name never has to be guessed. | — | `gemini-flash-latest` |
| `QUESTION_GENERATOR` | optional (default `auto`) | Which registered generator the button uses. `auto` = "the first configured provider". Only set this if a second provider has been registered in code. | — | `auto` |
| `GEMINI_MAX_RETRIES` | optional (default `1`, max `3`) | How many **extra** attempts a *transient* failure earns. Only 429, 5xx and timeouts are retried; an expired key, a blocked prompt and a retired model name are not, because repeating them spends quota to receive the same refusal. `0` disables retrying. | — | `1` |
| `GENERATION_MAX_QUESTIONS` | optional (default `20`, max `20`) | The most questions one request may ask for. Lower it on a tighter quota. | — | `20` |
| `GENERATION_MAX_INSTRUCTION_CHARS` | optional (default `500`) | How long the examiner's "extra instructions" box may be. It is pasted into a prompt, so an unbounded field is a cost. | — | `500` |
| `GENERATION_RATE_LIMIT_PER_HOUR` | optional (default `60`) | Generation requests allowed per hour, per IP. This is the one route in the product where each call spends third-party quota. | — | `60` |

**Everything else works with all of these unset.** With no key the AI generator page reports itself unconfigured and the endpoint answers **503 naming the variable**. It does **not** invent placeholder questions — the template fallback that used to exist was removed in Milestone 18, because a blank placeholder is only useful as something to type into and a reviewer who wants one can create a question by hand. The key alone turns AI drafting on; deleting it turns it off. Nothing else in the product uses a model.

**No student data is ever sent.** The request contains a subject name, chapter names, an optional subtopic name, a class level, a difficulty, the marks, and any instruction you typed into the box — nothing about any child. There is a test asserting the request body contains no student fields.

**Nothing generated is saved until you approve it.** Generation returns candidates that live only in your browser; a separate, explicit approval call is the only thing that writes to the question bank, and it re-checks everything from scratch against the same zod schema and the same LaTeX safety rules a hand-written question passes. Anything that fails is discarded **with its reason shown**, never silently corrected. Approved questions are saved as drafts unless you also tick publish.

**The key is never exposed.** It lives only in the backend process, is sent to Google as a request header rather than in a URL, and every provider message that reaches your screen or the logs is scrubbed of it first. The frontend never receives it, and it is not in any API response.

#### Beginner instructions: getting a free Gemini API key

1. Go to **https://aistudio.google.com/apikey** and sign in with a Google account.
2. Click **Create API key**. If asked to pick a project, choose the default one or create a new one — the name does not matter.
3. Copy the key immediately (it usually starts with `AIza…`). Treat it like a password: it is a live credential and anyone with it can spend your quota.
4. Open `backend/.env` (copy `backend/.env.example` if you have not got one) and add:
   ```
   GEMINI_API_KEY=the key you just copied
   ```
   Leave `GEMINI_MODEL` alone unless you have a reason to pin a version.
5. **Restart the backend.** `config/env.ts` reads the environment once at startup, so a running process will not pick up the new key:
   ```
   npm run dev:local --prefix backend
   ```

#### Verifying that the backend can actually reach Gemini

Do these in order. Each one tells you something different, and the first two need no quota worth speaking of.

1. **Is the key loaded at all?** Sign in to the admin panel and open **AI Question Generator**. The banner at the top should read **Google Gemini**. If it instead says *"Not configured — set `GEMINI_API_KEY`"*, the backend did not see the key: check for a typo, check the variable is in `backend/.env` and not somewhere else, and check you restarted.
2. **Can the key talk to Google?** On the same page, look at the **Model** dropdown. It fills itself by asking your key which models it may use. If it lists models, the credential is valid and the network path works. If it shows *"Could not load the list"*, the message underneath is Google's own — an invalid key, a blocked project or no internet each say something different. This is a free metadata call, not a generation.
3. **Can it generate?** Pick a subject, a chapter, **Class 9**, **Medium**, ask for **2** questions and press **Generate**. This is the first step that spends real quota, and two questions is a negligible amount of it. Read what comes back before approving anything.
4. **If something fails**, the page shows the provider's own words rather than a generic error, because an expired key, a spent quota, a blocked prompt and a retired model name need four different fixes. [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) has the common ones.

There is also a command-line check that needs no admin session — it asks Google directly with whatever key your `.env` holds:

```bash
npm run verify:gemini --prefix backend
```

#### Setting it on Vercel (production)

1. Open your **backend** project on vercel.com → **Settings** → **Environment Variables**.
2. Add `GEMINI_API_KEY` for the **Production** environment. Add the others only if you want to change a default.
3. **Redeploy the backend.** Vercel does not apply new environment variables to a running deployment.
4. Verify against the deployed site using the same three steps above.

Never add `GEMINI_API_KEY` to the **frontend** Vercel project. The frontend reads no environment variables at all, and anything placed there would be compiled into a public JavaScript bundle.

**Cost and quota.** The free tier has per-minute and per-day request limits and needs no card. If you exceed it, Google returns a quota error and the page reports it in Google's own words — **nothing is charged and nothing is saved**. Google changes these limits on their own schedule, so check the current free-tier terms before a heavy session. **Do not enable billing** on the Google Cloud project unless you have decided to spend money. `GENERATION_RATE_LIMIT_PER_HOUR` and `GENERATION_MAX_QUESTIONS` are the two knobs for bounding a session's spend, and `GEMINI_MAX_RETRIES=0` stops a failing run from costing more than one request.

Never paste the key into a repository, an issue or a screenshot.

---

## Beginner instructions: free SMTP with Brevo (recommended)

Brevo's free tier allows 300 emails/day, needs no credit card, and works over plain SMTP. Any equivalent provider (Resend ~3,000/month, SendGrid, Mailtrap for testing, or a Gmail app password ~500/day) works the same way — only the four `SMTP_*` values change, because the transport is provider-agnostic.

> **Milestone 14 added no new environment variables**, and no new dependency. Email notifications, the outbox, retries and the delivery console all run on the `SMTP_*` group already documented below. What *did* change is how much mail the platform can now send, so the daily limit matters in a way it did not before:
>
> - **A daily cap is now reachable.** Emailing an announcement to a class of 200 is 200 messages. On Brevo's 300/day that is most of a day's allowance in one action, and registrations and password resets share the same budget. This is exactly why a broadcast is **opt-in per announcement** and capped at 500 recipients rather than being the default.
> - **Hitting the cap is visible rather than silent.** The provider refuses, the outbox records its error text, and the message is retried with a growing delay — so a quota problem shows up as a run of retrying rows on **`/admin/email-deliveries`**, not as mail that quietly vanished. If you see that, the queue will drain itself once the quota resets; nothing needs re-sending by hand.
> - **Authorise your sender address before any broadcast.** Mail from an unauthorised address is rejected or spam-filed, and a rejected broadcast burns the same quota as a delivered one.

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
3. While you are there, confirm `FRONTEND_URL` is set to your real frontend URL. Two things depend on it: the emailed links are built from it, **and since 2026-08-17 it is the only origin allowed to make a state-changing request** — get it wrong and every save, every sign-out and every payment returns 403.
4. **Redeploy the backend.** Vercel does not apply new environment variables to an already-running deployment.

Never paste these values into a public repository, issue, or screenshot; `SMTP_PASS` is a live credential.

---

## Payments — Razorpay (Milestone 19)

| Variable | Required? | What it does | Where to get it | Example (fake) |
|---|---|---|---|---|
| `RAZORPAY_KEY_ID` | **optional** | The **public** key id. The browser needs it to open the checkout, and it is sent to the page by the server rather than built into the frontend bundle, so the two can never drift apart. | Razorpay dashboard — see below. | `rzp_test_1A2b3C4d5E6f7G` |
| `RAZORPAY_KEY_SECRET` | **optional** | Signs orders and verifies what the checkout hands back. **A secret — this one must never leave the server.** | Same place, shown once. | `9zYx8Wv7Ut6Sr5Qp4On3Ml2K` |
| `RAZORPAY_WEBHOOK_SECRET` | optional | Verifies Razorpay's server-to-server webhooks. A long random string **you** invent and then paste into their dashboard — deliberately separate from `RAZORPAY_KEY_SECRET`, because a webhook body is signed with a different secret and confusing the two produces a signature that never matches. | You invent it. | `a-long-random-string-you-invented` |

**Everything boots with all three unset.** The product runs, but no student can pay: the payment page says payment is unavailable, and `POST /payments/orders` returns 503 naming the missing variables. That is deliberate — "we chose to run this free" and "the keys are missing" are different situations, and the second must not silently admit everybody. To run genuinely free, switch the fee off at `/admin/payments`.

**The fee itself is not an environment variable.** ₹199 is the code default (raised from ₹100 on 2026-08-28); the live value lives in the `PaymentSettings` document and is changed at `/admin/payments`, with an audit entry. A price is business configuration, not a credential — in `.env` it would be a redeploy to change and would leave no record of who changed it.

**No webhook secret is set, and that is a supported configuration.** `POST /payments/reconcile` asks Razorpay directly what happened to an order, which covers the case a webhook exists for. Setting the secret later makes settlement automatic with no code change. See [`DECISIONS.md`](DECISIONS.md).

### Getting Razorpay TEST keys (do this first — no real money moves)

1. Go to **https://dashboard.razorpay.com** and sign in (or create an account — it is free; full KYC is only needed for Live mode).
2. Find the **Test Mode / Live Mode** toggle at the top of the dashboard and switch it to **Test Mode**. Do not skip this — Live mode moves real money.
3. In the left sidebar go to **Account & Settings** → **API Keys** (on some dashboards: **Settings** → **API Keys**).
4. Press **Generate Test Key**. A dialog shows a **Key Id** and a **Key Secret**.
5. **Copy the secret now.** Razorpay shows it exactly once; if you lose it you must regenerate, which invalidates the old one.
6. Open `backend/.env` and add:
   ```
   RAZORPAY_KEY_ID=rzp_test_...the key id you copied...
   RAZORPAY_KEY_SECRET=...the secret you copied...
   ```
7. Restart the backend (`npm run dev:local --prefix backend`).
8. Sign in as an administrator and open **/admin/payments**. The warning "Razorpay is not configured" should be gone.
9. Sign in as a student and open **/payment**. You should see the current fee — **₹199.00** unless an administrator has saved a different one at `/admin/payments` — and a working **Pay** button for that amount.
10. Pay with Razorpay's test card: **4111 1111 1111 1111**, any future expiry, any 3-digit CVV, any name. No money moves in Test Mode.
11. Check that Practice, Mock Tests and the Daily Challenge lose their padlocks, and that the payment appears at **/admin/payments** with status `captured`.

**One case worth testing on purpose**, because no automated test can cover it: start a payment, complete it, and **close the tab before the page returns**. Reopen `/payment`. It should find the payment and confirm your entry. That is the reconciliation path, and it is the difference between a student who paid getting what they paid for and getting nothing.

### Going live (only when you are ready to take real money)

1. Complete Razorpay's KYC. Live keys are not issued until it is approved.
2. Switch the dashboard to **Live Mode** and generate a **live** key pair the same way. They start `rzp_live_`.
3. Put them in the **backend** Vercel project → **Settings** → **Environment Variables**, for the **Production** environment. Not in any file, and never in the repository.
4. **Redeploy the backend** — Vercel does not apply new environment variables to a running deployment.
5. Confirm the fee at `/admin/payments` before announcing anything, and make one small real payment yourself to check the whole path end to end.

`RAZORPAY_KEY_SECRET` is a live credential once you reach step 2: never paste it into a repository, an issue, a screenshot or a chat.

---

## Invoices (Milestone 22, Phase C)

What is printed at the top of a student's invoice PDF. **Every one is optional and the invoice works
with none of them set** — the name, email and phone default to what the platform already publishes in
its own footer.

| Variable | Required? | What it does | Example (fake) |
|---|---|---|---|
| `INVOICE_ORG_NAME` | optional | The organisation name on the invoice. | `A.M.I.T Maths Olympiad` (the default) |
| `INVOICE_ORG_ADDRESS` | optional | Registered address. **Lines separated by `\|`.** Omitted from the document entirely when unset — an invoice with a blank address line looks like one that failed to render. | `2nd Floor, 14 Example Road\|Jaipur, Rajasthan 302001` |
| `INVOICE_ORG_EMAIL` | optional | Contact address printed on the invoice and quoted in its footer. | `support@amitolympiad.com` (the default) |
| `INVOICE_ORG_PHONE` | optional | Contact number. | `+91 9782870716` (the default) |
| `INVOICE_GSTIN` | optional | GST registration number. **Never defaulted.** With it set the document is titled `TAX INVOICE` and the number is printed; with it unset the document is titled `INVOICE` and says nothing about tax at all. | `29ABCDE1234F1Z5` |
| `INVOICE_TAX_NOTE` | optional | One line of tax or legal wording, printed verbatim under the total. Free text, because only your accountant knows what is correct. | `Not registered for GST.` |

**Nothing about tax is invented.** With `INVOICE_GSTIN` and `INVOICE_TAX_NOTE` unset the invoice
carries no tax line, no rate and no "inclusive of all taxes" — each of which would be a legal claim
the code is in no position to make on your behalf. Set them once you know what is right.

**Why these are environment variables when the fee deliberately is not.** The fee is a *price*: it
changes, needs an audit trail, and is decided by someone who should not need a redeploy — so it lives
in an administrator-editable document. A registered address and a tax registration change roughly
never, are decided once, and must be **absent** rather than wrong; an unset variable prints nothing,
whereas an empty settings field would print an empty line on a financial document.

## Bulk question import (Milestone 21, Phase B)

Two optional variables, both with working defaults. **Neither is a secret**, and there is no new
credential: the image importer reuses `GEMINI_API_KEY` and `GEMINI_MODEL` rather than introducing a
second one.

| Variable | Required? | What it does | Where to get it | Example |
| --- | --- | --- | --- | --- |
| `IMPORT_MAX_QUESTIONS` | optional (default `200`, max `500`) | The most questions one bulk import may offer for review. Lower it on a smaller serverless plan. The *ceiling on the ceiling* is `IMPORT_HARD_MAX` in code, because a review step nobody can realistically finish is not a review step. | — | `200` |
| `IMPORT_RATE_LIMIT_PER_HOUR` | optional (default `20`) | Import uploads allowed per hour, per IP. | — | `20` |

**Why the second one matters more than it looks.** An upload is the most expensive request in the
product on two counts: it decompresses an archive and validates hundreds of rows, and the **image** path
spends Gemini quota *per file* — so one request carrying ten photographs is ten model calls. That is the
same property `GENERATION_RATE_LIMIT_PER_HOUR` exists for. If you are watching a free-tier quota, this
is the knob that bounds an afternoon of importing.

Neither needs to be set for the feature to work. Add them to Vercel only if you want to change a
default, and — as with every backend variable — **never to the frontend project**, which reads no
environment variables at all.
