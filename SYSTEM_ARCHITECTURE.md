# SYSTEM_ARCHITECTURE.md

_Last updated: 2026-08-15 (Milestone 16 — the recommendation engine seam). The topology and middleware sections were last revised in Milestone 9 and the inventory below has lagged since: read counts from the code, not from here — see [`PROJECT_STATE.md`](PROJECT_STATE.md) for verified ones._

Documents what **actually exists** in the repository today. Anything not literally in the code is marked `PLANNED`.

## Refer & Earn — CURRENT (Milestone 22, Phase E; backend only)

```
Registration                             Payment capture
  POST /auth/register { referralCode? }     capturePayment()  <- the ONE place money becomes real
        |                                        |
        v                                        v
  attributeReferral()                      onEntryPaymentCaptured()
    resolve code -> active Student only       conditional on rewardStatus = pending_conversion
    refuse self-referral                      snapshot rewardAmount from ReferralSettings
    Referral.create()                         -> 'accrued' if a reward is configured
      ^ unique index on `referred`            -> 'no_reward' if not
        = one referrer, no duplicates,        (never throws into the payment path)
          never reassigned
        |
        v
   Referral  ── read paths reconcile a stale `pending_conversion` row against Payment
        |
        +-- GET /me/referrals            (identity gate; referred students MASKED)
        |     ^ the student page at /referrals (Phase F)
        +-- GET /referrals/validate      (public, rate limited, masked name)
        |     ^ the register page at /register?ref=<code> (Phase F), which checks the
        |       code BEFORE the form is filled and sends it only once confirmed —
        |       the backend refuses the whole registration on one that does not resolve
        +-- GET /admin/referrals         (students:read; referredHasPaid DERIVED)
        +-- POST /admin/referrals/:id/{approve,mark-paid,reject}
        |                                (referrals:write; conditional writes; audited)
        +-- GET/PUT /admin/referral-settings   (read: students:read, write: referrals:write)
              ^ all four served by the console at /admin/referrals (Phase G), which puts
                the settings beside the totals they accrued and offers only the
                transitions the API accepts — it can move a reward, never invent one
```

Three properties this shape exists for:

1. **The abuse rules are an index, not checks.** One unique field enforces three of them at once,
   and a read-then-write could not.
2. **Conversion follows the money, not the registration.** It hangs off the single idempotent capture
   point, and deliberately does not consult `hasEntryEntitlement()` — which is `true` when the
   paywall is switched off, and would pay out on every registration.
3. **The amount is a snapshot and no request may supply one.** The administrative routes move a row
   along a fixed path; they cannot create a reward or choose its value.

## Brand naming — CURRENT (Milestone 22, Phase D)

`frontend/src/lib/brand.ts` is the only definition of the platform's name:

```
frontend/src/lib/brand.ts
   AMIT_SHORT      'A.M.I.T'
   AMIT_FULL_FORM  'Advance Mathematics and Intelligence Test'
        |
        +-- pages/Landing/Landing.tsx   the hero line — the ONLY visible use
        +-- components/Navbar.tsx       alt + title only; the wordmark stays four letters
        +-- components/Footer.tsx       AMIT_SHORT only

frontend/index.html   <- the ONE literal copy: static, served before any JS runs.
                         Both files carry a comment naming the other.
```

**A name is displayed, not glossed.** A first version broke the letters into boxes with explanatory
paragraphs in an About section and repeated the full form in the footer; the owner rejected it. Do
not reintroduce a per-letter breakdown or an explanation of the acronym without asking.

The backend has no copy of the expansion. `INVOICE_ORG_NAME` and the certificate PDF still read
`A.M.I.T Maths Olympiad`, deliberately: those are documents people keep, and changing what is printed
on one is a decision of its own rather than a consequence of a landing-page edit.

## The content reset — CURRENT (Milestone 22)

```
Admin page (Questions / MockTests / DailyChallenges / Taxonomy)
   |
   |  <ResetPanel scope="..." />        <- one shared component, four pages
   |     hidden unless can('content:reset')
   v
GET /api/v1/admin/reset/:scope/preview   (writes nothing)
   |
   v
services/contentResetService.ts
   |  previewReset(scope)
   |     counts every collection involved  -> deletes[]  (text agrees with its count)
   |     counts what depends on the scope  -> blockers[] (+ the scope to reset first)
   |     names what survives               -> preserves[]
   v
POST /api/v1/admin/reset/:scope   { confirm: "RESET CHAPTERS" }
   |  requirePermission('content:reset')   <- SUPER ADMIN ONLY
   |  adminActionLimiter
   |  exact phrase compared in the route
   v
performReset(scope)
   |  re-runs previewReset() and refuses on any blocker (409)   <- the dialog may be stale
   |  deleteMany, DEPENDENTS FIRST (no transaction available)
   v
recordAudit('content.reset', { scope, totalDeleted, deleted: {...} })
```

The dependency order is the whole design: **daily challenges → mock tests → questions → chapters**.
Each scope refuses while anything downstream of it exists, so emptying everything is four deliberate
acts rather than one click with a cascade behind it. The official exam sits outside the graph — it is
a blocker with no resolution, because its results and certificates are permanent.

## Student invoices — CURRENT (Milestone 22, Phase C)

```
Student browser (/payment)            Admin browser (/admin/payments)
   |  GET /me/invoices                    |  GET /admin/payments/:id/invoice
   |  GET /me/invoices/:paymentId         |     (requirePermission 'students:read')
   |  GET /me/invoices/:paymentId/download
   v                                      v
routes/v1/payments.routes.ts  ---- one sendInvoicePdf() helper (no-store headers)
   |
   v
services/invoiceService.ts
   |
   |  Payment.findOne({ _id, student })   <- ownership IS the query, so a changed id is 404
   |  status must be 'captured'           <- otherwise 409 naming the state
   |  invoiceNumberFor(payment)           <- derived: AMIT-INV-<year>-<12 hex of _id>
   |  buildInvoice(payment, student)      <- money from Payment (snapshot),
   |                                         address block from live Student
   |
   +-- invoiceView()      -> JSON preview
   +-- renderInvoicePdf() -> pdf-lib -> A4 PDF
```

There is **no `Invoice` collection**. Both outputs come from one `InvoiceData`, so the preview a
student reads cannot differ from the file they keep — the same rule that puts one pipeline behind the
student directory and its export.

## Admin student directory — CURRENT (Milestone 22, Phase B)

```
Admin browser (/admin/users)
   |
   |  GET /api/v1/admin/students?classLevel=&paymentState=&registeredFrom=&sort=&page=
   |  GET /api/v1/admin/students/export?<same filters>&scope=filtered|all
   v
routes/v1/users.routes.ts          <- export declared BEFORE /admin/students/:studentId
   |                                  (Express matches in order; otherwise "export" is read as an id)
   v
services/studentDirectoryService.ts   ONE pipeline, both routes
   |
   |  $match (validated student filter)
   |  $lookup payments  (purpose: olympiad_entry, newest first, projected by name)
   |  $addFields        capturedPayments / refundedPayments
   |  $addFields        paymentState (derived), payment (capture or latest), paymentAttempts
   |  $match            paymentState, if the administrator asked for one
   |  $sort             allow-listed field + _id tiebreaker
   |
   +-- listing:  $facet { rows: [$skip,$limit,$project], total: [$count] }
   |                 -> directoryEntryView() -> adminAccountView() + paymentView()
   |
   +-- export:   $limit cap+1, $project
                     -> services/studentExportExcel.ts (renders only; no DB access)
                        -> .xlsx bytes
```

Three properties this shape exists for:

1. **The export cannot disagree with the screen.** Same pipeline, same filters; only the renderer
   differs. A test sends one filter set to both and compares the student ids.
2. **Payment state is derived, in the database.** Nothing is stored (the rule that also governs the
   entitlement, XP and analytics), and doing it in the pipeline rather than in JavaScript is what makes
   the payment filter's pagination and totals correct.
3. **The `$project` is an allow-list.** An aggregation reads the raw document, so `select: false` on
   `passwordHash` is not in this path at all.

## Bulk question import — CURRENT (Milestone 21)

```
browser                          backend
-------                          -------
file picker                      POST /admin/questions/import/{excel|docx|image}
  |  FileReader -> base64          |  importLimiter  (ahead of the permission check)
  |  data URL in the JSON body     |  requirePermission("questions:write")
  +------------------------------->|  validate(previewImportSchema(kind))
                                   |    magic bytes + extension + size + count
                                   |  previewImport()
                                   |    resolveImportParser(kind)   <- 503 if unconfigured
                                   |    parser.parse() per file, each in its own try
                                   |      excel  -> exceljs        (deterministic)
                                   |      docx   -> mammoth        (deterministic)
                                   |      image  -> requestGeminiJson()  (model, 1 call/image)
                                   |    ImportedCandidate[]  (one canonical shape)
                                   |    resolvePlacement() per candidate  <- names, never ids
                                   |    screenEach()  <- THE shared screener
                                   |    inspectCandidates()  <- advisory only
                                   |  writes ImportBatch, NO questions
  <--------------------------------+  { batchId, questions, rejected, duplicates,
  |                                     failures, batchWarnings, files, truncated }
  |
review screen  (candidates live HERE — no staging collection)
  |  edit text / options / answer / solution / class / chapter / difficulty / type
  |
  |  POST .../import/validate   -> screenEach() again, writes nothing
  |  POST .../import/approve    -> THE ONLY WRITER
  |                                 re-validates from scratch
  |                                 provenance read back from ImportBatch
  |                                 creates status: "draft"
  |                                 publish only via changeQuestionStatus()
  |  POST .../import/reject     -> counts discards against the batch
```

**Three properties this shape exists to hold.** Uploading **writes nothing** — the only row is
the `ImportBatch`. There is **no staging collection**: candidates live in the browser, so the
bank cannot fill with machine-read text nobody read. And **nothing touches the filesystem** at
either end — uploads are base64 in the JSON body, parsed from a `Buffer` — which is why
temp-file cleanup and path traversal are absent risks here rather than mitigated ones.

**One screener, one candidate.** `screenEach()` in `services/questionGeneratorService.ts` is the
only implementation of "validate, then de-duplicate", shared with the AI generator;
`ImportedCandidate` composes `GeneratedCandidate` verbatim. A format per validator would mean
the weakest one deciding what reached the bank.

---

## High-Level Topology — CURRENT

```
┌─────────────────────┐        HTTPS (fetch, credentials:'include')        ┌──────────────────────────┐
│   frontend/ (SPA)    │ ───────────────────────────────────────────────▶ │  backend/ (Express app)  │
│  React 19 + Vite     │ ◀─────────────────────────────────────────────── │  single serverless fn    │
│  Deployed: Vercel #1 │        JSON, httpOnly access_token + refresh_token  │  Deployed: Vercel #2      │
└─────────────────────┘                                                   └──────────────┬───────────┘
                                                                                           │ mongoose
                                                                                           ▼
                                                                              ┌─────────────────────┐
                                                                              │  MongoDB (MONGO_URI) │
                                                                              └─────────────────────┘
```

Two independently deployed Vercel projects, no shared build, no monorepo tool. They agree only via the HTTP contract in [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md).

## Frontend Architecture — CURRENT

- **Framework**: React 19, `react-router-dom` v7 `BrowserRouter` with **53 routes in production**, all declared in [frontend/src/App.tsx](frontend/src/App.tsx) (this line said 31 for several milestones after it stopped being true — count them in `App.tsx`, do not quote it). A 54th, `/design-system`, exists in development only and is statically absent from a production build. Around thirty are code-split with `React.lazy` — the admin question, mock-test and daily-challenge pages, the practice runner, the mock-test attempt runner and the daily challenge — because they pull in KaTeX (~260 KB), which must not land in the entry bundle every student downloads.
- **One shell, two navigation models** (Milestone 23, Phase B). `components/layout/AppShell.tsx` renders the chrome for both signed-in areas — sidebar, drawer, topbar, mobile bottom bar, theme toggle, sign-out — and `components/layout/navigation.ts` holds the student and admin menus as **data**, so the desktop sidebar, the drawer, the bottom bar and the admin permission filter cannot disagree. `components/StudentShell.tsx` and `pages/Admin/AdminShell.tsx` remain as thin wrappers for what only their half knows (unread count and entry-fee padlock; permission filter and identity block), and `StudentShell` still falls back to the public `Navbar`/`Footer` for a guest, because two of its routes are public.
- **Three navigation layouts, chosen rather than derived**: below 768px the student area gets a bottom bar (Home · Practice · Tests · Challenge · More) and the admin area a burger; from 768px both use a burger; from 1024px the sidebar is permanent. A timed paper (`focus`) drops the bottom bar and keeps the burger. **The permanent sidebar is `display: none` below 1024px and the drawer is a separate element mounted only while open** — no `visibility` toggle, no `inert`, no JavaScript media query in the correctness path, because anything delivered with the browser's rendering steps (rAF, `ResizeObserver`, a `MediaQueryList` change, a transition ending) may never arrive in a tab that is not compositing. See the Milestone 23 ADR; two earlier implementations failed exactly there.
- **Theme**: `context/ThemeContext.tsx` applies a `theme-dark` class to `document.documentElement`, persisted in `localStorage`, **defaulting to light**. Applied once at the document root, so no page can disagree with another.
- **State**: One global context, `AuthContext` (`frontend/src/context/AuthContext.tsx`), a discriminated union `{status: 'loading'|'guest'|'student'|'admin', ...}`. No Redux/Zustand/React Query — every page manages its own `useState`/`useEffect` data fetching.
- **Data fetching**: `frontend/src/api/client.ts` — a thin `fetch` wrapper (`api.get`/`api.post`) that always sends `credentials: 'include'` and throws a typed `ApiError` on non-2xx. Pages call this directly in `useEffect`; there is no caching layer, so every page re-fetches on mount. It also owns `API_BASE = '/api/v1'` and prefixes every request, so callers pass version-agnostic paths (`/auth/login`, not `/api/auth/login`) and the API version changes in exactly one place.
- **Styling**: CSS Modules per page/component (`*.module.css`) over a **token layer and design system**, since Milestone 23 Phase A. `main.tsx` imports exactly one global sheet, `src/styles/theme.css`, which is three `@import`s in a load-bearing order: `tokens.css` (custom properties only) → `base.css` (element defaults, which consume them) → `utilities.css` (global classes, which must be able to override an element default). The global class names referenced by string (`container`, `card`, `form-group`, `form-control`, `error-text`, `success-text`) live in `utilities.css` and are the **pre-existing** ones, kept and modernised so the un-migrated pages inherit the redesign; the new additions are `stack`, `cluster`, `grid-auto`, `sr-only`, `min0`, `truncate`, `link`, `eyebrow`, `muted`, `tnum`, `mono`.
- **Design system**: `src/components/ui` — twenty-one domain-agnostic primitives behind one `index.ts` barrel (Icon, Button/ButtonLink, Card, Badge, Alert, Field, Input/Textarea/Select/Checkbox/SearchInput, Modal, ToastProvider, Tabs/TabPanel, Pagination, Skeleton, Steps, Table/TableScroll/DataCard, EmptyState, ErrorState, Spinner, Progress, Tooltip, StatTile). `Steps` (Milestone 23 Phase E) is used by registration, the bulk importer and the AI generator; its current step is derived from what exists rather than tracked, so it cannot disagree with the screen. The boundary is the domain: a component belongs there only if it knows nothing about this product, which is why `EntryFeeBanner`, `Recommendations`, `MathText`, `ResetPanel` and the two shells remain in `components/`. `ToastProvider` is mounted once, inside `BrowserRouter` in `App.tsx`, so a portalled toast still has router context. Three of the old shared components (`Button`, `Spinner`, `StatTile`) are now re-exports, which is how 88 existing imports picked up the redesign without being edited.
- **Authentication surfaces** (Milestone 23, Phase C): sign-in and registration are components under `pages/Auth/` — `LoginDialog` (on `ui/Modal`) and `RegisterForm` — rendered by the landing page, which keeps only the orchestration that is its own (the `?ref=` check, the `/register` scroll, the `#login` hash that opens the dialog and is cleared when it closes). `AuthLayout` frames the four standalone pages reached from an email: forgot password, reset password, verify email and its resend form. There is **no `/login` route**; sign-in has always been a panel, and `/#login` is how the header and footer address it.
- **Charts**: `chart.js` + `react-chartjs-2`, wrapped in a single reusable `ChartCard` supporting line/bar. Since Milestone 23 Phase D it resolves its colours from the token layer at render time and re-reads them on a theme change (a canvas cannot use a CSS variable, so the alternative was hex literals that ignored dark mode), takes a semantic `tone` rather than a colour, caps its axis ticks so labels stay legible at 375px, and carries `role="img"` with a summary because a canvas is an image to a screen reader.
- **Icons/fonts**: loaded via CDN `<link>` tags in `index.html` (Phosphor Icons, Google Fonts) — **not npm dependencies**, deliberately (see the Milestone 23 ADR: the npm package's `@font-face` drags four formats including a 3 MB SVG font into the bundle). Only Phosphor's `regular` and `bold` stylesheets are loaded, so `ph-fill`/`ph-light`/`ph-thin`/`ph-duotone` render an *invisible* glyph rather than falling back — `components/ui/Icon.tsx` admits two weights for that reason. Fonts: Inter (interface, variable 400–800 in one file), Poppins (headings and the brand voice), JetBrains Mono (figures), Cinzel (the printed certificate only).
- **Responsive strategy**: mobile is the base case — the phone layout carries no media query, and `min-width` queries only widen it. Breakpoints 480 / 768 / 1024 / 1280, documented at the top of `tokens.css` (a custom property cannot be used in a media query, so they are a convention rather than a token). A table is rendered **either** inside `TableScroll`, a contained horizontal scroller that takes a keyboard focus stop only while it actually overflows, **or** as a `DataCardList` — one card per record. No column is dropped to make a table fit.
- **Build**: `tsc -b && vite build`, static output, deployed as a static Vercel site with SPA fallback rewrite.

### Frontend data-flow reality check

**Every page now round-trips to the backend.** This section used to list pages that displayed hardcoded arrays while a matching endpoint sat unused. That list is empty as of 2026-08-11. For the record, what it contained and where each went:

| Was | Now |
|---|---|
| `Dashboard.tsx` / `Landing.tsx` hardcoded leaderboards | `GET /leaderboard` (real XP aggregation) and `GET /public/stats` |
| `Certificate.tsx` rendered client-side for anyone signed in | `GET /certificates/:studentId`, requiring a published `Result` |
| `GET /daily-challenge` had no caller | a dashboard card, via `GET /me/daily-challenge` |
| `Result.tsx` hashed the typed ID into a fake score | `GET /results/:studentId`, published results only |
| `Exam.tsx` marked five hardcoded questions in the browser | replaced by the Practice Zone; grading is server-side |
| `Admin.tsx` hardcoded student table and sample chart | `GET /admin/students` and `GET /admin/stats` |
| `Analytics.tsx` showed an invented 88% accuracy | `GET /analytics/:id` returns null with a reason, plus a real `xpByDay` |

The two surfaces that still look empty — the dashboard's test-performance panel and the result portal — are **live queries against collections nothing writes yet**, deliberately rather than hardcoded empties, so they begin working the moment official exam submission exists.

## Backend Architecture — CURRENT

_Restructured in Milestone 1 (2026-08-04). Previously all logic lived in a single ~450-line `server.ts`._

- **Framework**: Express 5 + TypeScript, run via `tsx` locally and as a Vercel serverless function in production.
- **Two entry points, one app**:
  - `src/app.ts` — `createApp()` assembles middleware and routes and exports a configured app. Imported by **both** the local server and the Vercel entry (`api/index.ts`).
  - `src/server.ts` — local/standalone process bootstrap only: eagerly connects to MongoDB (non-fatally), starts the HTTP listener, and installs SIGTERM/SIGINT graceful-shutdown handlers. **Never executed on the serverless path.**
- **Module layout**:

```
src/
  app.ts                  Express app assembly (middleware order matters, see below)
  server.ts               local bootstrap + graceful shutdown
  config/env.ts           dotenv load + zod validation of process.env
  config/index.ts          typed config derived from env (the only consumer of env.ts)
  db/connection.ts        connect/disconnect, cached + de-duplicated, state helpers
  lib/logger.ts           pino instance
  lib/ApiError.ts         operational error class with status code + factories
  lib/apiResponse.ts      sendSuccess / sendError (the { success, ... } envelope)
  lib/permissions.ts      THE role -> permission table (single source of truth)
  lib/audit.ts            recordAudit() — writes the administrative audit trail
  middleware/auth.ts          authenticate / requireAuth(...roles) /
                              requirePermission(...) — the only authz gate
  middleware/validate.ts      zod validation for body/query/params
  middleware/errorHandler.ts  global error handler + 404 handler
  middleware/rateLimiter.ts   general + auth limiters
  middleware/requestLogger.ts pino-http
  middleware/ensureDb.ts      per-request DB connection gate
  lib/envGuard.ts         refuses a script write to an unintended database
  lib/mathContent.ts      LaTeX grammar + dangerous-command rejection
  lib/xp.ts               XP award table + level function
  lib/achievements.ts     achievement catalogue, evaluated from real facts
  lib/competitionDay.ts   the IST day boundary streaks are measured in
  lib/session.ts          session cookies + access-token claims
  services/               business rules, kept out of the route layer:
                          question, taxonomy, activity, progress, challenge,
                          result, practice, mockTest, dailyChallenge,
                          reward (THE gamification engine: the only way
                          anything earns XP), leaderboard (THE ranking:
                          the only way anything decides a rank),
                          hallOfFame (the five honours boards),
                          grading (THE marking rules,
                          shared by all three attempt surfaces),
                          questionView (the shared
                          answer-stripped projection),
                          analytics (THE student derivation, M15),
                          recommendation (THE advice path, M16 — resolves
                          a swappable engine, assembles its facts, and
                          stamps the provenance itself), and
                          questionGenerator (THE path from "generate" to
                          the bank, M17 — and THE trust boundary: it
                          attaches the taxonomy, validates every candidate
                          through the authoring schema, and writes drafts)
  models/                 one Mongoose model per file + barrel index (18)
  routes/health.routes.ts /health, /ready
  routes/v1/              auth, me, analytics, practice, mockTests,
                          mockTestsAdmin, dailyChallenge,
                          dailyChallengesAdmin, rewards, leaderboard,
                          questions,
                          questionsAdmin, taxonomy, admin, users, misc
                          + barrel index
  validation/             zod schemas (authSchemas, questionSchemas,
                          userSchemas, profileSchemas, practiceSchemas,
                          mockTestSchemas, dailyChallengeSchemas,
                          rewardSchemas)
scripts/                  dev-local, verify-email, migrate-questions,
                          backfill-activity, seed-class12, where-is-data,
                          atlas-direct-uri
```

- **Routes do HTTP; services own the rules.** A route validates, authorises, calls a service and formats the envelope. Business rules live in `services/` and signal violations by throwing `ApiError`, which `lib/serviceError.ts` maps to a status code — so each rule is stated once, at the point it is enforced.

- **Four "there is exactly one of these" services.** `grading.ts` marks every answer, `rewardService.ts` grants every point of XP, `leaderboardService.ts` decides every rank, and `questionView.ts` builds every answer-stripped projection. Each is singular for the same reason: a second implementation would eventually disagree with the first, and in each case the disagreement is visible to a student as a wrong score, a wrong XP total, a rank that differs between two pages, or a leaked answer. When a new surface needs one of these things, call the existing one — including from another service (the Hall of Fame's XP board calls `getLeaderboardPage()` rather than writing its own aggregation). `analyticsService.ts` (M15) and `recommendationService.ts` (M16) joined them on the same argument: one derivation of a student's performance, and one path to advice about it.

- **The recommendation seam (Milestone 16)** is the one place in the backend designed to be *replaced* rather than extended, so it is worth reading as architecture rather than as a feature:

  ```
  route  →  recommendationService  →  RecommendationEngine (swappable)
              │  assembles RecommendationFacts        ▲
              │    · analyticsService (M15)           │  statistical-v1 (default)
              │    · practiceService availability     │  …or a model-backed engine
              │    · published mock-test count        │
              │                                       │
              └── stamps engine / generatedAt / hasData onto the result
  ```

  Three properties hold it together. **An engine cannot query** — it is a pure function of the facts object, exactly as `lib/achievements.ts` is of `RewardFacts`, so it cannot invent a figure no collection could produce nor make a page slow unexpectedly. **An engine cannot describe itself** — `recommend()` returns content only, and the service writes the provenance from the registry entry it actually invoked, so nothing can claim to be a model, or claim data a student does not have. **An engine that throws does not take the page down** — the statistical engine answers instead. The contract is one file, `lib/recommendationTypes.ts`; selection is one environment variable; nothing else changes.

- **The question-generator seam** (Milestone 17, reworked in 18, rebuilt on the official SDK in 20) is the same shape, applied to the one place a language model really is called. Note that it is **two phases with nothing stored between them**:

  ```
  POST /admin/generate-questions
     │  generationLimiter (60/hr — the one route that spends provider quota)
     ↓
  questionGeneratorService.proposeQuestions()  →  QuestionGenerator (swappable)
     │  resolves by config                            ▲
     │                                                │  gemini  (when a key is set)
     │  ── THE TRUST BOUNDARY: screenCandidates() ──  │  …or any registered provider
     │   · attaches the taxonomy from the request (subject/chapter/subtopic/class)
     │   · parses every candidate with createQuestionSchema
     │   · refuses near-duplicates of the bank and of the batch
     │   · annotates with advisory warnings (lib/questionQuality.ts, pure)
     │   · reports rejects, repairs nothing
     └── returns candidates.  WRITES NO QUESTION.  Only a GenerationLog row.
                       │
             (candidates live in the reviewer's browser)
                       │
        ┌──────────────┼───────────────────────────┐
        ↓              ↓                           ↓
   .../validate    .../reject                 .../approve
   dry run,        counts what the            THE ONLY WRITER
   same screen-    examiner discarded         · re-screens from scratch
   ing, writes     against the log            · createQuestion() + provenance
   nothing                                      read back from OUR log
  ```

  The difference from the recommendation seam is the direction of distrust. There, the concern was an engine *describing* itself dishonestly. Here it is an engine *writing* content that will be shown to children, so the service is a validation gate rather than only a provenance stamp — and the gate is the **same schema a human author passes**, deliberately, because a model-specific validator would be the weaker of two.

  Three things are worth reading off that diagram. **Approval re-screens**: what arrives is whatever the browser sent after the examiner edited it, so trusting it because the proposal validated would mean the schema was never really enforced. **`/validate` calls the same function**, which is why its answer is the answer approval will give rather than an approximation of it. And **there is no template fallback** any more (deleted in Milestone 18): an unconfigured key is a 503 naming the variable, a failed provider is a 502 carrying its own words, and neither invents filler — a blank placeholder is only useful as something to type into, and a reviewer who wants one can create a question by hand.

  Structured output is what makes the parsing short: the SDK is handed a `responseSchema` built for the requested question type, so a numeric question's schema has no `options` property to be filled in wrongly, and the batch size and option count are pinned by `minItems`/`maxItems`. `marks` is deliberately absent — the paper is priced by the examiner. Retries are **this codebase's**, not the SDK's: only 429/5xx/timeout, bounded by `GEMINI_MAX_RETRIES`, and sharing **one time budget across all attempts** so a retry can neither inherit a spent deadline nor outlive a serverless invocation.

- **Middleware order in `app.ts`** (deliberate):
  1. `helmet` + `x-powered-by` disabled
  2. request logging (`pino-http`)
  3. CORS (explicit allow-list, `credentials: true`)
  4. `express.json`, `cookie-parser`
  5. **health routes** — mounted *before* the rate limiter so monitoring probes are never throttled and never depend on the DB
  6. general rate limiter
  7. `/api/v1` routes, then the same router again at `/api` (compatibility alias)
  8. 404 handler, then the global error handler
- **Per-route middleware order** for data routes: `rateLimit → validate → requireAuth → ensureDb → handler`. Validation runs *before* the DB gate so malformed input returns 400 even when the database is down.
- **Privileged routes invert that order**: `requirePermission` expands to `authenticate → ensureDb → freshRoleCheck → permissionCheck`, which runs *before* `validate`. An unauthorized caller is refused before any input is parsed, and the role is re-read from the database rather than trusted from the token — see [`DECISIONS.md`](DECISIONS.md).
- **Error handling**: routes retain their own `try/catch` returning the `{ success, error }` envelope; the global handler is the safety net for validation failures, 404s, thrown `ApiError`s, and anything an async handler rejects with (Express 5 forwards those automatically).

## Database Architecture — CURRENT

**Connection strategy (Milestone 1)**: `db/connection.ts` owns a single cached connection. `connectDB()` returns immediately if already connected and de-duplicates concurrent calls via a shared in-flight promise, so it is safe to call per request. It is invoked from two places: eagerly by `server.ts` at local boot (non-fatally — a failure logs and the server still starts, with `/ready` reporting 503), and lazily by the `ensureDb` middleware on every DB-backed route. The lazy path is what makes production work at all: the Vercel serverless entry imports `app.ts` directly and never runs `server.ts`, so without `ensureDb` no connection would ever be opened. `serverSelectionTimeoutMS` is set explicitly (8s normally, 300ms under test) rather than relying on Mongoose's 30s default, which exceeds a serverless function's own timeout.

**`.env` resolution is anchored to the package root**, not `process.cwd()`. `config/env.ts` resolves it from its own directory, because a script run from `backend/scripts/` previously found no `.env`, loaded zero variables, silently fell back to the `mongodb://localhost` default, and wrote to the wrong database while reporting success. Every write script additionally calls `assertConfiguredForWrites()` (`lib/envGuard.ts`), which prints the target database and refuses a local write without an explicit `--local`.

See [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) for full field-level detail. **18 models**: `Student`, `StudentPhoto`, `Question`, `Subject`, `Topic`, `StudentActivity`, `PracticeSession`, `MockTest`, `MockTestAttempt`, `DailyChallenge`, `DailyChallengeAttempt`, `RewardSettings`, `ExamAttempt`, `Result`, `StudentAnalytics`, `RefreshToken`, `VerificationToken`, `AuditLog` — plus `attemptAnswer.ts`, a subdocument shared by the two attempt collections rather than a model of its own. Of these, `Result` is unwritten and `ExamAttempt` is read but never written — both belong to the *official* exam, which is not built (see [`DECISIONS.md`](DECISIONS.md) on why practice is a separate collection). Real indexes throughout, including a **partial unique** index on `StudentActivity` that is what makes "once per day" true rather than merely intended, a **unique** index on `MockTestAttempt` `{test, student, attemptNumber}` that does the same for "one attempt per sitting", and a **unique** index on `DailyChallengeAttempt` `{student, day}` that does it for "one daily reward per day". No migration tool; there are several ad-hoc scripts instead, which is the point at which a real runner starts to be worth it.

## Authentication Architecture — CURRENT

_Rewritten in Milestone 2. The previous design was a single 7-day JWT with no revocation._

**Two credentials, different jobs:**

- **Access token** — a JWT signed with `JWT_SECRET` (mandatory in production), 15 minutes (8 hours for the root administrator), `httpOnly` session cookie `access_token`. Claims: `role`, `sub`, `studentId`, `email`, `tv`, and `root` for the environment-configured administrator. Authentication is stateless — signature and expiry only, no database read — and a token whose `role` is not a recognised role is rejected outright. **Authorization is not stateless for privileged requests**: the `role` claim is treated as a hint and the current role is re-read from MongoDB, so revoking someone's access takes effect immediately rather than at the end of the token's lifetime.
- **Refresh token** — 32 bytes of `crypto.randomBytes`, opaque, 30 days, `httpOnly` cookie `refresh_token`. Persisted in the `RefreshToken` collection as a **SHA-256 hash only**, rotated on every use, and grouped into a per-login "family".

**Rotation and theft response**: each refresh mints a new token, revokes the old one, and links them. Replaying an already-rotated token revokes the entire family, since two holders of one token means theft or replay.

**Revocation model**: `logout` revokes just the presented refresh token; `logout-all` and password resets revoke every token *and* bump `Student.tokenVersion`, which invalidates outstanding access tokens (checked as `tv` on `/auth/me`). Because access-token checks are stateless, a revoked session can survive at most one access-token lifetime — a deliberate trade-off documented in [`SECURITY.md`](SECURITY.md).

**Email-bound flows**: verification (24h) and password reset (30 min) use single-use tokens from the `VerificationToken` collection, also stored hashed, consumed atomically so a link cannot be redeemed twice.

**Identity**: students log in with **either** their mobile number or their email address. Login is refused until the email is verified (`REQUIRE_EMAIL_VERIFICATION`). Accounts carry a `status` (`active`/`suspended`/`deactivated`) enforced at login, on refresh, and on every `/auth/me`, plus failed-login lockout.

**Admin** identity is still **not** in the database — two env vars compared in the login route. It gets a single longer-lived access token (8h) and **no** refresh token, because there is no student record to anchor a token family to (see [`DECISIONS.md`](DECISIONS.md)).

## API Architecture — CURRENT

REST-ish under `/api/v1/*` (canonical) with `/api/*` retained as a backward-compatible alias mounting the same router — see [`DECISIONS.md`](DECISIONS.md). JSON in/out, consistent `{success: boolean, ...}` response envelope produced by `lib/apiResponse.ts`. Request bodies and query params are validated by zod schemas via `middleware/validate.ts` before any handler runs. See [`API_DOCUMENTATION.md`](API_DOCUMENTATION.md) for the full endpoint list split into implemented-and-wired vs. implemented-but-orphaned vs. planned.

## Storage Architecture — CURRENT / PLANNED

- **CURRENT**: Static image assets (`logo.png`, QR code, founder photo) are bundled into the frontend build via Vite's asset pipeline — not served from any external storage or CDN, not user-uploadable.
- **PLANNED**: No file/image upload feature exists anywhere (no multipart handling, no S3/Cloudinary/etc. integration). Needed eventually for things like certificate PDFs or a gallery, but nothing is wired up.

## Email Architecture — CURRENT

_Implemented in Milestone 2. The fake client-side "OTP" step was deleted._

- `lib/email.ts` sends through **`nodemailer` over plain SMTP**, configured entirely by env vars, so any free-tier provider (Brevo, Resend, Mailtrap, a Gmail app password) works without a code change or vendor SDK.
- Three transports, chosen by environment:
  - **test** → captured in memory, letting tests assert on the real generated link;
  - **SMTP configured** → real delivery;
  - **SMTP unset** → written to the structured log, including the working link, so local development works before any provider exists.
- Two templates: email verification and password reset. Link bases come from `FRONTEND_URL`.
- Delivery failures are logged and swallowed, never surfaced, so a dead provider cannot become a 500 or leak whether an address exists.
- **Appears to be configured** — a local registration sent a real message through the values in `backend/.env` rather than the log fallback. Delivery to an inbox has still never been *observed*, so treat that as unconfirmed until `npm run verify:email` is run. Note that `dev:local` does **not** suppress outgoing mail. See [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

## Payment Architecture — PLANNED (not started)

No payment gateway SDK/dependency in either `package.json`. The registration flow shows a static QR image and treats "I've paid" as a self-reported client click with no server-side verification, no order record, no webhook.

## Deployment Architecture — CURRENT

- `backend/vercel.json`: rewrites all paths to `/api` (the serverless function entry). `api/index.ts` imports the app from `src/app.ts` (not `src/server.ts`), so the serverless path never runs the local bootstrap — DB connection there is handled by the `ensureDb` middleware.
- `frontend/vercel.json`: rewrites `/api/*` to a **hardcoded absolute URL** `https://amit-olympiad.vercel.app/api/$1` (the backend's production deployment), and everything else to `/index.html` for SPA routing.
- Since the frontend now requests `/api/v1/...`, and both the Vite dev proxy and the Vercel `/api/(.*)` rewrite pass the remainder of the path through unchanged, **no deploy config needed to change** for versioning. It does introduce a deployment-ordering requirement: deploy the **backend first**, otherwise a newly deployed frontend calls `/api/v1/*` against an older backend that only serves `/api/*` and every request 404s.
- This means the frontend's production build always points at one specific backend Vercel deployment URL — if the backend project's URL ever changes (e.g., project renamed), `frontend/vercel.json` must be updated manually.
- Local dev uses a different mechanism entirely: Vite's dev proxy (`vite.config.ts`) forwards `/api` to `http://localhost:8081`, matching the port in `.claude/launch.json`.

## Major Data Flows — CURRENT

**Liveness / readiness probing**: `GET /health` returns 200 from the process with no DB involvement. `GET /ready` inspects the Mongoose connection state and returns 200 `{status:'ready'}` or 503 `{db:'disconnected'}`. Both are mounted before the rate limiter, so probes are never throttled.

**Any DB-backed request**: rate limiter → zod validation → `requireAuth` (where applicable) → `ensureDb` (connect-or-503) → handler. Privileged (`requirePermission`) routes authenticate and authorize first, so they can answer 401/403 before parsing and answer 503 when the database is down, because the role cannot then be verified. A malformed request therefore returns 400 without ever touching the database, and an unreachable database returns a clean 503 rather than a 500 or a hang.

**Registration (Milestone 2)**: Landing form (details → payment placeholder) → `POST /api/v1/auth/register` → bcrypt hash (cost 12) → `Student` created unverified with a unique `studentId` (retrying on collision) → single-use token stored hashed → verification email → **no session issued**. The UI then says "check your email".

**Email verification**: emailed link → `/verify-email?token=…` → `POST /api/v1/auth/verify-email` → token consumed atomically → `isEmailVerified: true` → student can now sign in.

**Login**: `POST /api/v1/auth/login` with mobile *or* email → lockout check → bcrypt compare (incrementing the failure counter and locking after 5) → status check → verification check → access + refresh cookies issued, refresh row written hashed.

**Authenticated request**: `access_token` cookie → stateless verification → handler for student-level permissions; for an administrative permission the chain additionally re-reads `role`/`status`/`tokenVersion` from the database and uses those values.

**Administrative request**: `requirePermission('...')` consults the single role → permission table in `lib/permissions.ts`; on success the handler runs and calls `recordAudit()`; on refusal the caller gets 403 and an `authz.denied` row is written to `AuditLog`. Every authenticated response also carries the caller's effective permission list, which is what the frontend's guards and navigation are built from — the UI never keeps its own copy of the mapping. On a 401 the frontend client transparently calls `/auth/refresh` once (de-duplicated through a shared promise) and replays the request.

**Refresh**: `refresh_token` cookie → hash lookup → reuse/expiry checks → new token minted, old one revoked and linked → both cookies re-set.

**Password reset**: `POST /auth/forgot-password` (always a generic 200) → hashed single-use token → emailed link → `/reset-password?token=…` → new hash written, `tokenVersion` bumped, **all** refresh tokens revoked, email marked verified, cookies cleared.

**Session restoration after reload**: `AuthContext` calls `/auth/me`; if that fails it attempts one `/auth/refresh` and retries before concluding the visitor is a guest. This is what keeps a signed-in student signed in across a browser refresh, given the access cookie is a session cookie.

**Admin question generation**: `AiGenerator.tsx` form → `POST /api/v1/admin/generate-questions` (admin-only) → template-generates N question objects → `Question.insertMany()` → returned and rendered; these are real DB writes, but the "questions" are not written by an AI model.

**Analytics view**: `Analytics.tsx`/`Report.tsx` → `GET /api/v1/analytics/:studentId` → looks up `StudentAnalytics` → **always missing today**, so the response is `data: null` with `reason: 'no-exam-data'`, plus a genuinely real `xpByDay` series aggregated from `StudentActivity`. The page charts the real series and renders an explicit "not measured yet" state for the accuracy half. Until 2026-08-11 this endpoint returned hardcoded figures (88% accuracy over 450 questions) rendered as if real.

**Practice session (Milestone 6)**: `/practice` → `GET /practice/options` (real per-topic counts for the student's own class) → `POST /practice/sessions` draws a paper with `$sample` and **snapshots the answer key** into the session document → each answer saved individually by `PUT …/answers` → `POST …/submit` grades server-side against the snapshot, writes per-question outcomes, and awards `practice_completed` XP once per competition day → the same response carries the review.

**Mock test (Milestone 7)**: `/admin/mock-tests` → an author assembles a paper from **published** questions of one class, priced per test → `PATCH …/status` publishes it, which is where the strict rules apply (every question published; a closing time if either disclosure setting needs one) → the student's `/mock-tests` lists it with the window and attempts left, and **no questions** → `POST /mock-tests/:id/attempts` snapshots the paper and **writes `expiresAt`** (`startedAt + duration`, clamped to the closing time) → each answer saved individually by `PUT …/answers`, which **refuses anything after the deadline and stores nothing** → `POST …/submit`, or the same grading triggered lazily by any later read, closes the attempt with a write conditional on it still being open, so exactly one submission can grade it → what comes back is whichever of three shapes the test's `resultDisplay` / `reviewPolicy` permit → `GET /admin/mock-tests/:id/results` sweeps expired attempts, then aggregates cohort statistics, standard competition ranking and per-question outcomes.

The answer key never leaves the server before submission: `sessionInProgressView()` composes the answer-stripped `studentQuestionView`, and `sessionReviewView()` — the only function that reveals an answer — throws unless the session is `submitted`. Grading is therefore not something the browser could tamper with, because the browser is never given the means.

**Official exam / Results / Certificates**: still no data flow. The endpoints and pages are real and wired, but nothing writes an `ExamAttempt` or a `Result`, so each renders an honest empty state. That is the next milestone.

---

## Hand-offs between admin screens — CURRENT (Milestone 21, Phases G–I)

```
Question Bank  (/admin/questions)
  select N questions  (held by id, cleared when filters/sort/page change)
    |
    +-- Publish N  ------------> PATCH /admin/questions/bulk-status
    |                              loops changeQuestionStatus() so assertPublishable() runs
    |                              => the questions are now practice content (Phase G)
    |
    +-- Check a class ---------> GET /admin/questions/practice-availability?classLevel=…
    |                              same getPracticeAvailability() the student picker uses
    |
    +-- Create mock test ------> /admin/mock-tests/new?classLevel=…&questions=id,id
    |     requires: one shared class, <=100                       (Phase H)
    |
    +-- Schedule daily --------> /admin/daily-challenges?classLevel=…&questionId=id
          requires: exactly one, published                        (Phase I)
```

**`pages/Admin/questionHandoff.ts` owns both rules and both URLs.** Each function returns either
a URL or the *reason* the action is unavailable, so a button's explanation and the destination's
validation come from one statement of the rule rather than two that can drift.

**A query string, not router state.** Router state does not survive a refresh and both
destinations are forms an administrator reloads while filling in. Question ids are not secrets.

**No backend was added for H or I.** `createMockTestSchema.questions` and
`scheduleChallengeSchema.questionId` already took explicit ids; the destinations still validate
everything they always did, and the hand-off is only a way of arriving with the form filled in.

---
