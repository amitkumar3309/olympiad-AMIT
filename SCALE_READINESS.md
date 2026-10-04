# SCALE_READINESS.md

_Written 2026-09-27. A full test pass of frontend + backend + database, and the plan for
carrying **1,000 concurrent students** without the platform falling over._

This file is a **report and a plan**. It was written before any fix was applied.

> **Both P0 fixes were applied on 2026-09-27 and verified live.** `app.set('trust proxy', 1)`
> is in `src/app.ts` and `maxPoolSize: 5` / `maxIdleTimeMS: 30_000` are in `config.mongo`,
> consumed by `db/connection.ts`. What the verification showed, on the same commands that
> exposed the defects:
>
> - Five requests from three distinct `X-Forwarded-For` addresses now draw on **three separate
>   budgets** (`299, 299, 298, 298, 299`), where before one counter fell `146 → 145 → 144`.
> - **Fourteen** sign-ins from fourteen distinct client addresses all returned `200`. Before the
>   fix the same sequence gave one `200` and thirteen `429`s.
> - Brute-force protection is intact: twelve attempts from **one** address gave exactly **10
>   through and 2 blocked**.
> - The audit trail records the real client address (`49.37.200.15`) instead of the proxy.
> - After 60 concurrent requests, MongoDB reported **9** open connections across every client,
>   against 121 measured before the cap.
>
> Gates after the change: typecheck, lint and compile clean, the 87-assertion end-to-end harness
> still **87/87**, and the suite still **1289/1289**.
>
> **Phase C then raised `loginLimiter` from 10 to 50 per 15 minutes**, because Phase B is what
> first gave that number a real client address to apply to. A 40-student school lab behind one NAT
> address now signs in completely (40/40, against 10/40 before), one address still stops at
> exactly 50, and per-account lockout still fires at 5 — it is `MAX_FAILED_LOGINS`, not this
> limiter, that stops password guessing.
>
> **Step 3 (the `Student.status` index) and step 4 (Redis) are still outstanding**, as is
> `registerLimiter`, which has the same NAT problem at 10 per hour.


---

## Part 1 — What was tested, and what passed

Everything below was run on this machine against a **real MongoDB** (the local
`amit-olympiad-local` database), a real backend process and the real Vite frontend — not mocks.

| Check | Command | Result |
|---|---|---|
| Backend unit + integration suite | `npm test --prefix backend` | **1289 passed / 1289, 36 files, 235s** |
| Backend typecheck (incl. tests) | `npm run typecheck --prefix backend` | **pass** |
| Backend build compile | `npm run compile --prefix backend` | **pass** |
| Backend lint | `npm run lint --prefix backend` | **pass, 0 problems** |
| Frontend lint | `npm run lint --prefix frontend` | **pass**, 3 pre-existing fast-refresh warnings |
| Frontend production build | `npm run build --prefix frontend` | **pass**, 236 kB main bundle / 73.5 kB gzipped |
| End-to-end API pass (live stack) | custom harness, 87 assertions | **87 passed / 87** |
| Browser pass (live stack) | landing, register, sign-in, dashboard, practice, leaderboard, admin gate | **all render, no errors** |

### The end-to-end pass, in detail

A throwaway harness drove the real HTTP API end to end. All 87 assertions passed:

- **Registration → sign-in → session** — a real account is created (`AMIT_2094`), registration
  deliberately creates **no** session, a duplicate is refused, a weak password is refused with
  *every* failing rule listed in one pass, sign-in sets both cookies.
- **Account-existence secrecy** — an unknown email and a wrong password return the **identical**
  message. Verified byte-for-byte.
- **CSRF origin gate** — a `POST` carrying `Origin: https://evil.example.com` is refused **403**;
  a `GET` from the same origin is not blocked. Working as designed.
- **The answer key never leaks** — a served practice paper was scanned for `isCorrect`,
  `solution`, `booleanAnswer`, `numericAnswer`, `tolerance`. **None present.** After submission,
  the review view does reveal them. This is the single most important property in the product and
  it holds.
- **Grading is real** — 5 questions answered, submitted, scored 2, reviewable.
- **The paywall holds** — an unpaid student starting the official exam gets **402** (not 403, so
  the UI can offer a pay button); practice and the daily challenge are **not** gated. Exactly as
  documented.
- **Authorization** — an unauthenticated caller, and a signed-in *student*, are both refused every
  admin route, on **both** the `/api/v1` and the `/api` alias. The bootstrap superadmin is refused
  at the public sign-in form. A student cannot reach the destructive reset.
- **28 admin endpoints** answered 200 under a superadmin session, including the two ordering traps
  (`/admin/questions/practice-availability` is not swallowed by `/:id`).
- **Leaderboard invariants** — an anonymous caller is capped at 100 rows, no email or mobile is
  published, names are masked (`Scale S.`), equal XP shares a rank.
- **Session lifecycle** — refresh rotates the token, **the old token is dead on replay**, logout
  invalidates.
- **Error handling** — unknown routes, bogus student IDs and malformed ObjectIds all return the
  `{ success: false, error }` envelope and **never 500**.

### The browser pass

Signed in as a seeded Class 9 student against the live backend. The dashboard rendered the full
set — level 3, 435 XP, a 5-day streak, rank **#1 of 1,004 ranked**, achievements, today's
challenge with a live countdown, real practice availability ("73 questions ready for Class 9"),
the activity feed and a masked leaderboard. `/leaderboard` paginated correctly over 1,004
students. `/practice` offered real per-chapter counts. `/admin` as a student showed the
"not an administrator" card rather than a redirect loop — the Milestone 28 fix, verified live.

**No product defects were found by the functional testing.** Everything below is about *scale*.

---

## Part 2 — The load test

A cohort-sized dataset was seeded into the local database: **1,000 students and 20,012
`StudentActivity` rows**. Then sustained load was driven at 1 / 25 / 100 / 250 concurrent
clients against a single backend process.

> **Rate limiting had to be switched off for this measurement**, because it stops the platform
> long before the database does — which is finding #1 below.

### Read path — requests per second and latency

| Endpoint | 1 client p50 | Ceiling (req/s) | p50 at 250 concurrent |
|---|---:|---:|---:|
| `GET /health` (no database) | 0.2 ms | **8,715** | 25 ms |
| `GET /auth/me` | 1.9 ms | **1,205** | 238 ms |
| `GET /exams` | 2.0 ms | 945 | 322 ms |
| `GET /me/daily-challenge` | 3.1 ms | 825 | 396 ms |
| `GET /practice/options` | 3.7 ms | 916 | 368 ms |
| `GET /me/rewards` | 4.1 ms | 497 | 556 ms |
| `GET /public/stats` | 10.6 ms | 228 | 690 ms |
| **`GET /leaderboard?limit=3`** | **106 ms** | **30** | **10,345 ms** |
| **`GET /leaderboard?limit=50`** | **140 ms** | **31** | **9,002 ms** |
| **`GET /me/dashboard`** | **116 ms** | **33** | **10,435 ms** |

Zero errors at every level — nothing crashed, nothing leaked. But the bottom three rows are
**30–100× more expensive than everything else, and they sit on the two most-visited pages in
the product**: `/leaderboard` is on the public landing page, `/me/dashboard` is where every
signed-in student lands.

### Write path — the exam scenario

100 distinct students, each with a live 10-question session, saving answers continuously:

```
answer saves    148 writes/second    p50 669 ms   p95 1276 ms   max 1590 ms   0 errors
100 simultaneous submissions        all complete in 0.7 s        0 errors
```

The write path is **healthy**. The end-of-exam "thundering herd" — 100 papers submitted in the
same instant — completed in under a second with no failures. The conditional-write design
(`finalizeAttempt` filtering on `status: 'in_progress'`) does its job.

### Sign-in cost

`bcryptjs` verification at the production cost of 12:

```
cost 4  →    2 ms per verify   (test setting)
cost 10 →   65 ms per verify
cost 12 →  239 ms per verify   ← production
```

A real sign-in against the dev server measured **321 ms**. 1,000 students signing in at 9:00 AM
is roughly **four CPU-minutes** of password hashing. This is not a bug — cost 12 is the correct
security choice, and the code already uses the *async* bcrypt API so the event loop stays
responsive — but it is a capacity fact to plan for.

---

## Part 3 — Findings, worst first

### ✅ P0-1 — FIXED 2026-09-27. Every student in the country shared one rate-limit bucket

**`app.set('trust proxy', …)` is never called** (confirmed: no occurrence anywhere in `backend/src`).
Express therefore reports `req.ip` as the *socket* address. Behind Vercel's proxy that is an
internal address which is **the same for every visitor on the planet**, and
`express-rate-limit` keys on `req.ip`.

Reproduced on the running server — three requests, three different `X-Forwarded-For` values:

```
XFF=203.0.113.10  -> RateLimit-Remaining: 146
XFF=198.51.100.77 -> RateLimit-Remaining: 145      ← should have been its own 300
XFF=203.0.113.10  -> RateLimit-Remaining: 144
```

One counter, shared. And then, ten distinct client IPs attempting to sign in:

```
attempt 1  (203.0.113.1)  -> 200
attempt 2  (203.0.113.2)  -> 429  <-- RATE LIMITED
attempt 3  (203.0.113.3)  -> 429
…all the way to attempt 13
```

**What this means on launch day**, with the limits currently in `middleware/rateLimiter.ts`:

| Limiter | Configured as | What it actually is today |
|---|---|---|
| `loginLimiter` | 10 per 15 min **per IP** | 10 sign-ins per 15 min **for the whole platform** |
| `registerLimiter` | 10 per hour per IP | 10 registrations per hour, total |
| `emailActionLimiter` | 5 per hour per IP | 5 verification resends per hour, total |
| `generalLimiter` | 300 per 15 min per IP | 300 API calls per 15 min, total |

A student dashboard makes **5 API calls**. The general limiter alone would be exhausted by
**sixty students** loading their dashboard once. The 11th student to sign in nationally gets
"Too many login attempts."

This is not a performance problem. It is a **guaranteed outage on the first busy morning.**

**The fix is two lines** (see Part 4, step 1).

### 🔴 P0-2. The rate limiter's memory store cannot work on serverless (STILL OPEN — needs Redis)

`express-rate-limit` is used with its default `MemoryStore`. On Vercel each serverless instance
has its own memory, so:

- limits are enforced **per instance**, not per platform — with 40 warm instances the real limit
  is 40× what is written;
- every **cold start resets the counter to zero**, which I reproduced by restarting the backend
  (a 429'd client became 200 immediately);
- so the limits are simultaneously **too strict for real students** (P0-1) and **useless against
  an attacker**, who simply spreads requests and rides the cold starts.

**This is the case for Redis.** A shared store is the only way a limit means anything across
instances. See Part 4, step 4.

### ✅ P0-3 — FIXED 2026-09-27. Database connection exhaustion

**No `maxPoolSize` is set anywhere** (confirmed: no occurrence in `backend/src` or `backend/scripts`).
Mongoose therefore defaults to **100 connections per process**.

Measured live: three local Node processes were holding **121 open connections** to MongoDB.

On Vercel, every concurrent serverless instance opens its own pool:

| Concurrent Vercel instances | Connections requested | MongoDB Atlas M0/M2/M5 limit |
|---:|---:|---:|
| 5 | 500 | **500 — cap reached** |
| 50 | 5,000 | 500 |
| 200 | 20,000 | 500 |

Past the cap, Atlas **refuses new connections** and requests fail outright. This is a hard wall,
not a slowdown, and 1,000 concurrent students will comfortably produce more than 5 instances.

**Fix:** `maxPoolSize: 5` in `connectDB()` (Part 4, step 2) plus a paid Atlas tier for the real
sitting.

### 🟠 P1-4. The leaderboard and dashboard are full collection scans, run 3–5× per request

The leaderboard is deliberately **derived on read with nothing stored** — that is a *good*
decision (recorded in `DECISIONS.md`) because a stored rank can drift from the XP it ranks. The
cost of it is real, and measurable:

```
the leaderboard pipeline:  COLLSCAN,  totalDocsExamined = 20,012  +  1,004 $lookup fetches,  ~100 ms
```

`$group` over every activity row can never use an index for its `$sum`. And the service runs
that pipeline **more than once per request**:

- `getLeaderboardPage()` = 1 (rows) + 1 (`countMatching` for the total) + 1 (`countMatching` for
  the first rank) = **3 full passes**
- `getStudentRank()` on the dashboard = **2 more**

At 20,012 rows that is 100 ms. A real season — 1,000 students visiting daily, practising, sitting
mocks over three months — is **100,000–200,000 rows**, so expect **0.5–1 second per pass**.

Measured ceiling today: **~30 requests/second**. 1,000 students loading the landing page need
1,000 leaderboard calls; at 30/s that is **33 seconds of queue**. The page appears to hang.

**Fix:** cache the result in Redis for 30–60 seconds. A leaderboard that is one minute stale is
not wrong in any way a student can perceive — and this is the highest-value cache in the product.

### 🟠 P1-5. `/public/stats` is two unbounded collection scans, unauthenticated, on the landing page

`getPublicStats()` in `services/progressService.ts` runs four queries, and two of them scan every
student document. Confirmed with `explain`:

```
students countDocuments({status:'active'})          COLLSCAN   docsExamined=1005
students distinct('schoolName', {status:'active'})  COLLSCAN   docsExamined=1005
```

There is **no index on `Student.status`** (the students collection has indexes on `mobile`,
`email`, `studentId`, `role`, `referralCode`, `registeredAt` and `classLevel+registeredAt` — but
not `status`). `distinct()` is also unbounded: it builds an array of every distinct school name
in memory.

It is 3 ms at 1,000 students. At 50,000 it is ~150 ms × 2, on the most public page in the product,
with no authentication in front of it.

**Fix:** an index on `status`, and a 5-minute Redis cache. These figures change slowly; there is
no reason to recompute them per visitor.

### 🟡 P2-6. Vercel's free tier does not permit commercial use

The platform charges a **₹199 entry fee**. Vercel's Hobby plan is for non-commercial projects
only. Running a paid product on it risks the deployment being suspended — on launch day, with no
warning. This is a licence problem, not a technical one, and it is worth naming because the
project's stated target is ₹0 spend.

**Vercel Pro is US$20/month per member.** See Part 5 for the realistic budget.

### 🟡 P2-7. The email queue's throughput is tied to request traffic

`services/emailOutbox.ts` drains on three triggers: at enqueue (held open by `keepAlive`), on a
sweep from later requests (`middleware/outboxSweep.ts`), and by an explicit staff drain. This is
well designed and the Milestone 25 fix is real.

The capacity question is different: **1,000 registrations in an hour is 1,000 verification
emails**, and free SMTP relays cap well below that — Gmail/Workspace is ~500/day, Brevo's free
tier 300/day, Resend's free tier 100/day. Students who never receive a link **cannot sign in at
all**, because verification is required.

**Fix:** size the mail provider for the cohort *before* opening registration. See Part 5.

### 🟡 P2-8. Still no CSRF token (known, documented, partially mitigated)

`SECURITY.md` records this as the top open gap. What exists is `middleware/csrf.ts`, an
**Origin/Referer check**, and I verified it works: a cross-origin `POST` is refused 403.

Browsers always send `Origin` on cross-site state-changing requests, so this blocks the realistic
browser CSRF attack. The residual gap is a request with **no** `Origin` header at all, which the
middleware lets through by design (so non-browser clients work). That is a deliberate,
documented trade-off, not a new finding — but it should be re-reviewed before a paid product
carrying children's data goes live at scale.

### 🟢 What is already right, and should not be "optimised" away

Worth stating, because a scaling pass is where good decisions get broken:

- **No HTTP polling in the frontend.** The four `setInterval`s are local countdown timers, not
  network calls. The platform does not multiply its own load. Do not add a polling notification
  bell.
- **Routes are lazy-loaded** — 236 kB main bundle, 73.5 kB gzipped. Good.
- **Conditional writes, not read-then-write**, on every path that must happen once. This is what
  made 100 simultaneous submissions land cleanly.
- **Snapshotted answer keys and XP amounts** — re-pricing cannot rewrite history, and a cache
  cannot corrupt a mark.
- **Derived-on-read entitlement and ranking** — no `hasPaid` flag, no `Leaderboard` collection.
  Caching must not turn into storing; a cache expires, a stored boolean does not.

---

## Part 4 — The plan, step by step

Ordered by *outage prevented per line changed*. Steps 1–3 are free and small. Step 4 is where
Redis enters.

### ✅ Step 1 — Trust the proxy (APPLIED 2026-09-27)

In `backend/src/app.ts`, immediately after `const app = express();`:

```ts
/**
 * Vercel terminates TLS and proxies to this function, so the socket address is
 * Vercel's, not the student's. Without this, `req.ip` is identical for every
 * visitor — which makes every per-IP rate limit a single platform-wide bucket
 * (the 11th sign-in of the day got a 429) and writes a useless IP into every
 * audit row. `1` = trust exactly one proxy hop, which is what Vercel is; `true`
 * would trust a client-supplied X-Forwarded-For and let anyone forge their IP.
 */
app.set('trust proxy', 1);
```

**Verify it worked** (after deploying, or locally):

```bash
curl -s -D - -o /dev/null -H "X-Forwarded-For: 203.0.113.10" http://localhost:8081/api/v1/public/stats | grep -i ratelimit-remaining
```

Run it twice with two *different* `X-Forwarded-For` values. Before the fix the number keeps
falling. After the fix each address gets its own fresh count.

> ✅ **`loginLimiter` was re-tuned to 50 per 15 minutes on the same day (Phase C).** Its old 10
> was right for one person and wrong for **a school computer lab behind one NAT address**, where
> 40 children legitimately share a public IP. Measured: **40 of 40 now sign in**, against 10 of 40
> before; 55 attempts from one address still stop at exactly **50**; and twelve wrong passwords
> against one account still lock it after **5**, because `MAX_FAILED_LOGINS` — not this limiter —
> is what stops password guessing.
>
> ✅ **`registerLimiter` was raised to 50 per hour too (Phase D)**: 40 of 40 now register, ceiling
> at 50. But note the real constraint is the **mail quota** — every registration sends a
> verification email and a transactional tier is measured in hundreds per day.
>
> ⚠️ **Seven more limiters have the same shape and were NOT changed.** Students supported on one
> shared school address: `paymentLimiter` **30**, `challengeLimiter` **30**, `mockTestLimiter`
> **30**, `tokenSubmitLimiter` **20**, `emailActionLimiter` **5**; `practiceLimiter`,
> `generalLimiter` and `refreshLimiter` are borderline at ~60. **`paymentLimiter` is the one to
> fix next** — it is the only row whose refusal costs revenue. Full table in `CHANGELOG.md`,
> Milestone 29 Phase D.

### ✅ Step 2 — Cap the connection pool (APPLIED 2026-09-27)

In `backend/src/db/connection.ts`, inside `mongoose.connect(...)`:

```ts
connectingPromise = mongoose.connect(config.mongoUri, {
  serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS,
  /**
   * Serverless multiplies this. Mongoose defaults to 100 *per process*, and every
   * concurrent Vercel instance is its own process — five instances would exhaust
   * an Atlas shared tier's 500-connection cap and start refusing connections
   * outright. A serverless instance handles one request at a time, so a small pool
   * costs nothing and is what lets the platform scale out instead of falling over.
   */
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 30_000,
});
```

With `maxPoolSize: 5`, 500 connections supports **100 concurrent instances** instead of 5.

**Verify:** watch Atlas → Metrics → Connections during a busy period. It should plateau, not climb.

### ⏳ Step 3 — Index what the landing page scans (NOT YET APPLIED)

In `backend/src/models/Student.ts`, beside the existing indexes:

```ts
// `/public/stats` filters every one of its figures on this, and it was a COLLSCAN.
studentSchema.index({ status: 1 });
```

Mongoose builds it on the next connection with `autoIndex` on. On a large production collection,
build it in Atlas with `background: true` first so the build does not block writes.

### ⏳ Step 4 — Add Redis (NOT YET APPLIED — awaiting your decision)

This is the step that needs your decision, because it adds a dependency and (possibly) a cost.
Redis buys you **three** things in this product, in this order of value:

1. **A shared rate-limit store** → the limits become real across instances and survive cold starts (fixes P0-2).
2. **A leaderboard / stats cache** → the 30 req/s ceiling becomes effectively unlimited (fixes P1-4, P1-5).
3. Later, if wanted: a session-revocation list, or a queue.

#### 4a. Choose a provider

**Upstash Redis** is the right fit and I would pick it without hesitation:

- **serverless-native** — it speaks HTTP as well as the Redis protocol, so a Vercel function does
  not need a held-open TCP connection (which is the reason ordinary Redis is awkward on serverless,
  for exactly the same reason as P0-3);
- there is a **free tier** sized for exactly this kind of caching, and pricing is
  pay-as-you-go per command after it;
- it is available **as a Vercel Marketplace integration**, so the environment variables are wired
  in for you.

> **Check the current free-tier numbers on their pricing page when you sign up** — Upstash has
> changed them more than once and I would rather you read today's figure than trust mine. The
> shape to check against: 1,000 students × roughly 20 page loads a day, each costing **one**
> Redis read (that is the whole point of the cache), is on the order of **20,000 commands a day**.
> If the free tier is below that, this is a few dollars a month, not a real cost.

#### 4b. Set it up (beginner steps — you do these in a browser, I cannot)

1. Go to **https://vercel.com/dashboard** and open your **backend** project (the one with
   `backend/vercel.json`, not the frontend).
2. Click the **Storage** tab → **Create Database** → choose **Upstash → Redis**.
   *(Or go to https://upstash.com, sign up free, and click **Create Database** there instead —
   pick a region **physically near your Atlas cluster**, e.g. `ap-south-1` Mumbai if your
   students are in India. Latency between them is added to every cached request.)*
3. Name it something like `amit-olympiad-cache`. Choose **Regional**, not Global — you have one
   region and Global costs more.
4. Click **Connect** and attach it to the **backend** project. Vercel writes the credentials into
   the project's environment variables automatically. Note the names it creates; they are usually
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.
5. Copy those two values. In Vercel → your backend project → **Settings → Environment Variables**,
   confirm they are present for **Production** *and* **Preview**.
6. Tell me the two variable names. I will then:
   - add them to the zod schema in `config/env.ts` (**optional**, so the app still boots without
     them — see 4c);
   - add them to `backend/.env.example` and `ENVIRONMENT_VARIABLES.md`, as this project's rules
     require;
   - write an ADR in `DECISIONS.md` recording why a cache was added and what it may never be used
     for.

#### 4c. The one rule that must travel with the code

**Redis must be optional, and the platform must be fully correct without it.**

That is not caution for its own sake — it is the same rule this codebase already applies to
`GEMINI_API_KEY` ("the rest of the product must stay complete with no AI credential"). If Redis
is down and the site is down with it, you have replaced one dependency with two. A cache miss,
a timeout and an unconfigured cache must all fall through to the existing query.

Concretely, the shape to build:

```
src/lib/cache.ts        THE cache seam. get/set/del with a TTL, and a `withCache(key, ttl, fn)`
                        helper. Unconfigured or failing -> calls fn() directly. NEVER throws.
                        Never caches anything a student could be shown as their own: the
                        leaderboard is public, a dashboard is not.
```

Then the three call sites, in this order:

| What | Key | TTL | Why safe |
|---|---|---|---|
| `getLeaderboardPage()` | `lb:{scope}:{period}:{class}:{page}:{limit}` | 60 s | A public board one minute stale is imperceptible; nothing is decided from it. |
| `getPublicStats()` | `stats:public` | 300 s | Registration counts on a marketing page. |
| `generalLimiter` + friends | handled by the store, not by you | — | See 4d. |

**Do not cache** `/me/dashboard`, `/me/rewards`, an attempt, a question paper, a payment state or
an entitlement. Anything keyed to one student is a disclosure bug waiting for a key collision, and
money and marks must never be read from a cache.

**Invalidate on write:** `grantReward()` is the only thing that changes XP, so it is the one place
that should delete the `lb:*` keys. Everything else can expire on its own.

#### 4d. Switch the rate limiters onto Redis

```bash
npm install --prefix backend @upstash/redis rate-limit-redis
```

`express-rate-limit` takes a `store`. Point the shared store at Redis in
`middleware/rateLimiter.ts`, keeping the existing per-limiter windows and messages. **Fall back
to `MemoryStore` when Redis is unconfigured**, same rule as 4c.

Expected effect, measured against today's numbers:

| | today | after step 1 | after step 4 |
|---|---|---|---|
| sign-ins before a 429 | 10, platform-wide | 10 per IP, per instance, reset by cold starts | 10 per IP, platform-wide, durable |
| `/leaderboard` ceiling | 30 req/s | 30 req/s | **thousands** (one DB pass per minute) |
| `/public/stats` ceiling | 228 req/s | 228 req/s | **thousands** |

### Step 5 — About the load balancer

**You do not need one, and adding one would be a step backwards.**

A load balancer distributes traffic across servers you run. Vercel already does that: each
deployment is a serverless function that the platform scales out automatically, behind its own
global edge network and CDN. There is no fixed server to balance. Introducing Nginx, an ALB or a
Kubernetes ingress would mean *leaving* serverless and taking on capacity planning, patching and
failover that you currently get for free.

What you need instead of a load balancer is:

1. **Enough backing capacity for the things that do not auto-scale** — the database (step 2 and
   Part 5) and the mail provider (P2-7);
2. **A cache so the fan-out does not all land on the database** (step 4);
3. **Correct per-client limits so the auto-scaling is not fighting your own users** (step 1).

The one scaling knob genuinely worth setting on Vercel is **Fluid compute / function concurrency**,
and the region: put the backend function in **`bom1` (Mumbai)** if your students are in India, and
put Atlas and Upstash in the same region. Every cross-region hop is ~50–150 ms added to *every*
database round trip, and the dashboard makes several.

### Step 6 — Re-measure before you open the doors

Re-run the same harness against the **deployed** backend a week before the sitting, at the real
cohort size. The scripts used for this report are in the session scratchpad; say the word and I
will commit cleaned-up versions to `backend/scripts/` so they are repeatable.

What to watch during the sitting:
- Atlas → Metrics → **Connections** (should plateau well under the cap) and **Opcounters**
- Vercel → **Logs**, filtered to 429 and 5xx — any 429 at all means a limit is mis-set
- Upstash → command count against the daily ceiling

---

## Part 5 — What 1,000 students actually costs

The project's standing target is ₹0, with Razorpay as the single approved exception. Honest
figures for a real sitting:

| Service | Free tier | What 1,000 students needs | Realistic cost |
|---|---|---|---|
| **Vercel** | Hobby — **non-commercial only** | **Pro** (you charge a fee) | **US$20/mo** |
| **MongoDB Atlas** | M0 — 512 MB, 500 conns, shared CPU | M0 *may* hold with step 2; **M10 for exam day** | $0, or **~$57/mo** for M10 |
| **Upstash Redis** | a free tier — check today's figure | ~20k commands/day | $0–5/mo |
| **SMTP** | Brevo 300/day, Resend 100/day | 1,000 verification emails in a burst | **~$15–25/mo** (Brevo Starter / Resend Pro) |
| **Razorpay** | — | ~2% + GST per transaction | already approved |

**Minimum to be safe and legitimate: about US$35–45/month**, or roughly ₹3,000–4,000. Against
1,000 × ₹199 = **₹199,000** of entry fees, that is under 2% of revenue.

My recommendation, in order: **Vercel Pro first** (it is a licence issue, not a performance one),
**then the mail provider** (a student who never gets a verification link cannot sign in at all and
will ask for a refund), **then Atlas M10 for the exam window only** — you can scale a cluster up
for a week and back down afterwards, and pay for the week.

---

## Part 6 — Answering the question directly

> _"I don't want things to crash or anything to become vulnerable."_

**Will it crash at 1,000 concurrent students, as it stands today?** Yes — but not for the reason
you would expect. The database and the application code are *fine*: 1,289 tests pass, the write
path handled 100 simultaneous exam submissions in 0.7 seconds with zero errors, and no functional
defect was found anywhere. What fails is the **rate limiter**, which today treats the entire
internet as one visitor and will start returning "Too many login attempts" at roughly the **11th
student**, followed by connection exhaustion at Atlas once Vercel scales past five instances.

**Is it vulnerable?** The security fundamentals are genuinely strong — the answer key never
reaches a client early, grading is server-side, authorization re-reads the role from the database,
tokens rotate and replays are dead, account enumeration is closed, the paywall is mounted rather
than called, and public boards mask children's names. I could not find a way through any of them.
The open items are the **documented** CSRF-token gap (partly mitigated by a working Origin check)
and the fact that, until step 1 lands, the per-IP protections are not per-IP at all — which is a
brute-force exposure as much as an availability one, since a cold start resets the counter.

**The shortest path to safe:** steps 1, 2 and 3 are **four lines of code** and remove both P0
outages. Step 4 (Redis) removes the 30 req/s ceiling on your two busiest pages. Nothing here
requires rearchitecting anything, and none of it touches the product decisions the codebase has
been careful about.
