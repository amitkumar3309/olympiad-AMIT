# PROJECT_STATE.md

_Last updated: 2026-08-18 (Milestone 20 — the official Gemini SDK, structured output and review tooling)._

This file is the current snapshot. History belongs in [`CHANGELOG.md`](CHANGELOG.md). If this file and the code disagree, trust the code and fix this file.

**Verified counts, read from the code rather than carried forward** (2026-08-18, measured by running the suite): **882 tests passing across 26 files**, **26 Mongoose models** (Milestone 19 added `Payment` and `PaymentSettings`; Milestone 18 added `GenerationLog`; Milestone 15 *removed* one), **21 permissions** (3 student / 19 admin / 21 super admin — Milestone 19 added none, and the security audit added none), **49 frontend routes** (Milestone 19 added `/payment` and `/admin/payments`), 24 route modules under `routes/v1/`, **28 services**. The test count above **was measured on 2026-08-18** (`npm test --prefix backend`: 882 passing, 26 files), which also resolves the 2026-08-17 audit's unrun-changes warning — those changes run and pass. It was 830 across 25 files at the end of Milestone 19; Milestone 20 added 30 tests to `tests/questionGenerator.test.ts` and the audit added the 26th file. Re-read it from `npm test --prefix backend` rather than quoting this line later. Earlier revisions of this file carried 18 models, 535 tests and 33 routes several milestones after they stopped being true; if you are about to quote a number from here, the code is the authority.

## Current Development Phase

**Milestone 20 — the AI question generator on the official SDK, with structured output and real review tooling (2026-08-18): implemented and verified.** The owner asked for the official Google GenAI SDK, structured JSON output, subtopic support, retries, rate limiting, per-question review and approval, and provenance on what gets saved.

- **`@google/genai` replaces the hand-rolled `fetch`.** This **supersedes** the Milestone 17 ADR that rejected an SDK. Of its two objections, the owner's instruction overrides the first (a version to chase) and the second is *answered* rather than accepted: **retrying is our logic, not the SDK's** — only 429/5xx/timeout, bounded by `GEMINI_MAX_RETRIES` (default 1). An expired key, a blocked prompt and a retired model name are never retried, because repeating them spends quota to receive the same refusal.
- **Structured output, one tight schema per question type.** A numeric question's `responseSchema` has no `options` property at all, so options cannot come back to be rejected; `minItems`/`maxItems` pin the batch and option counts; `marks` is absent because the paper is priced by the examiner.
- **Subtopics** reach the prompt and the saved row, validated against the primary chapter *before* a request is spent.
- **A dry run** (`POST /admin/generate-questions/validate`) answers "would this batch save?" through the **same** screening function approval uses, and writes nothing. An examiner no longer presses Approve to find out that an edit broke a rule.
- **Per-question selection**, plus **advisory quality warnings** from a new pure module (`lib/questionQuality.ts`) that annotates and never rejects: a figure reference, a solution that never reaches the stored answer, a tolerance loose enough to mark a wrong answer right, unstated rounding, equivalent options, a conspicuously long correct option, and answer-position bias across the batch. **None of this claims the mathematics is correct** — nothing checks that, which is why review is mandatory.
- **Rejection is recorded** against the generation log. Nothing was stored, so there is nothing to delete — but "the examiner kept two of twenty" is the only honest measure of a prompt configuration, and it was invisible everywhere else.
- **Provenance on the question**: generator, exact model, generation-log row, whether the reviewer edited it, and who approved it — read back from **our own log**, never from the request body, so a client cannot claim a model it did not use or file machine output as hand-written. The question bank prints it and can filter on it.
- **`generationLimiter`, 60/hour per IP**, in front of the one route whose every call spends third-party quota. It had been behind the general limiter alone, which allows 300 in fifteen minutes.
- **A defect found by verifying against the live API, not by reading**: the abort signal was created once and reused across retries, so a slow first attempt made the retry abort instantly and report "timed out" for a real 503. It is now one budget shared across attempts.

Verified against the real Gemini API: the model list, a retired model name, a genuine 503 with the retry, and one real two-question generation matching the schema exactly. That generation also returned a **mathematically wrong answer key**, which is the best possible argument for the mandatory review step.

Before that, **the complete security audit — 2026-08-17: five findings, five fixes.** Not a feature milestone; no product behaviour was added. The whole application was reviewed against authentication, authorization bypass, IDOR, privilege escalation, JWT and refresh handling, password storage, CORS, CSRF, XSS, NoSQL injection, input validation, rate limiting, brute force, mass assignment, information and error leakage, file upload, payment and webhook handling, secret exposure, and administrative endpoint protection. The authoritative write-up is in [`SECURITY.md`](SECURITY.md).

1. **CSRF is closed**, by `backend/src/middleware/csrf.ts` — every state-changing method must carry an `Origin` (or, failing that, a `Referer`) whose host is in the CORS allow-list or is the request's own. The gap was genuinely exploitable and the documentation had mis-scoped it: the two incidental defences it relied on (JSON-only body parsing, preflighted CORS) cover every route that needs a **body** and nothing that does not — a list that since Milestone 19 includes `POST /payments/orders`.
2. **`http://localhost:5173` is no longer a permitted production CORS origin.** It was unconditional, so any page a visitor happened to be serving on that port of their own machine could make credentialed cross-origin reads of live student data — and it would have counted as an allowed origin for the check above.
3. **The public result and certificate lookups no longer publish a child's full legal name.** Both are unauthenticated by design and keyed on `AMIT_0000`–`AMIT_9999`, so once results are released they were a walk of the whole roll. Both now publish through `displayNameFor()` — the same masking the leaderboard uses — and both are rate limited. The holder's own certificate is unchanged, and the `/certificate` page was pointed at the authenticated endpoint it should always have used.
4. **The frontend deployment sends security headers** (`X-Frame-Options`, CSP `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`). It sent none at all, so the signed-in SPA could be framed — the classic pairing with `sameSite: 'none'` cookies.
5. **Rate limits where a request has a third-party cost or issues a credential** — the two payment routes, and the staff password reset / session revocation / account deletion. The last had been an open gap in `SECURITY.md` since Milestone 5, and the reset hands over a *working credential* for somebody else's account.

**Found sound, and recorded as such so nobody re-derives it**: the answer-key rules, grading and the timing model, the reward and ranking engines, the permission table and its fresh database re-check, `refuseIfProtected()`, the root-superadmin bootstrap and the escalation it refuses, refresh rotation and family revocation, password storage and the single `authenticateAccount()`, every Mongo filter, every magic-byte-validated upload, the payment signature/ownership/idempotency rules, and the KaTeX text/math split. **No IDOR was found** — every owner-scoped route puts the account in the *query* rather than checking it afterwards, and every route in `routes/v1/` carries a gate.

**Two things this pass did not verify, recorded rather than implied**: `npm audit` was not run in either app, and nothing was driven through a browser. Both sit at the top of "Remaining Gaps" in [`SECURITY.md`](SECURITY.md).

Before that, **Milestone 19 — Payments, and the entry fee that gates the platform: implemented.** The last planned development milestone. Full detail is under "Current Payment State"; the shape of it:

- **Razorpay Standard Checkout, verified server-side**, replacing a static QR image and an "I've Paid" button that recorded nothing, verified nothing, and created the account either way. Every student who registered was told something untrue, and the site had no idea whether anyone had paid.
- **₹100, once, and it buys a seat in the Olympiad.** Practice, mock tests, the daily challenge and analytics are free — the fee is for the competition itself. The gate is **on by default**, and can be switched off entirely from `/admin/payments`.
- **The browser is never believed about money.** The order endpoint takes no body; the amount comes from the settings document and the student from the token; both capture paths verify an HMAC signature in constant time. Capture is a conditional write, so a duplicate confirmation changes nothing.
- **Reconciliation instead of a webhook.** With no webhook secret configured, `POST /payments/reconcile` asks Razorpay directly what happened to the student's outstanding order — which is strictly more trustworthy than a webhook, because the answer comes from an authenticated call we initiated rather than an unauthenticated request claiming to be Razorpay. The trade is that it settles when something asks rather than within seconds.
- **One gate, mounted not called.** `middleware/requireEntry.ts` answers 402 on the exam route and runs *before* the resource is looked up, so the paywall cannot report on what exists behind it. The entitlement rides on every auth response beside `permissions`, so the UI reads it rather than deriving it — and that flag is presentation only.
- **The admin console exists**, at `/admin/payments`: counted totals, the transaction list, and the fee and its on/off switch. Without it the fee could only be changed by a database edit.

**Verified by 31 payment tests (830 total, 25 files)**, none of which touch Razorpay — signatures are genuine, computed with the same HMAC the product uses from a test secret, because a suite that only ever sent a fake signature would pass against an implementation that accepted everything. **No real checkout has been driven through a browser**, because no Razorpay credentials are set in this sandbox.

Before that, **Milestone 18 — Generated questions need a human before they exist: implemented.**

- **Nothing generated is saved until it is approved.** Generation returns candidates and writes no question; they live in the reviewer's browser, and a separate explicit approval call is the only path that writes. Approval **re-validates from scratch**, because the review screen is a client and the examiner has been editing it. Milestone 17's blank-template generator is **deleted**, fallback included — a spent quota now says "Quota exceeded" rather than quietly producing filler.
- **The full configuration**: class, subject, multiple chapters, difficulty, question type, Bloom's level, language, marks, negative marks, option count and free-text instructions, all reaching the prompt. The review screen offers edit, regenerate one, regenerate all, delete, then *approve as drafts* or *approve and publish*.
- **A fifth question type, `fill_blank`**, marked against author-listed accepted answers with normalisation that forgives capitalisation, spacing and a trailing full stop and nothing else. **Short answer was deliberately not added** — it cannot be auto-graded without either a human marking queue or sending a child's written answer to a model.
- **Duplicate detection**: a candidate at 80% or more word-overlap with an existing question in the chapter, or with another candidate, is refused. Jaccard over significant words, because the failure mode is rewording with new numbers.
- **A new `GenerationLog`** records what was asked, what came back, why candidates were rejected, how long it took and the provider's own error — counts and parameters only, never question text.

**Not done in this milestone, and explicitly outstanding** (see "Immediate Next Task"): AI mock-test generation, daily-challenge automation with a scheduler and admin controls, and the bulk seeding script. **Nothing has been driven through a browser**, because no `GEMINI_API_KEY` is available in this sandbox — the model path is covered only by tests against a fake transport.

Before that, **Milestone 17 — AI question drafting: implemented.** The admin "generate questions" button has existed since before Milestone 4 and filled a template string; the page said so, because calling it AI would have been a lie. It can now be backed by **Google Gemini**, and the honesty discipline got tighter rather than looser.

- **This is not a reversal of Milestone 16's "no AI" decision.** Three of that ADR's four reasons do not apply here: recommendations are questions about *counts* (arithmetic answers them exactly), while drafting a question is *writing*; **no student data is sent** (a subject name, a topic name, a class, a difficulty and the examiner's own instruction — there is a test asserting the request body contains no student fields); and the MVP still runs identically with no key. The fourth reason — this product already deleted a fake AI feature — governs completely.
- **The model's output is not trusted, and that is the whole safety story.** The **taxonomy comes from the request** (`GeneratedCandidate` has no subject/topic/class/difficulty field, so a model cannot file a question anywhere it was not asked to); every candidate passes **`createQuestionSchema`**, the same schema and the same `validateMathContent()` a hand-authored question passes; a failure is **rejected and reported with its reason, never repaired**; and everything written is a **draft**, because `createQuestion()` has no other mode.
- **Failure is normal and handled as such.** A spent free-tier quota, a timeout, prose instead of JSON, or 40 questions when 2 were asked for — each reports the provider's own words, because "it failed" cannot be acted on while "quota exceeded" can. (Milestone 17 fell back to blank templates here; **Milestone 18 deleted that** — a failed generation now says so plainly rather than quietly producing filler.)
- **With no `GEMINI_API_KEY` nothing changes.** Blank templates are the supported default and need no credential, no network and no paid service. The key alone turns AI drafting on; deleting it turns it off.
- **`GET /admin/question-generator`** lets the page state whether AI is configured *before* the button is pressed, and the audit trail records `generator` and `generatorKind` per batch — so "was this question written by a machine?" stays answerable years later.
- **No new dependency**: `fetch` against the REST endpoint rather than an SDK. The key travels as an `x-goog-api-key` header, not `?key=`, because a URL is the thing most likely to reach a log line.

**Verified by 20 new tests (795 total, 24 files)**, none of which touch the network — a test-only transport hook is what makes the failure paths testable at all. One new optional environment-variable group (`GEMINI_API_KEY`, `GEMINI_MODEL`, `QUESTION_GENERATOR`), **no new model, no new permission and no new page**.

Before that, **Milestone 16 — Intelligent performance recommendations: implemented.** Milestone 15 made a student's performance measurable and stopped there: the analytics page ended with a weak-areas list and no next step. This milestone turns those measurements into advice, behind an interface a model can be plugged into later.

- **Five kinds of recommendation**, all derived on read: weak topics, strong topics, difficulty guidance, practice suggestions and performance insights. `services/recommendationService.ts` is THE path to one, and **nothing is stored** — there is no recommendation collection, for the reason `StudentAnalytics` no longer exists. A student who fixes their weakest topic on Tuesday must not be told on Wednesday that it is still their weakest topic.
- **A finding is asserted on a confidence interval, not on a percentage.** The obvious implementation ranks topics by accuracy and calls the bottom ones weak; on this data that is actively misleading, because a practice session is ten questions and a topic's whole sample is often five. **2 of 5 (40%) would outrank 30 of 80 (37.5%)** — the first is one bad session, the second is the finding. Every claim is made against the **95% Wilson score interval**, from the conservative end: a weakness on the upper bound, a strength on the lower. The visible consequences are deliberate and both tested: **a perfect five is not a strength**, and **five wrong answers are not a weakness**.
- **Every recommendation cites its evidence, structurally.** `basis` is a required field carrying the counts, the accuracy and the interval bounds; a recommendation that cannot state what it came from cannot be constructed. The page shows it behind "Show the numbers" rather than hiding it — advice a reader cannot check is indistinguishable from advice that was invented, and this product shipped invented advice once.
- **Advice the product cannot honour is not advice.** Every practice suggestion is joined against the **published bank for the student's own class**, so nothing can point at a topic with no questions behind it; a weakness in a topic published only for another class is still reported, with no link. Deep links (`/practice?subject=&topic=`) are re-validated by the Practice page against its own loaded options, so a bookmarked link to an archived topic degrades to the ordinary picker. The difficulty section cannot contradict itself either: a level flagged for consolidation suppresses any step-up above it.
- **The engine is a seam.** `lib/recommendationTypes.ts` is the entire contract: implement `RecommendationEngine`, register it, set `RECOMMENDATION_ENGINE`. Three properties are enforced rather than documented — an engine **cannot query a database** (a pure function of a facts object, like the reward catalogues), an engine **cannot describe itself** (the service stamps `engine`, `generatedAt` and `hasData` from the registry entry it invoked), and an engine that **throws** is caught so the statistical engine answers anyway. A failing model costs one panel, never the page.
- **Nothing is called AI, because no AI is involved.** Google Gemini was evaluated and deliberately not wired up: the five capabilities are questions about counts rather than about language; the data is **children's** performance records, which makes sending it to a third party a decision for the owner rather than a technical detail; and the MVP must run with no paid service. The default engine declares `kind: 'statistical'` and the page prints "No AI is involved" verbatim. This product already deleted one fake AI feature (`generateAIInsights()`), and re-applying the label to real arithmetic would be worse, because the numbers underneath are now good enough to be believed.

**Verified by 36 new tests (775 total, 23 files)**, weighted toward asserting a finding is *not* produced. One new environment variable with a working default, **no new model, no new permission, no new page and no new dependency**.

Before that, **Milestone 15 — Performance analytics: implemented.** The data had been accumulating for nine milestones and nothing read it. Four collections hold graded answers — `PracticeSession`, `MockTestAttempt`, `DailyChallengeAttempt`, `ExamAttempt` — while the analytics page read `StudentAnalytics`, a collection **nothing had ever written**, and told every student their accuracy was "not measured yet".

- **`StudentAnalytics` is deleted, not filled in.** It predated Milestone 4 and was the wrong shape (a string `studentId`; topics as **free text** with no `Topic` reference, so a rename would orphan a student's history); a stored breakdown drifts from the answers behind it, which is the argument that already keeps XP, levels, streaks and the leaderboard derived; and its `aiInsights` field was a live bug — mutated on every read, never saved. All three are gone, and with them the "AI insights" fiction: strengths and weaknesses are derived facts now, not generated prose.
- **All eight student figures are real**: accuracy, topic performance, subject performance, difficulty performance, time trends, progress trends, weak areas and strong areas. Counted from **submitted** attempts only — an abandoned paper measures nothing, and counting its blanks as wrong answers would libel the student.
- **Raw counts are summed; percentages are computed last.** Combining 1/1 in practice with 1/9 on a mock gives **20%**. The average of the two percentages is 55.6%, which would tell a struggling student they are better than half right. Summing counts makes that unwritable rather than merely discouraged, and a test pins the 20%.
- **`null` is not `0`, and a weak area needs a sample.** An accuracy with nothing behind it is null, because "has answered nothing" and "gets everything wrong" are different facts about a child. One wrong answer in a topic is noise: five answers minimum before anything is called a strength or a weakness, with the threshold reported so an empty list explains itself.
- **What the data could not answer was not invented.** No collection stores a per-question duration, so the pace trend is per *attempt* — the sitting's real duration over its real question count, labelled as such. The **daily challenge has no clock at all**, so it counts toward accuracy and progress and is **absent** from pace rather than being given a fabricated duration; the page says so.
- **Admin question performance** is the view staff did not have. A question nobody gets right is usually mis-keyed or mis-tagged rather than hard, and the only way to find one used to be a student complaining. Hardest-first, with a **skip rate** beside the accuracy, and a `minAnswered` floor so one wrong answer cannot top the list for ever. **Test performance** compares papers with a **median** beside the mean, because on a small cohort one blank submission moves the mean several points.
- **Efficient by construction.** One faceted aggregation per collection — grouping on the composite `{topic, subject, difficulty, type}` key, so all four breakdowns are sums over rows already in memory rather than four more round trips. Eight operations per page load, all narrowed by `student`, all parallel. The `$lookup` projects three fields; without that inner pipeline it would drag every question's text, options and **answer key** through the pipeline for every answer ever given.
- **Three indexes, one overdue.** `ExamAttempt` had **no index on `student` at all** — the unique `{exam, student}` index cannot serve a query naming a student without an exam, so every "everything this student has sat" read was a full collection scan, including the dashboard's exam panel. `MockTestAttempt` and `PracticeSession` gained the same key, because their existing indexes sort by *start* rather than submission.
- **Two subtleties found in the data, both now documented.** `answeredAt` is the **stored materialisation of `isAnswered()`**, so the aggregations read it rather than re-deriving the per-type rule — which would have been a second grader by another name; a test pins that it agrees with the attempt's own `unansweredCount`. And `isCorrect` is **three-valued** on a stored entry (`true` / `false` / `null` for unanswered), so `$ne: false` would have counted every blank as correct.

**Verified by 32 new tests (739 total, 22 files)**, every one seeded with declared outcomes — `['correct', 'wrong', 'blank']` — through the real `snapshotOf()` and `gradeEntries()`, so each asserts an exact figure rather than merely that a number exists. **Not yet driven through a real browser** — see "Known Bugs" #40.

Before that, **Milestone 14 — The notification system: implemented.** An audit came first, because Milestone 12 had already built half of it. **In-app notifications, unread/read state, notification history and staff-written announcements were real, tested, and deliberately left alone.** What Milestone 12 openly left out was delivery and automation, and that is this milestone.

- **Nothing user-facing waits on SMTP any more.** `sendEmail()` used to be *awaited inline* in registration and forgot-password, and it *swallowed* delivery failures — so a slow provider slowed every new student down, and a dead one **destroyed** the verification link they needed in order to log in at all, leaving no record and nothing to retry. Every message is now written to a new `EmailOutbox` collection **before** anything tries to send it; the request does one indexed insert and returns. `deliverEmail()` replaces `sendEmail()` and **throws** on failure, which is the change that makes a queue possible at all: a worker that cannot detect failure is not a worker.
- **This also closed a timing oracle.** `forgot-password` returns a deliberately identical message for a known and an unknown address so it cannot be used to enumerate accounts — but it only did that in *wording*. Awaiting a real SMTP round trip when the account existed, and skipping it when it did not, leaked exactly the fact the identical message was hiding. Queueing makes both paths the same speed.
- **There is no `sending` status, on purpose.** A row is claimed by pushing `nextAttemptAt` forward and incrementing `attempts` in one conditional write — a visibility timeout, not a state change. A `sending` state becomes a lie the moment a serverless container is frozen mid-send: the row would sit there for ever with nothing to move it. The honest consequence is **at-least-once** delivery, which is the right trade — a duplicate "your results are out" is an annoyance, a missing one is a student who never found out.
- **Delivery is driven two ways, because the free tier has no scheduler.** An opportunistic kick when a message is queued (started, never awaited) plus a lazy sweep on later requests — the same pattern already used for expired mock-test and exam attempts. Neither is a deadline, so the drain is *also* an explicit staff action rather than a hidden one.
- **Six real events now produce a notification** where previously every one was typed by a human: an official exam published (class, in-app only), **results released** (per candidate, emailed), a mock test published (class, in-app only), and account status / role / password changes (per student, emailed as `security`). The two broadcasts are deliberately not emailed — mailing a class every time staff publish practice material is the free-tier deliverability problem Milestone 12 declined to create.
- **`Notification` gained a third audience, `student`, which staff cannot address.** It is absent from the composer's schema rather than rejected by the handler. A per-student notice carries a score, a rank and a certificate tier, so a filter that leaked one row across the class boundary would be a disclosure bug rather than a display bug — and there is a test using two students in the *same* class, so the audience clause is what is under test.
- **Results and certificates produce one notification, not two**, because a certificate can only come from a result release and so would always arrive in the same second. The notice is built by **reading back the `Result` rows that were actually written**, not from a list the caller passed in, so what a student is told cannot disagree with the portal it links to.
- **Two switchable email streams, and two that deliberately are not.** `announcements` and `results` are per-student switches; `transactional` (verification and reset links) and `security` (password and status changes) always send. That asymmetry is the design — "you may switch off the warning that your password was changed" only ever helps an attacker — and the API returns the non-optional categories **with their reasons** so the page can state them rather than leaving the reader guessing. **Preferences control email only, never the inbox:** everything is always written, so declining an email never costs a student the message.
- **Emailing a broadcast is opt-in, capped and honestly reported.** Staff tick it per announcement, it resets after every send, and recipients who opted out are counted and shown — "60 queued, 12 skipped" — because staff who see "0 queued" with no explanation will conclude it is broken and send it again.
- **Failure is finally visible.** `/admin/email-deliveries` shows every message with its attempt count and the provider's own error text, plus counted statistics and "send now" / "requeue failed". `oldestPendingAt` is there because a pending count alone cannot answer "is the queue stuck?".

One new model (`EmailOutbox`), **no new permissions** (the console reuses `notifications:write`), **no new environment variables and no new dependency** — the transport was already provider-agnostic SMTP, so any free tier works through the existing `SMTP_*` vars.

**Verified by 46 new tests (707 total, 21 files)**, most of which make delivery fail on purpose: a request that succeeds anyway, a message retried rather than lost, a *recovered* provider that genuinely delivers on a later attempt, a terminal give-up that stays visible, two concurrent drains that cannot double-send, and a dead provider that does not turn `forgot-password` into an enumeration oracle. **Not yet driven through a real browser** — see "Known Bugs" #40.

Before that, **Milestone 13 — The official exam and the certificate system: implemented.** This is the thing the product is named after, and it was the largest remaining gap. It also closed the one Milestone 12 recorded and deliberately left open: `ExamAttempt` and `Result` were read by the product and written by nothing, so a certificate could not exist without inventing eligibility.

- **The official Olympiad is its own collection**, not a `MockTest` with `maxAttempts: 1`. Three things differ by design: the window is **mandatory** (organisers announce a timeline, so an exam with no window is not an exam); there is **one attempt ever**, enforced by a unique index on `{exam, student}` rather than by counting, because on serverless a read and its write can land in different invocations; and **submitting reveals no score**, because a score is not a result — a result is an announcement the organisers make once the window has closed and ranks can be computed against the whole cohort.
- **`ExamAttempt` and `Result` were rewritten**, not wired. The old shapes predated Milestone 4 — a string `studentId`, a single `selectedOption` per answer (so a multiple-choice answer could not be represented at all), and no answer-key snapshot. Neither had ever been written, so there was nothing to migrate. `snapshotOf()` moved to `services/attemptSnapshot.ts` so mock tests and the exam share one snapshot.
- **Releasing results is one administrative act** that computes ranks and mints certificates together, because a published result without a certificate — or a certificate without a published result — is a state nothing in the product knows how to describe. It sweeps expired attempts first, so an abandoned paper is graded and ranked rather than dropped in a way that would flatter every other rank. **Equal scores share a rank** (1, 2, 2, 4), the same rule the leaderboard uses. It is idempotent, and publishing while the window is still open is refused.
- **Certificates can only come from the official exam.** There is **no issuance route anywhere** — not for a student, not for an administrator — which is what makes the frontend unable to manufacture eligibility: it is never asked. Tiers are participation / merit / distinction from **per-exam** thresholds. Every printable field is **snapshotted at issuance** and the PDF renders from that snapshot alone, so correcting a name or re-tuning a threshold years later cannot alter a certificate already in somebody's hands.
- **Two identifiers, on purpose.** `certificateId` is a readable serial and guessable by design; `verificationCode` is 16 symbols of `crypto` randomness and is what public verification keys on. Keeping them apart is what stops verification becoming an enumeration oracle over every entrant's name, school and rank.
- **PDFs are rendered server-side by `pdf-lib`** — one MIT package, pure JavaScript, no native binary and no headless browser, so it runs in a Vercel serverless function on the free tier. The gold founder signature is Times italic in `#D4AF37` rather than a licensed script font, and the AMIT OLYMPIAD seal is **drawn from primitives** rather than embedded as an asset.
- **Revocation tells the truth**: a revoked certificate reports as *revoked, with its details*, never as "not found" — a printed copy exists in the world whatever the database says.

Before that, **Milestone 12 — Complete Admin Platform: twelve of fourteen areas, and two openly left out.** An audit came first, because eight of the fourteen requested areas already existed and rebuilding them would have produced duplicate routes. New: an **event gallery** (public page + admin CRUD, images in MongoDB capped at 1 MB, magic-byte validated), **in-app notifications** (one document with an audience rule, a student inbox with real read state, a `readCount` per announcement), **platform analytics** where every figure is counted from a collection, an **unmasked admin leaderboard**, and a badges/achievements overview. Results and certificates were deliberately excluded, and Milestone 13 is what made them buildable. **Two bugs were found by running the page rather than by a test**, and both are now pinned by regression tests: `shiftDay(key, n)` counts *backwards*, so the 7- and 30-day windows had been computed with the sign inverted and silently read zero however busy the platform was; and `distinct('student')` over the activity log reported 12 active students against 11 registered, because the log outlives the accounts it points at.

Before that, **Milestone 11 — Account administration, and a real super-admin account.** The super administrator is auto-provisioned from `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` on first sign-in and now holds a rotating refresh token, a revocable `tokenVersion`, a `studentId` and a row in `/admin/users` like any other account — the environment variables became the bootstrap *seed* rather than the ongoing source of truth. The `root: true` claim, `ADMIN_TOKEN_TTL` and the role-check exemption in `resolveCurrentRole()` are gone, so **every** privileged request re-reads the role from the database. Staff also gained password reset, forced sign-out, a fourth `blocked` status and super-admin-only delete.

Before that, **Milestone 10 — Leaderboards and Hall of Fame: implemented and verified end-to-end.** The leaderboard has been real since Milestone 5 — one board, overall, all-time, top ten. This milestone turned a figure on the dashboard into a feature.

- **One ranking service.** `services/leaderboardService.ts` is now the only place a rank is decided; the ranking code moved out of `progressService.ts`, where it had grown as a corner of "the dashboard's figures". All four surfaces that show a standing — the landing page, the dashboard's rank tile, the `/leaderboard` page and the Hall of Fame's XP board — use it, so a rank cannot disagree with itself on two pages.
- **Still nothing is stored.** There is no `Leaderboard` collection. A board is an aggregation over `StudentActivity`, the same log XP, levels and streaks come from, so a standing cannot drift from the totals it claims to rank — it *is* those totals. **Scopes** (overall / per class) and **periods** (all time / 30 / 7 / 1 competition days) are filters on that one pipeline, not stored variants. A class board ranks *within* the class; a period board ranks on XP earned *inside* the window.
- **Tie-breaking is defined rather than assumed.** Equal XP **shares a rank** — standard competition ranking, so a board reads 1, 2, 2, 4; inventing a winner between two students who earned the same amount would be a fabricated distinction. The order within a tie is a *total* one: XP descending, then whoever reached the total first, then the account id. The last key is not decoration — without a final unique key, pagination can show a row on two pages or on none.
- **Pagination whose ranks survive the boundary.** Rank is position in the full ordering, not in the page. The first row's rank comes from counting how many students are strictly ahead (the only row whose rank cannot be derived locally, because a tie may straddle the boundary); each later row either drops to its absolute position or inherits. Deliberately not `$setWindowFields`, so the correctness of a student's rank does not depend on the MongoDB server version underneath it.
- **No client-supplied value is trusted.** The entire input surface is a scope, a class, a period and a page. XP, score and rank are not filtered out by the handler — they are absent from the zod schema, and `validate()` replaces the query with the parse result. Every number is a `$sum` over rows this backend wrote.
- **The public board keeps its anti-enumeration property.** A signed-out visitor may page the top 100 only; a signed-in student may page it all. Before pagination, "cannot be walked to enumerate the roll" was guaranteed by the 50-row cap; pagination removes that by itself, so it was restored explicitly. The entrants are minors and the page is indexable.
- **A Hall of Fame of genuine achievement.** Five boards measuring five different things, because XP measures participation more than ability and a hall of fame that only re-ranked it would be the leaderboard with a nicer heading: XP champions, best mock-test paper by *percentage*, longest streak, most *correct* daily challenges, most *submitted* practice sessions. **An empty board is returned empty, with a reason naming what would fill it** — never padded. There is deliberately no official-exam board, because that competition has not been run.

Verified in a real browser against eleven ranked students created through the real registration and reward paths: the guest board showed 1, 2, 3, then **two sharing #4**, then six sharing **#6** with rank 5 correctly skipped; the Class 9 board ranked its three students **1, 1, 1** rather than 6, 6, 6; signing in earned that student the day's visit and moved them **live into a three-way tie at rank 4**, with their standing card matching the row marked "You" and the next distinct XP resuming at #7; an anonymous request for page 3 of 50 was **403**, the same request signed in was 200; and `?xp=999999&rank=1` changed nothing. All five Hall of Fame boards were populated from data earlier milestones' real usage had left in the local database.

Before that, **Milestone 9 — Gamification Engine: implemented and verified end-to-end.** XP, levels, streaks and achievements were already real and derived by Milestones 5–8; this milestone did the four things genuinely missing.

- **One reward engine.** `services/rewardService.ts` → `grantReward()` is now the only way anything earns XP, and all twelve call sites across five routes go through it. Pricing was already centralised — *entitlement* was not: "practice pays only if something was answered" was an `if` written inline in two different routes, and a sixth surface would have written a sixth rule. Callers now supply facts about what happened; the engine decides eligibility and amount. The refactor was behaviour-preserving, and the evidence is that all 455 existing tests passed unchanged immediately after it.
- **Badges became a distinct concept.** They were "delivered as Achievements", which was one idea under two names. A badge is now a **family held at a tier** — bronze, silver, gold — that keeps levelling; an achievement is a one-off goal that stops changing once earned. Five families, ten achievements.
- **The journey map.** Nine ordered stages with exactly one marked *next*, answering the question the other two catalogues do not: what should I do now? Stages measure **cumulative** facts, so a broken streak cannot un-complete a stage the student really reached.
- **An administrator-tunable award table**, at `/admin/reward-settings` under a new `rewards:write` permission — which is safe **only because of a Milestone 5 decision**: `StudentActivity.xpAwarded` is a snapshot, so re-pricing changes what the next event pays and cannot touch a point anybody already holds. Only amounts are configurable; cardinality, eligibility and the level thresholds stay in code.

Three catalogues (`lib/achievements.ts`, `lib/badges.ts`, `lib/journey.ts`) are now **pure functions of one facts object** (`lib/rewardFacts.ts`), assembled once by the engine. None of them reads a database, and if a fact is not on that interface, no badge can be awarded for it — the friction that has kept unearnable rows off the dashboard.

Verified in a real browser: a student's `/rewards` page showed Level 2 · 135 XP with real counts, the journey at 3 of 9 with *Email verified* correctly flagged next, badges 3 of 5 held, achievements 3 of 10. An administrator then re-priced `daily_visit` from 10 to 40 — the student's total **stayed at 135** and their existing rows stayed at 10, while the next grant paid 40. Future re-priced, history untouched.

Before that, **Milestone 8 — Daily Challenge: implemented and verified end-to-end.** One question a day, per class: a student opens it, answers it once, and is marked immediately with the correct answer and the author's explanation, earning 15 XP for taking part. Staff can schedule days in advance from the published bank; a day nobody scheduled fills itself. Every attempt is persisted, and the reward cannot be claimed twice.

Four properties, each enforced in one place:

- **A day's challenge is pinned, not recomputed.** This closed a real defect rather than adding a feature. The old picker was `hash(day) % publishedQuestionCount`, so **publishing any question changed which question "today" was, mid-day, for a whole class** — and a past day could not be recovered at all, because the bank it was derived from had moved on. A challenge is now a `DailyChallenge` document, written once (by staff ahead of time, or automatically on first request) and read thereafter. A test publishes ten more questions after a day has been served and asserts the day's question does not move.
- **One reward per competition day, guarded twice.** A unique index on `DailyChallengeAttempt {student, day}` makes a second attempt impossible, and `recordActivity()` independently caps the XP through its own partial unique index. Two collections, two keys, two moments — a bug in either is not a paid exploit. A repeat submission is answered **200 with `alreadyAnswered: true` and `xpAwarded: 0`**, because the student really has answered today.
- **The day is an IST calendar day, and only the server decides it.** No student route accepts a day, so yesterday cannot be claimed by naming it and a browser in another timezone cannot disagree about which challenge is today's. Tested at the boundary as arithmetic (18:35 UTC is already the next IST day) and through the API by turning the day over.
- **XP and achievements are reached only through their own services.** The challenge service never writes an activity row and never prices an event; the achievement catalogue never reads a database. The whole interface is two counts on `ProgressFacts`. Two new achievements — **Challenger** and **Five days sharp** — are the first that require answering something, and are admissible under the catalogue's "nothing unearnable" rule only because attempts are now recorded.

Verified in a real browser: a Class 12 student was served a pinned Probability question, answered `0.25`, and was marked **correct, 3/3, +15 XP** with the tolerance and worked explanation shown; the dashboard then read **125 XP** — exactly one award — with the activity row and the **Challenger** achievement. On the admin side the day showed as **Automatic · 1 answered · 100% correct** and could no longer be cleared, while a newly scheduled tomorrow showed **Scheduled · 0 answered · —** and could.

Before that, **Milestone 7 — Mock Test System: implemented and verified end-to-end.** Staff assemble a timed paper from published questions, price each question for that paper, set a duration, an attempt limit, an availability window and the instructions, choose independently when students may see their score and when they may see the answers, and publish or unpublish it. A student sees the tests set for their own class, starts one, works through it with free navigation and per-answer autosave under a countdown, and submits — or has the paper submitted for them when the time runs out. Every attempt, every answer, its correctness, the per-question marks, the score, the time taken and the reason it closed are persisted, and staff get a ranked results table with cohort statistics and per-question outcomes.

**This is the first assessment in the product.** Practice is self-chosen and untimed; the official Olympiad is still unbuilt. A mock test is the first thing here that measures a student against a paper somebody else set, under a clock.

Four properties the design is built around, each enforced in one place:

- **The backend enforces timing; the browser's countdown is a display.** `MockTestAttempt.expiresAt` is computed and stored when the attempt is created — `startedAt + duration`, clamped to the test's closing time — and never recomputed, so an author changing the duration mid-paper cannot move a finishing line somebody is already running at. An answer arriving after the deadline is refused with 409 and **not stored**. A submission arriving late is still graded, *as at the deadline*, and recorded as having run out of time. No request body on any mock-test route carries a time at all; a test posts `expiresAt`, `secondsRemaining`, `durationMinutes`, `timeTakenSeconds` and `startedAt` alongside a legitimate answer and asserts the stored deadline does not move.
- **Exactly one submission.** The closing write is conditional on the attempt still being open, so of two concurrent submissions exactly one grades it and the other receives the stored result — tested with genuinely concurrent requests, asserting one lot of XP and an unmoved `submittedAt`. A unique index on `{test, student, attemptNumber}` does the same for two requests racing to *start*: the loser resumes the winner's attempt rather than creating a second one.
- **The answer key does not leak, now under a policy.** "Submitted" is no longer sufficient authority to reveal an answer — the test's own `reviewPolicy` decides, and it may say `after_close` or `never`. `attemptReviewView()` is the only function that reveals one and refuses unless the attempt is submitted *and* the policy currently permits it. Three response shapes exist rather than one with fields the page is trusted not to render.
- **Marked against the paper as served.** Each served question snapshots its answer key and marks at serve time, so editing or re-pricing a question afterwards cannot change a mark already awarded — proved by a test that moves the correct option to a different letter after the student answered and still scores them correct, while telling them the question has since been edited.

Two things were extracted rather than copied, because duplicating them would have been the dangerous kind: `models/attemptAnswer.ts` holds the one definition of a served question with its snapshot, and `services/grading.ts` the one implementation of the marking rules. Both are shared by practice and mock tests. Two graders would eventually have disagreed, and a grader that disagrees with the answer key is a wrong score on a student's report.

Verified in a real browser end to end: a 1-minute, 2-question, 8-mark Physics paper built from the seeded Class 12 bank, published, then sat by a newly registered Class 12 student — **submitted automatically when the countdown reached zero**, scoring 4/8 with 100% accuracy of answered, 59s recorded and +50 XP, with answers and explanations revealed only after submission. The attempt limit then refused a second try, and the admin results page showed the ranked row and per-question outcomes.

Before that, **Milestone 6 — Practice Zone: implemented and verified end-to-end.** A student chooses a subject, a topic and optionally a difficulty, is served real published questions for their own class, answers and navigates them freely, submits, and gets a server-marked review with correct answers, explanations and a performance summary. The session, every question served, every answer, its correctness, the score, the time taken and the completion status are all persisted in a new `PracticeSession` collection.

**Answer integrity is the property the design is built around**: a correct answer leaves the server only after the session containing it has been submitted. The in-progress view composes the same answer-stripped projection the question endpoints use; the single function that reveals an answer throws unless the session is submitted; and grading is server-side, so the browser is never given anything to mark with. This is a real improvement on what it replaced — the old practice page marked answers in the client and therefore shipped the whole paper's answer key in its JavaScript bundle.

Verified in a real browser end to end: a five-question paper across all four question types scored **5/17** (+4 correct, −1 wrong, −1 for a partially-correct multiple choice, +3 correct, 0 for a blank), 50% accuracy over answered, 4m 15s recorded, +25 XP, with correct answers and explanations revealed only after submission.

Before that, **Milestone 5 — Student Profile and Dashboard: implemented and verified end-to-end.** A student can now see and change their own account, and the dashboard reports real progress. The governing requirement was **no fake statistics**, and it holds: every figure on every page this milestone touched is derived from a database read, and where a student has no data the panel says so and explains why.

- **Profile and settings** — a new `/profile` page: edit the nine registration fields, replace the photo, change the password. This closes the two longest-standing gaps in the product ("no one can edit their own details after registering", and known bug #9 "a photo cannot be replaced or removed"), both of which previously needed a direct database edit.
- **Progress, derived not stored** — a new `StudentActivity` collection is the single source of truth for XP, levels, streaks and achievements. There is deliberately no counter document: XP is a `$sum` over real events, the level a pure function of it, the streak computed from the distinct days present. XP accrues only from events that really happen (account created 50, email verified 50, daily visit 10), so a freshly verified account holds an explainable **110** rather than a flattering number.
- **Dashboard rewritten** — the three invented stat tiles and the three-name fake leaderboard are gone, replaced by XP/level with progress to the next, current and best streak, leaderboard rank, achievements with real progress toward the locked ones, a real activity feed, practice availability from the published bank for the student's own class, and test performance.
- **Two mock endpoints became real** — `GET /leaderboard` aggregates actual XP, `GET /daily-challenge` returns a deterministic published question (and is now authenticated, where the mock was open), and a new `GET /public/stats` feeds the landing page. The landing page's invented "Today's Champions" and four headline figures are gone.

**A follow-up pass on 2026-08-11 then removed every remaining piece of placeholder data in the product** — the result portal, certificate page, exam paper, student report and admin chart — and added a global light/dark theme, light by default. No endpoint or page returns fabricated data any more. Several return empty results, which is a different thing: they are live queries against collections that are genuinely empty until exam submission exists, so each starts working by itself when it lands.

Before that, **Milestone 4 — Complete Question Bank System: implemented and verified end-to-end.** Questions are authored, reviewed and published through a real admin interface: a subject / topic / subtopic taxonomy, four question types with per-type answer shapes, marks and negative marks, an editorial workflow, tags, and search / filter / sort / pagination. Mathematics is written as LaTeX and rendered with KaTeX through a text/math split that keeps author content out of every HTML sink. It also closed a serious hole: `GET /questions` was **unauthenticated and returned the answer key**.

Before that, **registration data capture: implemented and verified end-to-end.** Registration collects the full entrant record the owner specified — three name parts, both parents' names, date of birth, class, school, full address, mobile, email and a mandatory photo — and writes every field to MongoDB in the same request. Previously it stored only name/mobile/email/password. Photos live in a new `StudentPhoto` collection and are served by an authorization-checked endpoint.

Before that, **Milestone 3 — RBAC and User Management Foundation: implemented and verified end-to-end.** Authorization is now permission-based with a single role → permission table, three roles exist (`student` / `admin` / `superadmin`), administrators can be created and managed from the app, account status finally has a UI, and every administrative action — plus every refused one — is written to a queryable audit trail. Privileged requests re-read the caller's role from the database, so revoking access takes effect immediately rather than at token expiry.



## Last Completed Milestone

**Milestone 20 — the AI question generator on the official Gemini SDK, with structured output and review tooling (2026-08-18).** Before it, the complete security audit (2026-08-17), which is a hardening pass rather than a milestone. Before that, **Milestone 19 — Payments, and the entry fee that gates the platform.** Preceded by Milestone 18 (generated questions need a human before they exist), Milestone 17 (AI question drafting), Milestone 16 (intelligent performance recommendations), Milestone 15 (performance analytics), Milestone 14 (the notification system), Milestone 13 (the official exam and the certificate system), Milestone 12 (Complete Admin Platform), Milestone 11 (Account administration and a real super-admin account), Milestone 10 (Leaderboards and Hall of Fame), Milestone 9 (Gamification Engine), Milestone 8 (Daily Challenge), Milestone 7 (Mock Test System), Milestone 6 (Practice Zone), Milestone 5 (student profile and dashboard), Milestone 4 (complete question bank), Milestone 3 (RBAC and user management), Milestone 2 (complete authentication), Milestone 1 (backend & database foundation) and Phase 0 (repository audit).

## Current Milestone

**Milestone 21 — Bulk question import, Mathematics-only scope, Classes 3–12. PHASES A–I COMPLETE.**

**Latest verified state: 1121 passing across 31 files.** `npm run lint`, `npm run compile` and the
frontend `tsc -b` + `npm run build` are clean. (The one `npm run typecheck` failure is a concurrent
session's analytics change, not this milestone's — see "What remains" below.)

**Owner-requested additions after Phase I (2026-08-23), implemented and verified.** Four asks, one
of which was already true:

1. **No Subject in bulk upload** — already the case. The import page has never had a subject picker;
   it resolves the chapter list internally and derives the subject from the chapter.
2. **The chapter is now optional and detected from the question.** `lib/chapterDetection.ts` is a
   **pure, deterministic** function of the question text and the chapter names — **no model**, for
   the reason the Phase D ADR gives for `.docx`. Precedence: what the file states, then detection,
   then the examiner’s fallback. It **suggests and never guesses**: `matched` carries a note naming
   the words it matched, `ambiguous` **names the candidates** rather than choosing, and `none`
   reports the row by its number. A question in the wrong chapter is served to a student practising
   something else and corrupts the per-topic analytics. The **manual editor** uses the same
   function, so the two cannot disagree about what a question looks like.
3. **Chapter-wise** and **4. whole-syllabus** papers: `GET /admin/questions/paper-suggestion` plus a
   *Fill from / How many* control in the mock-test author. The whole-syllabus option **spreads**
   round-robin across every chapter that has published questions for the class — the top of the bank
   is the most *recent* questions, which in a bank filled chapter by chapter is one or two chapters
   and not a syllabus.

> **Two real bugs were caught before shipping, both by the browser pass.** A whole-syllabus Class 12
> paper came back containing **Physics** chapters, because the spread was scoped by class alone and
> this database holds a legacy Physics subject; it is now scoped to the implicit subject via a new
> shared `findImplicitSubject()` / `requireImplicitSubject()` pair in `taxonomyService.ts`, so the
> endpoint is right **regardless of whether that data is ever deleted**. And the stemmer turned
> `derivatives` into `derivativ` while `derivative` stayed whole, so the two never compared equal and
> detection was leaning entirely on a loose prefix fallback.

`ImportBatch` gained a `subject` field: approval used to derive the subject from `defaultTopic`,
which broke the moment the chapter became optional — an import that left the chapter to detection
had nothing to derive from and would have been unapprovable for a reason the examiner could not act
on. There is a fallback to the old derivation for rows written before the field existed.

**Phase G (making imported questions practisable) is implemented and verified.** From the Question
Bank an administrator selects questions and publishes them in one action — which **is** how a
question becomes practice content, because Practice samples what is published for the student’s own
class. A class picker beside it shows what that class can now practise, read from the **same**
`getPracticeAvailability()` the student picker uses so the preview cannot disagree with the thing it
previews. `changeQuestionStatusBulk()` **loops** over `changeQuestionStatus()` rather than issuing an
`updateMany`, and that is the point rather than a missing optimisation: a bulk write would skip
`assertPublishable()`, which refuses a question with no solution or no resolvable answer key. It was
1097 passing across 30 files at the end of it.

**Phases H and I (mock test and daily challenge from a selection) are implemented and verified.**
No backend change was needed — both APIs already accepted explicit question ids.
`pages/Admin/questionHandoff.ts` owns the eligibility rules and returns either a URL or the *reason*
the action is unavailable, so a disabled button explains itself. The browser pass found a
**pre-existing race** in both question pickers, where an earlier response could overwrite a newer
one — fixed, and recorded in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

**Phase F (the import review screen) is implemented and verified, which completes bulk import.**
`npm test --prefix backend` is **1086 passing across 30 files** (882/26 before this milestone;
944/27 after Phase B; 1001/28 after C; 1039/29 after D; 1078/30 after E), and `npm run lint`,
`npm run compile` and the frontend `tsc -b` + `npm run build` are all clean.

**An administrator can now do the whole thing from the admin panel**: open **Bulk Import**
(`/admin/questions/import`), pick Excel / Word / Photographs, download the Excel template, set
the defaults, upload, read exactly what was and was not extracted, correct anything, check it,
and approve as drafts or publish. Phases C–E built the parsers; this is the page that makes them
reachable by somebody who does not use `curl`.

One page with a tab per format over **one** review screen, because every parser normalises into
the same candidate — three review screens would be three places for the approve payload to drift
out of step with the backend. Phase F also added **`POST /admin/questions/import/validate`**, the
dry run, which calls the same `screenEach()` approval calls so its answer *is* the answer
approval will give.

> **Two client-side bugs were found by driving the page in a browser, and neither was reachable
> from the backend suite.** The page rendered *"Saved undefined questions"* because it assumed a
> `created` count the approve route does not return; fixing that revealed `published` and
> `publishFailures` were being ignored, so "Approve & publish" would have claimed to publish
> questions that stayed as drafts for want of a solution. Both fixed, both recorded in
> [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md). The lesson is in `TESTING.md`: **the frontend has
> no test suite, so a browser pass is not optional for a new admin page** — it is the only thing
> that checks the response contract from the consuming side.

The browser verification ran against the **local dev database** (`npm run dev:local`, never
`npm start`) and its rows were deleted afterwards, so nothing was left behind.

**Phase E (image import) is implemented and verified.** It was 1078 passing across 30 files at
the end of it.

> **One typecheck error is outstanding and it is not from this milestone.** A concurrent session
> is editing student analytics (adding `STRONG_AREA_MIN_ACCURACY` / `WEAK_AREA_MAX_ACCURACY` and
> two new required fields on `StudentAnalytics`), and `tests/recommendations.test.ts` — which that
> session has not touched — still builds the old shape. `npm run typecheck` therefore reports
> `TS2739` in that file. `npm run compile` is clean because it excludes tests, and the whole suite
> passes at runtime. It was deliberately **not** fixed here: it is mid-flight work in another
> session's files, and editing them would only create a conflict. Whoever finishes that change
> needs to add the two fields to the analytics literal in that test.

Phase E added `services/imageImportParser.ts` and — the more structural change —
**`requestGeminiJson()`**, extracted from `geminiQuestionGenerator.generate()` so that there is
now literally **one function in the codebase that calls a language model**. What it owns is the
set of things already got wrong once and documented: the client via `clientFactory` (the test
seam, so no test can reach the network), the credential check, `attemptGenerate()` and its single
shared deadline, `describeFailure()`, `redact()`, and the blocked-prompt and `MAX_TOKENS` cases.
The generator's 52 tests pass unchanged, which is the evidence the extraction was behaviour-neutral.

**The model transcribes; our own code decides what the answer means.** The response schema asks
for what is *printed* — the question, the options, and the answer **as written** — and
deliberately carries no `isCorrect`, `booleanAnswer`, `numericAnswer` or `marks`. Those are
derived by `lib/importAnswerText.ts`, the same readers a spreadsheet and a Word file go through,
so this phase needed **no new answer reading at all**. Asking a model to fill in typed answer
fields would make it the authority on what counts as correct, which is the one thing that must
not be wrong.

**A question with no printed answer is refused, never given one** — a calculated answer is
indistinguishable from a printed one, and children would be marked against it. `marks`, `class`
and `topic` come from the upload defaults only, never off the page. Every image import carries a
standing warning that OCR of mathematical notation is where transcription is least reliable; that
is not boilerplate, it is the only control besides the mandatory review.

**Phase D (the DOCX importer) is implemented and verified.** It was 1039 passing across 29 files
at the end of it.

**What an administrator can do at the end of Phase D: import an `.xlsx` or a `.docx`, through the
API only.** There is still **no page** — that is Phase F — so it is exercisable with `curl` or
Postman and not from the admin panel, and **the feature is not usable by a non-technical
administrator yet.** The image route still answers **503**. Do not report this milestone as "bulk
import works".

Phase D added `services/docxImportParser.ts`, plus two shared modules extracted from the Excel
parser: **`lib/importAnswerText.ts`** (the one reading of a human-written answer — "the answer is
B" must mean the same thing in a spreadsheet cell and on an `Answer: B` line) and
**`lib/ooxml.ts`** (which OOXML file this is, answered without inflating it). Also
`ParseOutcome.notes`, a file-level advisory channel surfaced in `batchWarnings`, and
`tests/docxImport.test.ts` (38 tests) with `tests/helpers/docx.ts`, which builds real `.docx` files
from `jszip` — already present as `mammoth`'s own dependency, so nothing new was installed.

DOCX extraction is **deterministic and deliberately AI-free** (see the Milestone 21 ADR): a `.docx`
is text we already have, and a model would add cost, latency, a third party on every import, and a
credential dependency in a *core* format. What absorbs the reduced capability is that it **never
guesses quietly** — every interpretation is a note, every unusable block is a failure naming its
question number, and a document that yields nothing says what was looked for.

**Two Word failure modes look like success and are warned about explicitly.** Word's automatic
numbering does not survive text extraction, so a document numbered from the toolbar would merge
into one question — there is an `Answer:`-terminated fallback that announces itself. And Word
equation objects are dropped silently by `mammoth`, so an affected question imports with its
formula missing mid-sentence. Both are in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

Three defects were found by the new tests and fixed: `Q.1` and `Q1` were not recognised as markers
(the terminator is now optional when the `Q` prefix is present); a document containing a **single**
question kept `Q1.` glued to its text, because marker mode needed two markers; and a file of
ordinary prose came back as one enormous "question", because the answer-terminated fallback did not
check that any answer line existed.

**Phase C (the Excel importer) is implemented and verified.** It was 1001 passing across 28 files
at the end of it.

Phase C added `services/excelImportParser.ts` and `GET /admin/questions/import/excel/template`, plus
`tests/excelImport.test.ts` (57 tests, building **real** `.xlsx` files and pushing them through the
real route). The parser is a **shape adapter**, not a gate: a row that cannot become a candidate is a
failure naming its row number, a row that becomes a bad candidate is left to the one shared screener,
and a row we interpreted carries an advisory note. It is deliberately tolerant of the *file* (any
column order, loose headings, a title row above the header, every sheet read) and strict about the
*data* (a `Class` of 13, an unknown chapter or a non-numeric `Marks` is reported with its row number,
never defaulted).

Two defects were found by the new tests and fixed. **The template's own Instructions sheet was being
imported as twelve questions**, because a header detector needing one matching column read that
sheet's glossary — whose first cell is the word `Question` — as a header; any workbook with a legend
has that shape. And **the example rows named chapters that exist only in this project's seed data**,
so an examiner's first import would have opened with five rejected rows. Both are in
[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

**Phase B (shared bulk-import infrastructure and validation) is implemented and verified.** It was
944 passing across 27 files at the end of it.

What exists: `lib/importTypes.ts` (the seam), `validation/uploadSchemas.ts` (magic bytes, sizes,
filenames), `validation/importSchemas.ts`, `models/ImportBatch.ts` (the 27th model),
`services/questionImportService.ts` (preview → approve, approval being the only writer),
`routes/v1/questionsImport.routes.ts` (five endpoints on `questions:write`), `importLimiter`, two env
vars, three new `QUESTION_SOURCES` values, the `questions.imported` audit action, and
`tests/questionImport.test.ts` (62 tests).

Two dependencies landed for Phases C and D: **`exceljs`** and **`mammoth`**, both free. Images need
neither. See the Milestone 21 dependency ADR for the `exceljs` → `uuid` advisory and why it is not
reachable.

Three defects were found by the new tests and fixed — the important one being that **every rejected
upload answered 500 instead of 400**, because zod 4 runs an array-level check even after a child failed
and hands it `undefined`. Logged in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md), along with a patch-script
trap (`$` in a `String.replace` replacement) that is worth knowing in a codebase full of `$…$` LaTeX and
`$match` pipelines.

### Phase A findings, unchanged and still the map

The owner asked for bulk question import from Excel (`.xlsx`), Word (`.docx`) and images, a unified review-before-import screen, assignment of imported questions to Practice / Mock Tests / Daily Challenges, a class range of **3–12**, and the removal of **Subject** as a user-facing concept (Mathematics becomes the implicit domain). The work is being done in the phases the owner specified (A–L), stopping for approval after each.


Measured against the code on 2026-08-18, with a green baseline established first (**882 tests / 26 files passing**, backend typecheck + lint clean, frontend `tsc -b` clean, oxlint warnings only, working tree clean at `7978e4a`).

1. **Class validation is already centralised and does not need rebuilding.** `backend/src/lib/classLevels.ts` is the single definition, mirrored (as a list only, never as enforcement) in `frontend/src/api/types.ts`. No `'Class N'` literal exists anywhere else in `backend/src/`; every schema and model imports `CLASS_LEVELS`. The spec's "centralize class validation" is therefore already satisfied — what changes is the *contents* of that list, not its location.
2. **The current class list is neither 3–12 nor flat.** It is `'Class 5'`–`'Class 11'` plus **three Class-12 streams** (`'Class 12 - Science'`, `'- Commerce'`, `'- Humanities'`), which exist because the code records that the competition paper differs by stream. Owner decision (2026-08-18): **keep the string format**, extend to `'Class 3'`–`'Class 12'`, and **collapse the three streams into one `'Class 12'`**. Numeric 3–12 was rejected as too large a migration — `classLevel` is a stored enum on eight collections, plus roughly 160 test literals.
3. **There is no import infrastructure of any kind**, and no `multer` / `xlsx` / `docx` dependency. Uploads in this product travel as **base64 data URLs inside the JSON body**, validated by **magic bytes** (`validation/imageSchemas.ts`) under a per-path body limit in `app.ts` — the registration photo and the event gallery both work this way. Bulk import should follow that precedent, because it means **nothing is ever written to disk**: temporary-file cleanup, safe filenames and path traversal stop being risks by construction rather than by care.
4. **The AI generator’s architecture is the right skeleton for import and should be reused, not paralleled.** `services/questionGeneratorService.ts` already implements the exact shape the import spec describes: propose → screen (`screenCandidates()`, one shared gate) → dry-run validate → **approve is the only writer**, re-validating from scratch. `GeneratedCandidate` (`lib/questionGeneratorTypes.ts`) is a provider-agnostic candidate carrying **no taxonomy**, so an Excel row, a DOCX block and an OCR’d image should all normalise into it. Duplicate detection already exists (`similarity()`, Jaccard over stop-word-filtered fingerprints, threshold `0.8`), already checks the batch *and* the bank, and already reports rather than silently dropping.
5. **The question lifecycle the spec asks for already exists and must not be duplicated.** `QUESTION_STATUSES` is `draft → in_review → published → archived`, with a transition table in `questionService.ts`. The spec’s `IMPORTED → REVIEW_REQUIRED → APPROVED → AVAILABLE` maps onto it with **no new states**: nothing is stored before approval (as with generation), approval creates a `draft`, and publishing stays the separate explicit act it already is.
6. **Source tracking exists but is narrower than the spec.** `Question.provenance.source` is `QUESTION_SOURCES = ['human', 'ai_assisted']`; the spec wants `EXCEL_IMPORT` / `DOCX_IMPORT` / `IMAGE_IMPORT` alongside `MANUAL` / `AI_GENERATED`. That is an additive enum change on an embedded subdocument (no new model). Note that `provenance` is deliberately **a parameter of `createQuestion()` rather than part of any request body** — a client must not be able to file machine-written questions as hand-written ones. Extend that mechanism; do not add a body field.
7. **“Assign to Practice” has nothing to assign to.** Practice is **student-initiated**: `startPracticeSession()` `$sample`s published questions matching a class / topic / difficulty filter the *student* chose. There is no `PracticeSet` entity and no admin curation anywhere. So “select 30 approved questions → create a Practice Set” would be **new architecture**, not reuse — and the spec forbids a second Practice system. The honest reading is that a question **becomes** practice content by being published with the right class and topic. Mock Tests and Daily Challenges are different: both already accept explicit question ids (`createMockTestSchema.questions`, `scheduleChallengeSchema.questionId`), so assignment there is a frontend affordance over existing APIs. **This needs the owner’s agreement before Phase G.**
8. **A user-facing Subject concept is present in eight frontend surfaces**, most substantially `pages/Admin/Taxonomy.tsx` (a full subject-management UI, 77 references), the student `pages/Practice/Practice.tsx` picker (47), `Admin/QuestionForm.tsx`, `Admin/Questions.tsx`, `AiGenerator/AiGenerator.tsx`, `Admin/MockTestForm.tsx`, `Admin/DailyChallenges.tsx`, and `Analytics/Analytics.tsx` (which reports subject-scoped strengths and weaknesses). The `Subject` **model, the `/subjects` routes and `Question.subject` all stay** — `Topic` is scoped by subject, and removing the field would break the taxonomy — resolved instead to a fixed internal Mathematics value.
9. **A `Physics` subject exists in the seed data** (`scripts/data/class12Physics.ts`, seeded by `scripts/seed-class12.ts`). Owner decision (2026-08-18): **remove Physics completely**, with other subjects to be added in future, so the internal extensibility stays. Note the constraint this runs into: a **published** question cannot be hard-deleted (`deleteQuestion()` refuses anything carrying a `publishedAt`, because an attempt may reference it), so published Physics questions must be **archived**, not destroyed. Removal needs a report-only script calling `assertConfiguredForWrites()` behind an explicit `--delete` flag, run by the owner.
10. **Image import cannot store diagrams.** The bank has no image field (question images/diagrams are listed as not started in [`FEATURE_STATUS.md`](FEATURE_STATUS.md)), and the generation prompt explicitly forbids referring to a figure. Image import therefore means **OCR to text + LaTeX**; a question whose meaning depends on a diagram cannot be imported, and must be reported to the examiner as such rather than imported half-complete.
11. **Gemini must not be cloned.** `services/geminiQuestionGenerator.ts` owns the only client, behind a swappable `clientFactory` (the test seam), together with `redact()`, `isTransient()`, `describeFailure()` and the shared-deadline `attemptGenerate()`. Image extraction is a *different capability* (multimodal input, extracting rather than inventing) and so needs its own seam beside `QuestionGenerator` — but it must reuse that client and that plumbing, and `GEMINI_API_KEY` / `GEMINI_MODEL` rather than a second credential.

### Owner decisions taken (2026-08-18)

| Question | Decision |
| --- | --- |
| Class representation | Keep the string format; `'Class 3'`–`'Class 12'`; collapse the three Class-12 streams into a single `'Class 12'`. |
| Import dependencies | `exceljs` (MIT) for `.xlsx`, `mammoth` (BSD) for `.docx`. Both free and offline. Images need **no** new dependency — the already-installed `@google/genai` accepts inline image bytes. |
| Physics | Remove the subject completely. Other subjects may be added in future, so internal extensibility stays. |

### What remains in this milestone

Bulk import itself is **done**. The remaining phases are the surrounding scope changes the owner
asked for in the same brief:

- ~~**Phase G — Practice assignment.**~~ **Done (2026-08-23).** The owner decided that
  **publishing is the assignment**: no `PracticeSet` collection, because Practice is
  student-initiated and a curated set would be a second path serving questions to students — and
  every such path has to re-implement the answer-key snapshot rules. The affordance is
  `PATCH /admin/questions/bulk-status`, plus a preview read from the student picker’s own
  `getPracticeAvailability()`. See the Phase G ADR in [`DECISIONS.md`](DECISIONS.md).
- ~~**Phase H — Mock Test assignment** and **Phase I — Daily Challenge assignment.**~~ **Done
  (2026-08-23).** From the Question Bank, **Create mock test** and **Schedule daily challenge**
  hand a selection to the existing authors through a query string. **No backend change was
  needed** — both APIs already accepted explicit question ids. `pages/Admin/questionHandoff.ts`
  owns the eligibility rules and returns either a URL or the *reason* the action is unavailable, so
  a disabled button explains itself. The browser pass found a **pre-existing race** in both
  question pickers (an earlier response overwriting a newer one) — fixed, and recorded in
  [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
- **Phase J — Classes 3–12 and removing the user-facing Subject concept.** The class change is one
  file (`lib/classLevels.ts`) plus its frontend mirror, plus a migration for the three Class-12
  stream values the owner chose to collapse. The Subject removal touches eight frontend surfaces;
  the model, the routes and `Question.subject` stay.
- **Phase K — drop Subject from the AI generator** and **Phase L — full regression.**

Also outstanding, and **not** from this milestone: `tests/recommendations.test.ts` fails
`npm run typecheck` because a concurrent session added two required fields to `StudentAnalytics`.
`npm run compile` is clean (it excludes tests) and the suite passes at runtime. Whoever finishes
that change needs to add `strongAreaMinAccuracy` and `weakAreaMaxAccuracy` to the analytics
literal at line 671.

> **The 2026-08-17 audit's unverified-changes warning is resolved.** Milestone 20 ran the whole gate on 2026-08-18: `npm test --prefix backend` (**882 passing, 26 files**), `npm run typecheck`, `npm run lint`, `npm run compile`, and `tsc -b` + `npm run build` in the frontend. The audit's changes — `tests/security.audit.test.ts`, the amended `dashboard.test.ts` assertions and the `Certificate.tsx` switch — all pass. `npm audit` was **still not run** in either app, and remains open in [`SECURITY.md`](SECURITY.md).
>
> The gate, for the next session:
>
> ```
> npm test --prefix backend
> npm run typecheck --prefix backend && npm run lint --prefix backend && npm run compile --prefix backend
> cd frontend && npm run lint && npx tsc -b && npm run build
> ```
>
> **One new dependency landed**, the first since Milestone 1's foundation: `@google/genai`. It is free, it is the official Google SDK, and it was added on the owner's explicit instruction — see the Milestone 20 ADR, which supersedes the Milestone 17 decision against it. It is `require`d rather than `import`ed for a packaging reason explained at the top of `services/geminiQuestionGenerator.ts`; the **compiled** output was loaded to confirm that works, not just the source.

**Milestone 19 was the last planned development milestone.** The owner's stated next phase is full testing. Two things stand between here and that: the Razorpay credentials have never been set in this sandbox, so **no real checkout has been driven through a browser**, and the frontend still has no test suite at all. See "Immediate Next Task".

**The ₹0 cost target is now formally broken**, knowingly: Razorpay charges per transaction. That was the owner's decision and it is what the entry fee funds. Everything else in the product still runs on free tiers.

## Completed Modules (real, end-to-end)

- **Backend foundation** (Milestone 1) — modular structure, env validation, typed config, DB connection module, structured + request logging, global error handling, request validation, `helmet`, CORS allow-list, rate limiting, `/health` + `/ready`, graceful shutdown.
- **API versioning** — `/api/v1/*` canonical, `/api/*` compatibility alias.
- **Authentication (Milestone 2)** — all of the following are real and tested:
  - Registration with `fullName`, `mobile`, `email`, `password`; bcrypt (cost 12); unique `mobile`/`email`/`studentId`.
  - Email verification via a single-use, hashed, 24-hour token emailed to the student. Login is blocked until verified.
  - Login by **mobile number or email**, with account-status checks and lockout after 5 failed attempts (15 minutes).
  - Access tokens (15 min JWT, `httpOnly` cookie) + opaque refresh tokens (30 days, rotated on use, stored SHA-256-hashed) with reuse/theft detection that revokes the whole token family.
  - `/auth/refresh`, `/auth/logout` (this device), `/auth/logout-all` (everywhere, bumps `tokenVersion`).
  - Forgot password → single-use 30-minute reset token → reset, which also revokes every session. No account enumeration on either endpoint.
  - Current-user endpoint, and frontend session restoration across a browser reload (tries `/auth/me`, falls back to one refresh).
  - Per-endpoint rate limiting on every sensitive route.
- **Authorization (Milestone 3)** — permission-based and centralized:
  - Three roles (`student` / `admin` / `superadmin`) and **21 named permissions** (3 / 19 / 21), mapped in exactly one place (`backend/src/lib/permissions.ts`). The super admin's set is defined as a superset of the admin's, so an admin is *structurally* weaker.
  - Routes declare a permission via `requirePermission`; no handler compares a role to a literal. `requireAuth(...)` survives only for identity-only gates.
  - Privileged requests re-read `role`, `status` and `tokenVersion` from MongoDB, so a demotion or suspension is effective at once instead of surviving the access token's 15 minutes. Student-level requests remain stateless.
  - Frontend: `RequirePermission` route guard, a real `Unauthorized` state, and navigation filtered by the permission list the server sends (never a client-side copy of the rules).
- **Admin accounts (Milestone 3)** — the env-configured **root** account holds `superadmin` and is the bootstrap identity (8-hour token, no refresh token, no database record, by design). It can promote any verified active account to `admin`, which revokes that account's sessions so the new role is picked up on a fresh sign-in. Promoted admins sign in through the normal student login and inherit lockout, rotation, verification and password reset. `superadmin` is not assignable through any API.
- **Student & admin account management (Milestone 3)** — `/admin/users`: real paginated listing with literal (regex-escaped) search and status/role filters, suspend / deactivate / reactivate, and grant/revoke admin for a super admin only. Suspension ends live sessions immediately; reactivation clears the lockout counters. `status` is no longer settable only by a direct database edit.
- **Audit trail (Milestone 3)** — `AuditLog` collection and `/admin/audit-log` page. Records role changes, status changes, question generation, administrative sign-ins, **and refused privileged requests** with the exact missing permission. No TTL. Writes are best-effort so a failed audit write never fails the action it describes.
- **Question bank (Milestone 4)** — real end-to-end. `Subject` + `Topic` (topics and subtopics in one self-referencing collection, depth capped at 1) + a rewritten `Question` with four types (`single_choice`, `multiple_choice`, `true_false`, `numeric`), server-assigned option keys with `isCorrect` flags, marks and negative marks, a `draft → in_review → published` workflow plus reversible `archived`, tags, and a `revision` counter. Full admin CRUD with search (literal, regex-escaped, across text/tags/solutions), filters, allow-listed sorting and stable pagination. Business rules live in `src/services/`.
- **Mathematical content (Milestone 4)** — stored as plain text with LaTeX islands (`$…$`, `$$…$$`), rendered by KaTeX. Prose becomes React text nodes and only KaTeX's own output is inserted as HTML, so author text never reaches an HTML sink; the backend independently refuses link, file-inclusion and macro-definition commands, unbalanced delimiters, markup and control characters.
- **Template draft generator** — the page formerly called "AI Question Generator". Still a template-string filler and **not** AI (no AI provider is integrated anywhere), but it now requires real subject and topic ids and writes **drafts only**, so placeholder text cannot reach a student.
- **Registration data capture** — `POST /auth/register` collects and persists `firstName` / `middleName` / `lastName` (with `fullName` derived), `fatherName`, `motherName`, `dateOfBirth`, `classLevel` (ten fixed values, 5th–12th with the three 12th-class streams), `schoolName`, `address`, plus the existing mobile / email / password. A **mandatory photo** (≤2 MB, JPEG/PNG/WebP, magic-byte checked) is stored in the new `StudentPhoto` collection and served by `GET /students/:studentId/photo`, readable by the student themselves or by staff holding `students:read`. The admin table shows photo, class and school.
- **Student profile and account settings (Milestone 5)** — `/profile` is real end-to-end. A student can edit their nine descriptive registration fields (`fullName` re-derived server-side), replace their photo, and change their password. `email` and `mobile` are read-only and **absent from the update schema**, not merely filtered: they are the login identifiers and `email` anchors password reset, so changing one needs a confirm-at-the-new-address flow that does not exist yet. Self-service changes are written to the audit trail, naming the changed field names and never their values.
- **Progress: XP, levels, streaks, achievements (Milestone 5)** — real and **derived, never stored**. `StudentActivity` is an append-only log of real events; XP is a `$sum` over it, the level a pure function of the XP, the streak computed from the distinct days it contains. Once-per-day and once-per-account are enforced by a **partial unique index**, so concurrent requests cannot both earn the same event. A day is an **IST** calendar day. Eight achievements are evaluated from real facts on every read, with real progress toward the locked ones — and deliberately none that exam data would be needed to satisfy.
- **Student dashboard (Milestone 5)** — one request (`GET /me/dashboard`) supplies progress, activity, test performance, achievements, leaderboard-with-own-rank and available practice. No constant remains on the page. Loading, error and per-panel empty states throughout.
- **Real leaderboard and public figures (Milestone 5)** — `GET /leaderboard` aggregates actual XP with standard competition ranking, excludes accounts not in good standing, and leaves a zero-XP student genuinely unranked. Public by the owner's decision, so it publishes a first name plus a last initial only. `GET /public/stats` gives the landing page real counts. Both replaced hardcoded mocks.
- **Real daily challenge (Milestone 5)** — a deterministic published question for the caller's class, answer-stripped through the shared `studentQuestionView`, and now authenticated where the mock was open.
- **Practice Zone (Milestone 6)** — real end-to-end. `PracticeSession` persists the session, the questions served (each with an answer-key snapshot taken at serve time plus the question's `revision`), every answer, its correctness, per-question awarded marks, the score, the time taken and the completion status. Six endpoints under `/practice/*`, all owner-scoped by query rather than by an after-the-fact check. Grading is server-side for all four question types: unanswered is never penalised, `multiple_choice` needs the exact set, `numeric` honours the question's tolerance. Availability, the pickers and the history are all real counts — a combination with no questions behind it cannot be selected. Submitting earns `practice_completed` (25 XP) once per competition day, so it cannot be farmed.
- **Mock tests (Milestone 7)** — real end-to-end. `MockTest` holds the authored paper (title, instructions, class, ordered questions each priced for *this* test, duration, attempt limit, availability window, two disclosure settings, a `draft → published → archived` workflow); `MockTestAttempt` holds one student's sitting, with the shared answer-key snapshot per question, the server-computed `expiresAt`, the score, the per-question outcomes, the time taken and why it closed. Fourteen endpoints — seven for authoring behind the new `mocktests:write` permission, seven for sitting behind the existing `exam:take`. Timing, single-submission and disclosure are all enforced server-side (see the four properties above). The paper and the clock freeze once anyone has sat the test, so results stay comparable; everything else stays editable. Expired attempts are finalised lazily on the next read, because the free tier has no scheduler. Submitting earns `mock_test_completed` (50 XP) once per competition day.
- **Daily challenge (Milestone 8)** — real end-to-end. `DailyChallenge` pins one question per `{day, classLevel}` (scheduled by staff, or materialised automatically on first request and labelled `automatic`); `DailyChallengeAttempt` stores the single answer with the shared answer-key snapshot, marked by the shared grader. Seven endpoints — three for students behind `requireAuth()`, four for scheduling behind the new `challenges:write`. The reward is 15 XP for **answering**, once per IST day, guarded by two independent unique indexes; wrong answers are never penalised and blanks are refused. Streaks, a history, and per-day cohort figures for staff. Two new achievements, supplied to the catalogue as plain counts.
- **Gamification engine (Milestone 9)** — real end-to-end. One entry point for every grant (`grantReward()`), with eligibility rules held centrally and idempotency delegated to the partial unique index rather than a check. Three catalogues as pure functions of one `RewardFacts` object: ten achievements, five tiered badge families, a nine-stage journey map. A `/rewards` page showing all of it plus XP, level and streaks. An administrator award table (`RewardSettings`, one document) that tunes amounts within 0–500 and **cannot re-price history**. New permission `rewards:write`; new audit action `reward.settings.updated`.
- **Leaderboards and Hall of Fame (Milestone 10)** — real end-to-end, and still **derived, never stored**. `services/leaderboardService.ts` is the one place a rank is decided, with scopes (overall / per class), periods (all time / 30 / 7 / 1 IST competition days), pagination whose ranks survive a page boundary, and a stated tie-breaking rule (equal XP shares a rank; the listing order is XP → who reached it first → account id, a total order). `services/hallOfFameService.ts` adds five boards of genuine achievement — XP champions, best paper by percentage, longest streak, most correct daily challenges, most submitted practice sessions — each returned empty with a reason rather than padded. Two public routes in `leaderboard.routes.ts`; no new models and no new permissions. A signed-out visitor may page the top 100 only, which restores the anti-enumeration property pagination would otherwise have removed. New public pages `/leaderboard` and `/hall-of-fame`.
- **Account administration and a real super-admin account (Milestone 11)** — real end-to-end. The bootstrap `superadmin` is a `Student` document, auto-provisioned from `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` on first sign-in at `/auth/admin/login`, holding a rotating refresh token and a revocable `tokenVersion` like any other account. `services/rootAdminService.ts` is the only writer of the role, and `resolveRootSuperadmin()` **never upgrades an existing account** — it adopts a document only if it already holds `superadmin`, and registration refuses `ADMIN_EMAIL` outright, which together close the escalation the bootstrap is shaped around. Staff gained password reset (a one-time temporary password plus `mustChangePassword`), forced sign-out, a fourth `blocked` status and super-admin-only delete; `refuseIfProtected()` blocks every one of those against the super admin itself. Staff account IDs use a separate `ADMIN_xxxx` namespace so no staff account consumes one of the ten thousand `AMIT_xxxx` competitor numbers.
- **Admin platform (Milestone 12)** — real end-to-end, twelve of fourteen requested areas (eight already existed and were deliberately not rebuilt). New: `GalleryItem` behind a public `/gallery` and admin CRUD; `Notification` + `NotificationRead` behind a student inbox and an admin composer; `services/platformAnalyticsService.ts`, the one place platform-wide figures are assembled, with **no estimates** — `0` where nothing happened and `null` where an average or a count genuinely cannot be produced; an unmasked admin leaderboard; and a badges/achievements overview with holder counts. Two new permissions, `gallery:write` and `notifications:write`.
- **The official exam, results and certificates (Milestone 13)** — real end-to-end. `Exam` holds the announced paper with a **mandatory** window; a rewritten `ExamAttempt` holds one sitting with the shared answer-key snapshot and a server-owned `expiresAt`; a rewritten `Result` holds the released announcement with rank, total candidates and percentile; `Certificate` holds a fully snapshotted, revocable credential with a readable serial and a separate random verification code. `services/examService.ts` owns the sitting and the ranking, `services/certificateService.ts` is the only issuance path and renders the PDF with `pdf-lib`. Three new route modules (`exams`, `examsAdmin`, `certificates`), two new permissions (`exam:write`, `certificates:write`), and a **public, unauthenticated** `GET /verify/:code`. Student pages `/exam`, `/exam/:attemptId`, `/my-certificates`; staff pages `/admin/exams`, `/admin/certificates`; public `/verify` and `/verify/:code`.
- **Performance analytics (Milestone 15)** — real end-to-end, and **derived on read with no collection behind it**. `services/analyticsService.ts` is THE student derivation: one faceted aggregation per attempt collection grouping on a composite `{topic, subject, difficulty, type}` key, plus four projected attempt reads for the trends — eight parallel operations, all indexed by `student`. `services/questionAnalyticsService.ts` is THE administrative half: per-question performance merged across all four surfaces, and per-paper cohort statistics with a median beside the mean. `StudentAnalytics` was **deleted**; three indexes were added, including the first `student` index `ExamAttempt` has ever had. No new models, no new permissions.
- **The notification system (Milestone 14)** — real end-to-end. `EmailOutbox` is THE queue: `enqueueEmail()` persists first and returns, `drainOutbox()` claims a due row by conditional write, retries with growing backoff and gives up terminally after `maxAttempts`. `lib/systemNotifications.ts` is the catalogue of the six automated events (pure data, no database, the same discipline as the achievement catalogue); `services/systemNotifier.ts` is the one layer that turns a domain event into a notification, so neither `notificationService` nor `examService` has to learn the other's job. `postSystemNotification()` is the only creation path for an automated notice and decides email eligibility centrally; `emailAllowedFor()` is the only place a preference is interpreted. Five new routes (two for a student's preferences, three for the delivery console), one new model, no new permissions.
- **Performance recommendations (Milestone 16)** — real end-to-end, and **derived on read with no collection behind it**. `services/recommendationService.ts` is THE path: it assembles `RecommendationFacts` (the Milestone 15 analytics, the published bank for the student's class, a published mock-test count), resolves the engine named by `RECOMMENDATION_ENGINE`, runs it, and stamps the provenance itself. `lib/recommendationTypes.ts` is the seam an ML/LLM engine implements; `lib/statisticalRecommender.ts` is the default, a pure function of the facts with no database access, asserting findings on a **95% Wilson interval** over the shared `MIN_AREA_SAMPLE` floor. One new route (`GET /analytics/:studentId/recommendations`), one new frontend component, one new env var with a working default. No new model, no new permission, no new dependency, and **no AI provider integrated anywhere**.
- **AI question drafting (Milestone 17, reworked in 18, rebuilt on the SDK in 20)** — real end-to-end. `lib/questionGeneratorTypes.ts` is the seam; `services/geminiQuestionGenerator.ts` calls Google Gemini through the official **`@google/genai`** SDK with a `responseSchema` built per question type; `services/questionGeneratorService.ts` is THE path and the trust boundary — it attaches the taxonomy, screens every candidate through `createQuestionSchema` and near-duplicate detection, reports rejects, and **writes nothing until an examiner approves**. There is **no template fallback** (deleted in Milestone 18): an unconfigured key is a 503 naming the variable. Five routes (`GET /admin/question-generator`, `GET .../models`, `POST /admin/generate-questions`, `.../validate`, `.../approve`, `.../reject`), seven optional env vars, one rate limiter of its own, and a `provenance` block on every question it saves. **The only AI integration in the product**, and it sends no student data.
- **Backend test suite** — **795 passing tests** across 24 files, against a real in-memory MongoDB wherever a database is needed: 20 question-generator tests (Milestone 17 — mostly feeding the pipeline output a real model could plausibly produce and asserting it is refused), 36 recommendation tests (Milestone 16 — weighted toward asserting a finding is *not* produced), 32 performance-analytics tests (Milestone 15 — every one seeded with declared outcomes so it asserts an exact figure), 46 notification-system tests (Milestone 14 — weighted toward making delivery fail on purpose), 50 official-exam and certificate tests (Milestone 13), 43 admin-platform tests (Milestone 12 — gallery, notifications, analytics, standings, plus authorization asserted on **both** URL prefixes), 27 account-administration tests (Milestone 11), 49 leaderboard/Hall-of-Fame tests (Milestone 10), 31 gamification tests (Milestone 9), 37 daily-challenge tests (Milestone 8), 54 mock-test tests (Milestone 7), 42 Practice Zone tests (Milestone 6), 71 dashboard/progress/analytics/results and 27 profile tests (Milestone 5 and its follow-ups), 77 question-bank tests (Milestone 4), 62 RBAC / privilege-escalation tests (Milestone 3), 40 registration-detail tests, and 32 auth integration tests (Milestone 2). Test files run **sequentially** — see [`TESTING.md`](TESTING.md).

## Partially Completed Modules

- **No placeholder data remains anywhere (2026-08-11).** A page-by-page audit removed the last five pieces of invented data and one regression. The **result portal** no longer hashes a typed ID into a score, rank and percentile; the **certificate page** no longer prints an award for anyone signed in; the **exam** serves real published questions instead of five hardcoded ones (which also shipped their own answer key in the bundle); the **admin chart** shows real registrations and active students instead of a sample accuracy trend; the **student report** was fixed after the analytics change left it spinning forever. Each was written as a live query against the real collection precisely so it would start working by itself when exam submission landed — **and in Milestone 13 it did**. The result portal, the dashboard's exam panel and the certificate page are now fed by real data rather than waiting for it. See [`CHANGELOG.md`](CHANGELOG.md).
- **One student navigation shell (2026-08-11).** `components/StudentShell.tsx` holds the sidebar, topbar, theme toggle and sign-out for the whole signed-in student area, so they persist across all seven of its destinations with the current route highlighted. This fixed a reported bug — the sidebar was built inside `Dashboard.tsx` alone, so pressing any item in the menu navigated to a page using the public navbar layout and the menu disappeared. It falls back to the public `Navbar` + `Footer` for a guest, because `/certificate` and `/result` are public routes. Mirrors the existing `AdminShell`.
- **One theme, light by default (2026-08-11).** `ThemeContext` applies a single `theme-dark` class to `document.documentElement`, persisted in `localStorage`, with a `ThemeToggle` in the public navbar, the dashboard sidebar and the admin sidebar. The app used to be light on public pages and hardcoded dark on the dashboard, admin area and exam, so signing in changed the colour scheme underneath the user. Those three per-page classes are gone.
- **Performance recommendations** — fully real as of Milestone 16, and listed here only to say what they are *not*: they are not personalised prose, not a model, and not adaptive over time (known bug #50). They are five kinds of arithmetic finding, each carrying the counts it came from, each refusing to speak below a sample floor.
- **Student analytics** — **fully real as of Milestone 15**, and no longer in this section for the reason it used to be. The hardcoded fallback (88% accuracy, 450 questions, "top 5% of all national Olympiad participants") went in the Milestone 5 follow-up, leaving the page honestly empty; Milestone 15 filled it from the four attempt collections and deleted the never-written `StudentAnalytics` model behind it. Accuracy, topic/subject/difficulty breakdowns, trends and weak/strong areas are all derived on read. Authorization was already real and tested, and remains so.
- **Admin dashboard** — fully real. The account figures and recent-registration list were already real counts; the sample weekly-accuracy chart was replaced on 2026-08-11 with two genuine 14-day series from `GET /admin/stats` (registrations per day, active students per day).
- **AI insights** — real rule-based logic (not ML), reachable only on the currently-unpopulated real-data path. The page no longer presents anything as an AI insight when it has none, and is titled "Performance Analysis" rather than "AI Performance Analysis", since no AI is involved anywhere in it.

## Pending / Not Started Modules

The exam, results, certificates, the gallery and notifications all **left this list** in Milestones 12 and 13 and are recorded under "Completed Modules" above. What genuinely remains:

- **Payments** — static QR image; no gateway, no verification, no transaction record. Registration still proceeds on a self-reported "I've paid" click. **Deliberately reserved for the final milestone by the owner** (2026-08-13): it was floated as a Milestone 13 candidate and skipped, and it is the one area that needs a provider decision and cost approval before any code.
- **Subscriptions** — not applicable yet; registration is one-time.
- **CSRF tokens** — the top open security gap, and wider than it was: there are now authenticated state-mutating routes across the student surface (exam answers, certificate downloads, profile edits) and the administrative one (releasing results, revoking a certificate). Production cookies are `sameSite: 'none'` because the apps are on different domains, so `SameSite` is not doing this job. See [`SECURITY.md`](SECURITY.md).
- **Two-factor auth** — not started.
- **No frontend test suite at all** — 45 routes, the route guards, the exam runner and the certificate surfaces are verified only by driving a real browser. Adding a framework needs a [`DECISIONS.md`](DECISIONS.md) entry first.
- **Question images / diagrams** — a question is text plus LaTeX only, so a geometry diagram cannot be attached. Registration photos and the gallery both proved the storage pattern; nothing reuses it here yet.
- **Mobile/SMS verification** — deliberately dropped. The fake client-side OTP step was **deleted**; email verification replaces it. No SMS provider is integrated (it would also breach the ₹0 constraint).
- **Changing your own email address or mobile number** — not possible. Everything else on a student's record is now editable by its owner; these two are excluded on purpose, because changing a login identifier safely needs a confirm-at-the-new-address flow (see [`DECISIONS.md`](DECISIONS.md)). The profile page says so rather than offering a field that would fail.
- **A *past competition's* hall of fame** — the five live boards are real, but there is no archived board for a completed Olympiad. Milestone 13 made this possible for the first time (published results now exist); it is not built.
- **Account deletion for a verified account** — a super admin can delete an account that has *not* verified its email. Hard-deleting a real entrant stays deliberately unbuilt; deactivation is the reversible equivalent.

## Current Frontend State

React 19 SPA, **47 routes** (Milestone 16 added none — it puts a **"What to work on next"** panel at the top of `/analytics`, fed by its own request so a slow engine costs one panel rather than the page, and teaches `/practice` to accept `?subject=&topic=&difficulty=` so a recommendation can hand the student straight to what it suggested. Those parameters are **validated against the loaded options** before anything is selected, so a stale bookmark degrades to the ordinary picker and the link cannot widen what a student may practise. `components/Recommendations.tsx` computes nothing, prints the engine's own `basis` sentence verbatim so nobody has to guess whether they are reading arithmetic or a model, and puts the counts behind a "Show the numbers" toggle on every card; Milestone 15 added `/admin/performance`, the question- and paper-performance console, and rewrote `/analytics` and `/report` for the derived shape; Milestone 14 added `/admin/email-deliveries`, the delivery console, and put an unread badge on the student shell's Notifications item plus a preferences panel on `/profile`; Milestone 13 added `/exam` — no longer a redirect — plus `/exam/:attemptId`, `/my-certificates`, `/admin/exams`, `/admin/certificates` and the **public** `/verify` and `/verify/:code`; Milestone 12 added the public `/gallery`, the student `/notifications`, and `/admin/gallery`, `/admin/notifications`, `/admin/analytics` and `/admin/standings`; Milestone 10 added the two **public** routes `/leaderboard` and `/hall-of-fame`; Milestone 9 added `/rewards` and `/admin/reward-settings`; Milestone 8 added `/daily-challenge` and `/admin/daily-challenges`; Milestone 7 added `/mock-tests`, `/mock-tests/attempts/:attemptId` and four `/admin/mock-tests*` routes; Milestone 6 added `/practice` and `/practice/:sessionId` and turned `/exam` into a redirect; Milestone 5 added `/profile`; Milestone 3 added `/admin/users` and `/admin/audit-log`). Two shells hold the navigation: `components/StudentShell.tsx` for the signed-in student area and `pages/Admin/AdminShell.tsx` for the administrative one, each the single place its own menu is defined. A global `ThemeContext` applies light/dark at the document root, defaulting to light. The **Dashboard** is a real data view — one `GET /me/dashboard` call supplies every figure, with loading, error and per-panel empty states, and no hardcoded constant left on the page. The new **Profile** page reads `GET /me/profile` and offers editing, photo replacement and password change; a successful photo upload appends a changing `?v=` so the browser does not keep showing the cached previous image for five minutes. The **Landing** page's headline figures and champions list are fed by `GET /public/stats` and `GET /leaderboard`, and both degrade to an honest empty state rather than blocking the registration form if the API is unreachable. A small shared `src/lib/photo.ts` holds the client-side photo limits. The registration wizard on the landing page collects 13 fields grouped into *Student details* / *Photo* / *Contact & sign-in*, marks every required one with a red `*`, previews the chosen photo, and refuses an oversized or wrong-type file — and each missing field by name — before submitting. The new **Rewards** page is the gamification surface: XP and level with progress to the next, the real counts underneath (active days, practice sessions, mock tests, challenges), the journey map as a vertical path with one stage marked *next*, a badge grid showing the tier each family is held at, and the full achievement list. Nothing on it computes anything — every figure arrives already decided by the engine, which is why it and the dashboard cannot disagree. Staff get `/admin/reward-settings`, a table of what each event is worth, with a panel stating plainly that a change cannot alter anybody's existing XP. The new **Leaderboard** page (public) offers an overall or per-class board over four periods, with pagination, medals that follow the server's `rank` rather than the row's position (so two students sharing rank 1 both get gold), the caller's own standing repeated in a card above, and their row highlighted **in place** rather than pinned to the top — a leaderboard that moved you out of your real position would be lying about the one thing it exists to say. Like the rewards page it computes nothing: it sends a scope, a period and a page and renders the rows in the order they arrive, because a page that re-sorted its own copy would be a second ranking implementation waiting to disagree with the first. The new **Hall of Fame** page (also public) shows the platform's real totals and five honours boards, rendering the server's `emptyReason` for any board nobody has qualified for yet. The **Daily Challenge** page shows today's question, takes one answer, and turns into the marked result with the explanation — plus a streak strip and a history; the dashboard card, which used to say answering "arrives with scored exams", now shows the question and hands the student to that page, or reports what they answered. The staff page at `/admin/daily-challenges` schedules a day from the published bank, using a day strip the **server** supplies (a competition day is an IST day, and a browser elsewhere would disagree about which day is today). The **Mock Tests** pages: a list of the tests set for the student's class with the window, attempts left and their own past attempts; a runner that counts down from the server's `secondsRemaining`, re-syncs on every answer save, and submits when it reaches zero; and a review that renders whichever of the three disclosure shapes the server returned, narrowed by discriminated union so the review-only fields are unreachable rather than merely unrendered while the paper is open. The countdown derives its deadline as *now + secondsRemaining* rather than from the absolute `expiresAt`, so a wrong system clock still shows the right remaining time. Administrative pages cover the list, the editor (with a question picker filtered to the test's class and per-question marks) and the results table. All API access flows through `frontend/src/api/client.ts`, which prefixes `API_BASE = '/api/v1'` and transparently refreshes an expired access token once before retrying, de-duplicating concurrent refreshes through a single shared promise. `AuthContext` exposes register / login / logout / logout-everywhere / verify / resend / forgot / reset, plus `role`, `permissions` and `can(permission)` — all supplied by the backend, so the UI keeps no copy of the authorization rules. `status` records only *which kind of account* is signed in (a student record, or the root admin); it must never be used to decide whether something administrative is allowed. Route guards are `ProtectedRoute` (student account) and `RequirePermission` (capability), the latter rendering an `Unauthorized` state for a signed-in user rather than silently redirecting. Administrative pages share an `AdminShell` whose sidebar is filtered by permission. Verified: `oxlint` passes (three fast-refresh warnings, all of the "a context file exports a hook as well as a component" kind), `tsc -b && vite build` succeeds, and every flow was driven through a real browser with no console errors.

## Current Backend State

Modular Express 5 app under `backend/src/`:

```
app.ts                    Express app assembly
server.ts                 local bootstrap + graceful shutdown
config/env.ts             dotenv + zod validation (now incl. token/email settings)
config/index.ts           typed config; separate access/refresh cookie options
db/connection.ts          cached connect/disconnect + state helpers
lib/logger.ts             pino
lib/ApiError.ts           typed operational errors
lib/apiResponse.ts        { success, ... } envelope helpers
lib/password.ts           bcrypt hash/verify (cost 12; 4 under test for speed)
lib/tokens.ts             access JWTs, refresh-token rotation, single-use tokens
lib/email.ts              nodemailer SMTP + log/in-memory transports + templates
lib/permissions.ts        THE role -> permission table (Milestone 3)
lib/classLevels.ts        the ten offered classes (5th-12th + 12th streams)
lib/mathContent.ts        LaTeX grammar + dangerous-command rejection
lib/slug.ts               name -> stable handle
lib/serviceError.ts       maps a thrown ApiError to the response envelope
lib/session.ts            session cookies + access-token claims (Milestone 5)
lib/xp.ts                 XP award table + level function (Milestone 5)
lib/achievements.ts       achievement catalogue, evaluated from real facts (M5)
lib/competitionDay.ts     the IST day boundary streaks are measured in (M5)
services/                 question + taxonomy rules (M4);
                          activity, progress + challenge derivation (M5);
                          result (published results, certificates, admin stats);
                          practice (availability, session views — M6);
                          mockTest (authoring rules, availability, the stored
                          deadline, single-submission grading, disclosure,
                          results + ranking — M7);
                          dailyChallenge (pinning a day, scheduling rules,
                          one-answer grading, streaks, cohort figures — M8);
                          reward (THE gamification engine: granting, pricing,
                          the facts object, the three summaries, config — M9);
                          leaderboard (THE ranking: scopes, periods, ties,
                          pagination, a standing — M10);
                          hallOfFame (the five honours boards — M10);
                          grading (THE marking rules, shared by practice,
                          mock tests and the daily challenge);
                          questionView (the shared answer-stripped projection)
lib/audit.ts              audit-trail recorder (Milestone 3)
middleware/               auth (authenticate/requireAuth/requirePermission),
                          validate, errorHandler, rateLimiter,
                          requestLogger, ensureDb
models/                   23 models (22 files; Notification.ts registers two —
                          Notification and NotificationRead)
                          + attemptAnswer.ts (a shared subdocument, not a model)
routes/health.routes.ts   /health, /ready
routes/v1/                auth (12 routes), me (6 own-account routes, M5),
                          analytics, questions (student reads),
                          questionsAdmin (6 CRUD routes), taxonomy (6 routes),
                          practice (6 routes, M6),
                          mockTests (7 student routes, M7),
                          mockTestsAdmin (7 authoring routes, M7),
                          dailyChallenge (3 student routes, M8),
                          dailyChallengesAdmin (4 scheduling routes, M8),
                          rewards (1 student + 2 config routes, M9),
                          leaderboard (leaderboard + hall of fame, both
                          public, M10),
                          gallery, notifications, adminInsights (M12),
                          exams (student sitting, M13),
                          examsAdmin (authoring + result release, M13),
                          certificates (student library, admin management,
                          public verification, M13),
                          admin, users (5 admin/audit routes),
                          misc (public stats, results, certificates,
                          admin stats)
                          — 23 route modules in total
validation/               zod schemas for auth + questions + taxonomy + users
                          + profile/settings (M5) + practice (M6)
                          + mock tests (M7) + daily challenge (M8)
                          + rewards (M9) + leaderboards (M10)
                          + content: gallery/notifications (M12)
                          + exams/certificates (M13)
scripts/                  dev-local, verify-email, migrate-questions,
                          backfill-activity (Milestone 5)
tests/                    24 suites, 796 tests (21 of them Milestone 18's)
```

Milestone 16 added two `lib/` modules and one service, and no new folder:
- `lib/recommendationTypes.ts` — **THE seam.** The whole contract an alternative
  engine implements: the facts it may read, the shape it returns, and the three
  rules the design enforces. Start here to add an ML or LLM engine.
- `lib/statisticalRecommender.ts` — the default engine. Pure, no database, no
  clock of its own, and deliberately **not** called AI.
- `services/recommendationService.ts` — **THE** path to a recommendation:
  assembles the facts (the only place that queries), resolves the configured
  engine, and stamps `engine` / `generatedAt` / `hasData` itself so an engine
  cannot misdescribe its own output.

Milestone 14 added three modules and no new folder:
- `lib/systemNotifications.ts` — the catalogue of automated events: their copy,
  their email category, and whether a student may switch them off. Pure data and
  pure functions, like the achievement/badge/journey catalogues.
- `services/emailOutbox.ts` — **THE** email queue. Nothing else may call
  `deliverEmail()`.
- `services/systemNotifier.ts` — the one layer that turns a domain event into a
  notification, keeping exam/account code free of notification copy and
  `notificationService` free of exam concepts.

**`ExamAttempt` and `Result` are written by routes as of Milestone 13**, and both were rewritten to do it. The dashboard's test-performance panel and the public result portal — which were deliberately written as live queries against empty collections rather than as hardcoded empties — started working when submission landed. **No static mock is left anywhere in the backend**: `GET /certificates/:studentId`, `GET /leaderboard` and `GET /daily-challenge` were all made real, and the analytics fallback that invented a student's accuracy was deleted. `GET /questions` is real, authenticated and answer-stripped, and **is** now called by a student page — the Practice Zone builds every session from it.

## Current Database State

MongoDB via Mongoose, **24 models** (Milestone 18 added `GenerationLog`, which records what a model was asked and what came back — counts and parameters only, never question text, and no TTL because it is the evidence for how a machine-written question came to exist): `Student` (with `role`, the nine registration fields and Milestone 14's embedded `notificationPrefs`), `StudentPhoto`, `ExamAttempt`, `Result`, `StudentAnalytics`, `RefreshToken`, `VerificationToken`, `AuditLog`, Milestone 4's **`Subject`**, **`Topic`** and a rewritten **`Question`**, Milestone 5's **`StudentActivity`**, Milestone 6's **`PracticeSession`**, Milestone 7's **`MockTest`** and **`MockTestAttempt`**, Milestone 8's **`DailyChallenge`** and **`DailyChallengeAttempt`**, Milestone 9's **`RewardSettings`** (one document, pinned by a unique index on a constant key), Milestone 12's **`GalleryItem`**, **`Notification`** and **`NotificationRead`**, Milestone 13's **`Exam`** and **`Certificate`** (with `ExamAttempt` and `Result` rewritten from their pre-Milestone-4 shapes), and Milestone 14's **`EmailOutbox`**. Only 23 *files* hold them, because `Notification.ts` registers both `Notification` and `NotificationRead`.

**Milestone 14's schema changes**, all additive: `EmailOutbox` is new, with `{status, nextAttemptAt}` for the drain query, a **partial unique** index on `dedupeKey` (partial so the many keyless rows do not all collide on `null` — a resent verification link is legitimate) and deliberately **no TTL**, because a delivery record is the evidence for "we did tell them". `Notification` gained `student`, `source`, `event`, `link` and its own partial-unique `dedupeKey`, which is what makes re-releasing an exam's results unable to re-announce them. `Student` gained an embedded `notificationPrefs` — two booleans, 1:1 with the account, deliberately not a 25th model. `models/attemptAnswer.ts` is a *shared subdocument* embedded by the practice, mock-test, daily-challenge and exam attempt collections, not a model of its own.

Milestone 13's own indexes are the load-bearing kind: **unique** on `ExamAttempt {exam, student}` (one attempt ever, enforced rather than counted), **unique** on `Result {exam, student}` (which is what makes republishing idempotent instead of duplicating), and **unique** on `Certificate {student, exam}`, `Certificate.certificateId` and `Certificate.verificationCode`. The two token collections store only SHA-256 hashes and carry TTL indexes; `AuditLog` and `StudentActivity` deliberately have **no** TTL — expiring a row would take XP away from a student who earned it. Unique indexes on `Student.mobile`, `Student.email`, `Student.studentId` and `StudentPhoto.student`; a non-unique index on `Student.role`; a **partial unique** index on `StudentActivity` `{student, type, dedupeKey}` (partial on `dedupeKey` existing), which is what makes "once per day" and "once per account" true rather than merely intended; a **unique** index on `MockTestAttempt` `{test, student, attemptNumber}`, which is what makes "one attempt per sitting" true in the database rather than intended by the handler that counts them; and unique indexes on `DailyChallenge` `{day, classLevel}` and `DailyChallengeAttempt` `{student, day}`, which make "one challenge a day per class" and "one reward a day per student" true the same way.

**No progress or leaderboard collection exists, on purpose.** XP, levels, streaks, achievements and the standing are all derived from `StudentActivity` on read — see the ADR in [`DECISIONS.md`](DECISIONS.md). **Milestone 10 held that line** while adding class boards, period boards and the Hall of Fame: twenty scope-and-period combinations each look like a candidate for a cached document, but a stored standing is a number that can disagree with the events behind it. The one schema change was an index, `StudentActivity {occurredOn: -1}`, which the period boards narrow on before grouping (the existing `{student, occurredOn}` index cannot serve a query with no student in it).

**`.env` is resolved from the backend package root, not the working directory.** Until 2026-08-11 `dotenv.config()` searched `process.cwd()`, so running a script from `backend/scripts/` loaded **zero** variables and `MONGO_URI` silently fell back to `mongodb://localhost:27017/...`. A seed run that way reported success while writing to a local database, leaving production empty. Both halves are fixed: the path is now anchored to the package root, and every write script calls `assertConfiguredForWrites()` (`src/lib/envGuard.ts`), which prints the target database and exits 2 rather than writing to a local one without an explicit `--local`.

**The Class 12 question bank is seeded by script, not by hand.** `backend/scripts/seed-class12.ts` publishes 208 validated questions (104 Mathematics, 104 Physics) for `Class 12 - Science` across 26 topics. It is report-only by default, idempotent, and validates every question through the API's own zod schema before writing. **Run against the real database (owner, 2026-08-12)** — the 208 questions are live, and both the Practice Zone and Milestone 7's mock tests draw on them. No other class has anything published yet.

**Accounts created before Milestone 5 read as 0 XP with an empty feed**, because the activity log is written going forward. `backend/scripts/backfill-activity.ts` writes the enrolment rows they already earned; it is report-only by default and deliberately fabricates no streaks. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

**Photo storage is bounded by the database.** At 2 MB a photo, the Atlas free tier's 512 MB holds roughly **250 students** — enough for a first cohort, and the first thing that will force a paid tier or an image CDN.

**The event gallery is the second.** Milestone 12 stores gallery images in MongoDB too, capped at **1 MB** each. Unlike registration photos, which are bounded by the number of entrants, gallery images are bounded by nothing but how many staff upload — a hundred of them is ~100 MB, a fifth of the whole free tier spent on decoration. Worth watching before it bites.

**Atlas connectivity is still unverified from this development sandbox** (outbound raw DNS/TCP is blocked). Milestone 2 was instead verified against a real MongoDB run locally on port 27017, which exercised the same code paths, indexes and constraints. The owner must still confirm Atlas works from their machine — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

## Current Authentication State

Complete for students; deliberately simpler for the root administrator. Implemented: bcrypt password hashing, email verification, login by mobile or email, access/refresh token split with rotation and theft detection, revocation (per-device and everywhere), password reset that revokes all sessions, account status (`active`/`suspended`/`deactivated`), failed-login lockout, per-endpoint rate limiting, and no account enumeration on login, forgot-password or resend-verification.

Milestone 3 added the authorization half: three roles, one permission table, `requirePermission` gates, database-fresh role checks on privileged requests, and immediate session revocation on role change or suspension. Admin accounts are now real database accounts and reuse everything above.

Milestones 12 and 13 added no new authentication mechanism. What they built is summarised under "Current Development Phase" above; this section covers only identity and access.

**Milestone 11 gave the super administrator a real account.** It is auto-provisioned from `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` on first sign-in and holds a rotating refresh token, a revocable `tokenVersion`, a `studentId` and a row in `/admin/users` like any other account — the environment variables are now the bootstrap *seed*, not the ongoing source of truth. The `root: true` claim, `ADMIN_TOKEN_TTL` and the role-check exemption in `resolveCurrentRole()` are gone, so **every** privileged request re-reads the role from the database. It earns no XP (so it cannot reach a public leaderboard) and is excluded from student counts. It is still not assignable through any API, and `refuseIfProtected()` blocks suspending, demoting, password-resetting or deleting it. See the Milestone 11 ADR in [`DECISIONS.md`](DECISIONS.md) for the five things the document-less design could not do.

**Milestone 11 also widened what staff can do**: it took the table to 17 permissions (3 student / 15 admin / 17 super admin), and Milestones 12 and 13 have since taken it to **21 (3 / 19 / 21)** — `gallery:write` and `notifications:write`, then `exam:write` and `certificates:write`. `SUPERADMIN_PERMISSIONS` is defined as a superset of the admin list so an admin is *structurally* weaker. Admins gained `users:password:reset` and `users:sessions:revoke`; `users:delete` joins `users:role:write` as super-admin-only. The line is reversibility — everything an admin may do can be undone. A fourth account status, `blocked`, sits alongside `suspended` and `deactivated`.

**The `/admin` portal accepts both administrative identities (fixed 2026-08-13).** The two sign in against different endpoints — the root super admin at `/auth/admin/login`, a promoted admin at the ordinary `/auth/login` — but the portal posted only to the first. A promoted admin entering their correct password was answered "Invalid admin credentials", which reads as a broken account rather than as the wrong door, and the only signpost was a line of hint text pointing at the home page. `adminLogin()` in `AuthContext` now tries the root endpoint and falls back to the ordinary login on a 401, so one form serves both. The backend was not changed: there is still exactly one authentication path per identity, and `/auth/admin/login` still accepts nothing but the environment credentials. Four tests in `rbac.test.ts` pin the contract the fallback reads — in particular that the refusal is a **401**, since a 403 would silently strand every promoted admin.

Milestone 5 added a **self-service password change** (`POST /me/change-password`). It requires the current password even though the caller already holds a session — otherwise a borrowed session could lock the real owner out. It revokes every other session and re-issues one for the calling device, so the student is not signed out of the page they are standing on, and a wrong guess deliberately does **not** touch the lockout counter. The session-cookie helpers moved to `lib/session.ts` so this route and the auth routes share one definition.

Still missing: CSRF tokens (see [`SECURITY.md`](SECURITY.md)) — now with student-facing state-mutating routes to protect as well as administrative ones — two-factor auth, and any way for a student to change their own email address or mobile number (excluded on purpose; see [`DECISIONS.md`](DECISIONS.md)).

## Current Payment State

**Real, end-to-end, and the gate is on by default** (Milestone 19, 2026-08-16). Razorpay Standard Checkout, verified server-side. The static QR image and its "I've Paid" button are deleted.

- **The fee is ₹100** (`DEFAULT_ENTRY_FEE_PAISE = 10_000`), and it is **administrator-editable** at `/admin/payments`, not an environment variable — it is business configuration, so changing it must not be a redeploy and must leave an audit entry naming who changed it and from what. Only the two Razorpay credentials and the webhook secret are env vars.
- **What the fee buys: the official Olympiad, and nothing else** (owner decision, 2026-08-17). Practice, mock tests, the daily challenge, analytics, the dashboard, the leaderboard and rewards are **free** — a student prepares for free and pays only to compete. It briefly gated all four surfaces on 2026-08-16 and the owner reversed that the next day; the narrower scope is the product. **Paying later is the normal path**, so the fee appears on `/payment`, as a dashboard banner and as a card on `/profile`.
- **The entitlement is derived, never stored.** "Has a captured `Payment` with purpose `olympiad_entry`" — there is deliberately no `hasPaid` flag on `Student`, for the reason XP, analytics and the leaderboard are all derived: a stored boolean is a second source of truth about money, and when it drifts somebody who paid is refused or somebody who did not is admitted.
- **One gate: `middleware/requireEntry.ts`**, mounted on the exam attempt route alone. Routes never call `hasEntryEntitlement()` themselves, for the reason there is one grader and one reward engine — a surface that has to remember to ask will eventually forget, and a forgotten paywall looks exactly like a working one. It answers **402**, not 403: "not yet, and here is the button" is a different message from "never", and the frontend branches on it to show a pay page rather than a dead end.
- **The gate runs before the resource is looked up.** The exam's check originally sat inside `startExamAttempt()`, *after* its 404 — so an unpaid caller could tell a real exam id from an invented one by the status code. Mounting the middleware on the route fixed that; the service check remains as defence in depth. There is a regression test.
- **The browser is never believed about money.** It cannot say a payment succeeded, how much was paid, or what was bought. `POST /payments/orders` takes **no body at all**: the amount comes from the settings document and the student from the session token. Both paths that mark a payment captured verify an HMAC signature computed from a secret only the server holds, compared in constant time.
- **Capture is idempotent, by conditional write.** It matches only a not-yet-captured row and reports whether it won, because the return journey and the webhook routinely arrive in the same second and on serverless land in different invocations. A duplicate webhook changes nothing; a late `payment.failed` cannot revoke a capture; a webhook for an order this server never created is acknowledged and dropped rather than creating a payment belonging to nobody.
- **Reconciliation stands in for the webhook.** The owner chose not to configure a webhook secret, which leaves the browser's return journey as the only confirmation — and a browser can be closed, refreshed or killed by a dropped mobile connection in the second between the money moving and the verify call landing, leaving Razorpay holding a captured payment this database knows nothing about. `POST /payments/reconcile` asks Razorpay directly and captures on the same idempotent path; it runs on page load and whenever the modal closes without success. Only `captured` counts — `authorized` means the money is held but not taken. The webhook route still exists and works if a secret is ever set.
- **`entryFeeEnabled` defaults to `true`**, reversing the `false` the feature shipped with earlier the same day. That original default was right while the fee bought only the exam and nobody had paid; it stopped being right when the fee became the entry condition for the platform, because a paywall nobody remembered to switch on is not a paywall. The switch itself is kept and matters more now: it is the answer to a provider outage during an exam window, and to running a cohort free. It stays explicit rather than inferred from the credentials being absent — "we chose to run this free" and "the keys are missing" must never look the same.
- **Changing the price never re-prices a captured payment.** `Payment.amount` is a snapshot, the same rule `StudentActivity.xpAwarded` follows.
- **No SDK**: `fetch` and `node:crypto`, following the Milestone 17 precedent. The raw request body is preserved in `app.ts` because Razorpay signs the exact bytes it sent.

**Still outstanding, and needing the owner:** the Razorpay credentials are **not set in `backend/.env`**, so no real checkout has been driven through a browser — the whole path is covered by 31 tests against a fake transport only. See "Immediate Next Task".

**CSRF is still absent.** `SECURITY.md` said a token should land before payments; it did not, and that is now a knowing gap rather than a plan. The practical exposure stays narrow — the API parses JSON only and CORS uses a strict allow-list, so a cross-site form cannot reach these routes — but it should be recorded as accepted rather than forgotten.

## Current Deployment State

Two independent Vercel projects, unchanged in structure. `backend/api/index.ts` imports the app from `src/app.ts`; the per-request `ensureDb` middleware is what makes the serverless path connect at all.

**Deployment ordering matters**: deploy the backend before the frontend, since the frontend calls `/api/v1/*`. Milestone 2 adds a second requirement: **set the SMTP and `FRONTEND_URL` env vars before students register in production**, or verification emails will not be delivered (they will only be written to the server log) and their links will point at the wrong host.

Milestone 9 adds **no new environment variables and no new deploy step**. Two things are worth knowing:
- **No settings document is created until somebody saves one.** Until then every event pays its code default, which is exactly what shipped — there is nothing to seed and nothing to migrate.
- **A promoted admin gains `rewards:write` automatically**, like the previous two permissions, because it was added to the `admin` row of the table.

Milestone 8 adds **no new environment variables and no new deploy step**. Two things are worth knowing:
- **The first student of each class to open the challenge pins that day's question.** Nothing needs to be scheduled beforehand, and no backfill is required for past days — they simply have no challenge, which is true.
- **A promoted admin gains `challenges:write` automatically**, the same way they gained `mocktests:write`, because it was added to the `admin` row of the permission table.

Milestone 7 adds **no new environment variables and no new deploy step**. Sessions survive it (no cookie names changed). Two things are worth knowing before deploying it:
- **Nothing is visible to students until a test is published.** The mock-test pages appear in the student navigation immediately, and show an honest empty state until staff publish a paper for that class.
- **A promoted admin gains `mocktests:write` automatically**, because it was added to the `admin` row of the permission table. Their existing session picks it up on its next privileged request, since the role is re-read from the database rather than trusted from the token.

Milestone 5 adds **no new environment variables**, and student sessions survive the deploy (no cookie names changed). It does add **one optional post-deploy step**: run `npx tsx scripts/backfill-activity.ts --write` so accounts that predate it show the enrolment XP they already earned rather than a blank dashboard. Skipping it is safe — those students simply start from zero and accrue normally from their next visit.

Milestone 3 adds no new environment variables and no new deploy step, but two things are worth knowing before deploying it:
- **Student sessions keep working**, unlike the Milestone 2 deploy — the cookie names did not change. **The root administrator's session does not**: its old token carries `role: 'admin'` with no `sub` and no `root` flag, so it is refused with 401 and the root admin must sign in again. That refusal is deliberate and covered by a test (it must not degrade into matching an arbitrary account).
- **The first admin can only be created by the root account.** Promotion requires the target account to be email-verified, so in production this depends on SMTP being configured first.

## Important File Locations

| Concern | Location |
|---|---|
| Express app assembly | [backend/src/app.ts](backend/src/app.ts) |
| Auth routes (all 12) | [backend/src/routes/v1/auth.routes.ts](backend/src/routes/v1/auth.routes.ts) |
| Token service | [backend/src/lib/tokens.ts](backend/src/lib/tokens.ts) |
| Password hashing | [backend/src/lib/password.ts](backend/src/lib/password.ts) |
| Email transport + templates (`deliverEmail` **throws**) | [backend/src/lib/email.ts](backend/src/lib/email.ts) |
| **THE email queue — nothing else may deliver** | [backend/src/services/emailOutbox.ts](backend/src/services/emailOutbox.ts) |
| **THE automated-event catalogue (copy, category, opt-out)** | [backend/src/lib/systemNotifications.ts](backend/src/lib/systemNotifications.ts) |
| Domain event → notification wiring | [backend/src/services/systemNotifier.ts](backend/src/services/systemNotifier.ts) |
| Notification-system tests (46, incl. failure handling) | [backend/tests/notifications.test.ts](backend/tests/notifications.test.ts) |
| Email delivery console | [frontend/src/pages/Admin/EmailDeliveries.tsx](frontend/src/pages/Admin/EmailDeliveries.tsx) |
| **Permission table (start here for authorization)** | [backend/src/lib/permissions.ts](backend/src/lib/permissions.ts) |
| Authorization middleware | [backend/src/middleware/auth.ts](backend/src/middleware/auth.ts) |
| Audit-trail recorder | [backend/src/lib/audit.ts](backend/src/lib/audit.ts) |
| Admin user-management + audit routes | [backend/src/routes/v1/users.routes.ts](backend/src/routes/v1/users.routes.ts) |
| Rate limiters | [backend/src/middleware/rateLimiter.ts](backend/src/middleware/rateLimiter.ts) |
| Auth validation schemas | [backend/src/validation/authSchemas.ts](backend/src/validation/authSchemas.ts) |
| Student / token / audit models | [backend/src/models/](backend/src/models/) |
| Auth integration tests | [backend/tests/auth.flows.test.ts](backend/tests/auth.flows.test.ts), [backend/tests/auth.security.test.ts](backend/tests/auth.security.test.ts) |
| **Privilege-escalation tests** | [backend/tests/rbac.test.ts](backend/tests/rbac.test.ts) |
| **Own-account routes (profile, settings, dashboard)** | [backend/src/routes/v1/me.routes.ts](backend/src/routes/v1/me.routes.ts) |
| **XP awards + level thresholds** | [backend/src/lib/xp.ts](backend/src/lib/xp.ts) |
| **Achievement catalogue** | [backend/src/lib/achievements.ts](backend/src/lib/achievements.ts) |
| The IST day boundary streaks are measured in | [backend/src/lib/competitionDay.ts](backend/src/lib/competitionDay.ts) |
| Activity log writer (the only place XP is awarded) | [backend/src/services/activityService.ts](backend/src/services/activityService.ts) |
| XP / streak / leaderboard derivation | [backend/src/services/progressService.ts](backend/src/services/progressService.ts) |
| Practice availability + daily challenge | [backend/src/services/challengeService.ts](backend/src/services/challengeService.ts) |
| **THE marking rules (shared by practice and mock tests)** | [backend/src/services/grading.ts](backend/src/services/grading.ts) |
| **The shared served-question / answer-key-snapshot shape** | [backend/src/models/attemptAnswer.ts](backend/src/models/attemptAnswer.ts) |
| **Mock tests: timing, single submission, disclosure, results** | [backend/src/services/mockTestService.ts](backend/src/services/mockTestService.ts) |
| **Daily challenge: pinning a day, scheduling, streaks** | [backend/src/services/dailyChallengeService.ts](backend/src/services/dailyChallengeService.ts) |
| **THE gamification engine (start here for any reward)** | [backend/src/services/rewardService.ts](backend/src/services/rewardService.ts) |
| **THE ranking (start here for any standing)** | [backend/src/services/leaderboardService.ts](backend/src/services/leaderboardService.ts) |
| Hall of Fame boards | [backend/src/services/hallOfFameService.ts](backend/src/services/hallOfFameService.ts) |
| Leaderboard + Hall of Fame routes (both public) | [backend/src/routes/v1/leaderboard.routes.ts](backend/src/routes/v1/leaderboard.routes.ts) |
| Ranking-correctness tests (ties, pages, periods) | [backend/tests/leaderboard.test.ts](backend/tests/leaderboard.test.ts) |
| Leaderboard / Hall of Fame pages | [frontend/src/pages/Leaderboard/Leaderboard.tsx](frontend/src/pages/Leaderboard/Leaderboard.tsx), [frontend/src/pages/HallOfFame/HallOfFame.tsx](frontend/src/pages/HallOfFame/HallOfFame.tsx) |
| The one facts object the three catalogues read | [backend/src/lib/rewardFacts.ts](backend/src/lib/rewardFacts.ts) |
| Badge families / journey stages / achievements | [backend/src/lib/badges.ts](backend/src/lib/badges.ts), [backend/src/lib/journey.ts](backend/src/lib/journey.ts), [backend/src/lib/achievements.ts](backend/src/lib/achievements.ts) |
| Reward edge-case tests (duplicates, config, tiers) | [backend/tests/gamification.test.ts](backend/tests/gamification.test.ts) |
| Rewards pages | [frontend/src/pages/Rewards/Rewards.tsx](frontend/src/pages/Rewards/Rewards.tsx), [frontend/src/pages/Admin/RewardSettings.tsx](frontend/src/pages/Admin/RewardSettings.tsx) |
| Daily challenge routes (student / scheduling) | [backend/src/routes/v1/dailyChallenge.routes.ts](backend/src/routes/v1/dailyChallenge.routes.ts), [backend/src/routes/v1/dailyChallengesAdmin.routes.ts](backend/src/routes/v1/dailyChallengesAdmin.routes.ts) |
| Daily challenge tests (reward guard, IST boundary) | [backend/tests/dailyChallenge.test.ts](backend/tests/dailyChallenge.test.ts) |
| Daily challenge pages | [frontend/src/pages/DailyChallenge/DailyChallenge.tsx](frontend/src/pages/DailyChallenge/DailyChallenge.tsx), [frontend/src/pages/Admin/DailyChallenges.tsx](frontend/src/pages/Admin/DailyChallenges.tsx) |
| Mock-test student routes (sitting a test) | [backend/src/routes/v1/mockTests.routes.ts](backend/src/routes/v1/mockTests.routes.ts) |
| Mock-test authoring routes | [backend/src/routes/v1/mockTestsAdmin.routes.ts](backend/src/routes/v1/mockTestsAdmin.routes.ts) |
| Mock-test tests (timing, duplicate submission, disclosure) | [backend/tests/mockTests.test.ts](backend/tests/mockTests.test.ts) |
| Mock-test pages (student) | [frontend/src/pages/MockTests/](frontend/src/pages/MockTests/) |
| Mock-test pages (admin: list, editor, results) | [frontend/src/pages/Admin/MockTests.tsx](frontend/src/pages/Admin/MockTests.tsx), [frontend/src/pages/Admin/MockTestForm.tsx](frontend/src/pages/Admin/MockTestForm.tsx), [frontend/src/pages/Admin/MockTestResults.tsx](frontend/src/pages/Admin/MockTestResults.tsx) |
| Shared answer-stripped question projection | [backend/src/services/questionView.ts](backend/src/services/questionView.ts) |
| Session cookie helpers | [backend/src/lib/session.ts](backend/src/lib/session.ts) |
| Profile / settings validation | [backend/src/validation/profileSchemas.ts](backend/src/validation/profileSchemas.ts) |
| Profile + dashboard tests | [backend/tests/profile.test.ts](backend/tests/profile.test.ts), [backend/tests/dashboard.test.ts](backend/tests/dashboard.test.ts) |
| Student profile page | [frontend/src/pages/Profile/Profile.tsx](frontend/src/pages/Profile/Profile.tsx) |
| Student dashboard (all real data) | [frontend/src/pages/Dashboard/Dashboard.tsx](frontend/src/pages/Dashboard/Dashboard.tsx) |
| Frontend API client (auto-refresh) | [frontend/src/api/client.ts](frontend/src/api/client.ts) |
| Session/auth state | [frontend/src/context/AuthContext.tsx](frontend/src/context/AuthContext.tsx) |
| New auth pages | [frontend/src/pages/Auth/](frontend/src/pages/Auth/) |
| Frontend route guards + unauthorized state | [frontend/src/components/ProtectedRoute.tsx](frontend/src/components/ProtectedRoute.tsx), [frontend/src/components/Unauthorized.tsx](frontend/src/components/Unauthorized.tsx) |
| Admin shell + permission-aware nav | [frontend/src/pages/Admin/AdminShell.tsx](frontend/src/pages/Admin/AdminShell.tsx) |
| Admin user management / audit pages | [frontend/src/pages/Admin/Users.tsx](frontend/src/pages/Admin/Users.tsx), [frontend/src/pages/Admin/AuditLog.tsx](frontend/src/pages/Admin/AuditLog.tsx) |
| **THE question-generator seam + the trust boundary** | [backend/src/lib/questionGeneratorTypes.ts](backend/src/lib/questionGeneratorTypes.ts), [backend/src/services/questionGeneratorService.ts](backend/src/services/questionGeneratorService.ts) |
| **THE only AI call in the product** | [backend/src/services/geminiQuestionGenerator.ts](backend/src/services/geminiQuestionGenerator.ts) |
| Question-generator tests (20, mostly "must be refused") | [backend/tests/questionGenerator.test.ts](backend/tests/questionGenerator.test.ts) |
| **THE recommendation seam — start here to add an ML/LLM engine** | [backend/src/lib/recommendationTypes.ts](backend/src/lib/recommendationTypes.ts) |
| **THE default engine (statistical, not AI)** | [backend/src/lib/statisticalRecommender.ts](backend/src/lib/statisticalRecommender.ts) |
| **THE path to a recommendation** | [backend/src/services/recommendationService.ts](backend/src/services/recommendationService.ts) |
| Recommendation tests (35, mostly "must not conclude") | [backend/tests/recommendations.test.ts](backend/tests/recommendations.test.ts) |
| Recommendation panel (computes nothing) | [frontend/src/components/Recommendations.tsx](frontend/src/components/Recommendations.tsx) |
| **THE student analytics derivation (Milestone 15)** | [backend/src/services/analyticsService.ts](backend/src/services/analyticsService.ts) |
| **THE admin question + paper performance** | [backend/src/services/questionAnalyticsService.ts](backend/src/services/questionAnalyticsService.ts) |
| Analytics tests (32, all against declared outcomes) | [backend/tests/analytics.test.ts](backend/tests/analytics.test.ts) |
| Analytics fixtures (declared outcomes → real grader) | [backend/tests/helpers/analytics.ts](backend/tests/helpers/analytics.ts) |
| Question / paper performance console | [frontend/src/pages/Admin/QuestionPerformance.tsx](frontend/src/pages/Admin/QuestionPerformance.tsx) |
| **THE official sitting + ranking (Milestone 13)** | [backend/src/services/examService.ts](backend/src/services/examService.ts) |
| **THE only certificate issuance path + the PDF** | [backend/src/services/certificateService.ts](backend/src/services/certificateService.ts) |
| The shared answer-key snapshot (mock tests + exam) | [backend/src/services/attemptSnapshot.ts](backend/src/services/attemptSnapshot.ts) |
| Exam routes (sitting / authoring + release) | [backend/src/routes/v1/exams.routes.ts](backend/src/routes/v1/exams.routes.ts), [backend/src/routes/v1/examsAdmin.routes.ts](backend/src/routes/v1/examsAdmin.routes.ts) |
| Certificate + public verification routes | [backend/src/routes/v1/certificates.routes.ts](backend/src/routes/v1/certificates.routes.ts) |
| Exam / certificate tests (50, Milestone 13) | [backend/tests/examCertificates.test.ts](backend/tests/examCertificates.test.ts) |
| **Inbox rules + read state (Milestone 12)** | [backend/src/services/notificationService.ts](backend/src/services/notificationService.ts) |
| **THE admin figures — all counted, never estimated** | [backend/src/services/platformAnalyticsService.ts](backend/src/services/platformAnalyticsService.ts) |
| **THE super-admin bootstrap (Milestone 11)** | [backend/src/services/rootAdminService.ts](backend/src/services/rootAdminService.ts) |
| Admin-platform tests (43, Milestone 12) | [backend/tests/adminPlatform.test.ts](backend/tests/adminPlatform.test.ts) |
| Account-administration tests (27, Milestone 11) | [backend/tests/accountManagement.test.ts](backend/tests/accountManagement.test.ts) |
| Email transport + templates | [backend/src/lib/email.ts](backend/src/lib/email.ts) |
| Dev server config | [.claude/launch.json](.claude/launch.json) |

## Current Environment Requirements

**AI question drafting has seven optional variables, including the project's only AI credential**: `GEMINI_API_KEY` (absent by default), `GEMINI_MODEL` (default `gemini-2.5-pro`; `.env.example` suggests the `gemini-flash-latest` alias, which is faster and cheaper for drafting), `QUESTION_GENERATOR` (default `auto`), and — added in Milestone 20 — `GEMINI_MAX_RETRIES` (default 1), `GENERATION_MAX_QUESTIONS` (default 20), `GENERATION_MAX_INSTRUCTION_CHARS` (default 500) and `GENERATION_RATE_LIMIT_PER_HOUR` (default 60). **Leaving all seven unset is fully supported** and every other feature works: the AI generator page then reports itself unconfigured and the endpoint answers 503 naming the variable. It does **not** invent filler — the blank-template fallback was deleted in Milestone 18. Setting the key is the only step needed to turn AI drafting on. `npm run verify:gemini --prefix backend` is a read-only check that asks Google which models the key can call and whether `GEMINI_MODEL` is one of them; it spends no generation quota. See [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) for step-by-step instructions, the verification steps and the free-tier cost note.

**Milestone 16 adds one optional variable, `RECOMMENDATION_ENGINE`** (default `statistical-v1`), and **nothing to obtain**: it names code in this repository, not an external service, and the default engine makes no network calls and needs no credentials. Leaving it unset entirely is the supported configuration and is what production should run. An unregistered value is not fatal — the service logs once and falls back. There is still **no AI provider, no API key and no paid service anywhere in this codebase**.

Milestones 3 through 13 added **no new environment variables** — with one removal: `ADMIN_TOKEN_TTL` went in Milestone 11, when the super admin stopped being a document-less identity and started using `ACCESS_TOKEN_TTL` with a refresh token like every other account. `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` keep their names but are now the **bootstrap seed** for the root `superadmin` document rather than the ongoing source of truth.

Backend: `MONGO_URI`, `JWT_SECRET` (mandatory in production), `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `FRONTEND_URL` (also the base for emailed links), and the SMTP group (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM`). Optional policy knobs: `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `REQUIRE_EMAIL_VERIFICATION`, `MAX_FAILED_LOGINS`, `ACCOUNT_LOCK_MINUTES`. (`ADMIN_TOKEN_TTL` was **removed in Milestone 11** — the super admin now uses `ACCESS_TOKEN_TTL` with a refresh token.) Frontend: none. Full detail in [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md).

**SMTP is configured and delivery is confirmed** (owner, 2026-08-12): verification links reach students' inboxes. This closes the longest-standing operational unknown in the project — it gated login, which requires verification, and admin promotion, which requires a verified account. Earlier revisions of this file recorded only that a *send* had been observed; the delivery itself has now been seen.

**`npm run dev:local` no longer sends mail** (Milestone 7). It points SMTP at a dead local port and sets `REQUIRE_EMAIL_VERIFICATION=false`, so a local registration completes without emailing anybody and can sign in immediately. Both are overridable for a run that genuinely wants to exercise delivery, and `npm run verify:email --prefix backend` remains the deliberate way to test it. Before this, `dev:local` overrode `MONGO_URI` but *not* the SMTP group — so registering a made-up address against the local database sent a real message through the owner's real provider to whoever owned that address.

## Known Bugs

0. **Existing student documents predate `role`** — but harmlessly. Unlike the `email` problem below, `role` is optional with a schema default, so an old document simply reads as `role: 'student'` and needs no backfill. Worth knowing when reading a raw document that has no `role` field.
1. **Existing student documents predate `email`.** `email` is now required and unique, so any `Student` created before Milestone 2 lacks it and will fail validation the next time it is saved. Reads still work. There is no migration script. If the Atlas database holds real students, they must be given addresses (or removed) before they can log in — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
2. **~~Analytics never persisted~~ — CLOSED in Milestone 15.** `generateAIInsights()` is deleted along with the model it mutated. Nothing in the product claims to be AI any more, and strengths and weaknesses are derived facts with a stated minimum sample rather than generated prose.
3. **~~One half-dead model remains~~ — CLOSED in Milestone 15.** Every model is now both read and written. `Result` and `ExamAttempt` left this entry in Milestone 13; `StudentAnalytics`, the last one, was **deleted** rather than filled in (it predated Milestone 4 and was the wrong shape — see the ADR), and analytics are derived on read instead. Kept as a marker because "is anything read but never written?" is a question worth re-asking after every milestone.
4. **`/api/v1/auth/me` returns 503 when the database is unreachable** for account-backed callers (the root admin answers from the token alone). The frontend treats any failure as "guest", so behaviour is correct, but the status is broader than ideal.
5. **Privileged routes need the database to authorize.** Because the role is re-read per privileged request, an administrator sees **503** rather than 403 while MongoDB is down. This is deliberate (see [`DECISIONS.md`](DECISIONS.md)) — correctness over availability on admin endpoints — but it does mean the admin panel is unusable during a database outage.
6. **The root `superadmin` is visible but deliberately not manageable from the app.** Since Milestone 11 it *has* a document, so it appears in `/admin/users` and its audit entries carry a resolvable actor — but `refuseIfProtected()` refuses to suspend, demote, password-reset or delete it, by anybody including itself. That is intentional, not an oversight: it is the account that can restore all the others. Withdrawing it still means changing the environment and redeploying. It *can* now change its own password from account settings, which is new.
7. **No rate limit specific to the admin routes.** They sit behind the general `/api` limiter only.
8. **Photos are stored as uploaded** — not re-encoded and not stripped of metadata, so EXIF (including any GPS tags a phone wrote) is kept and served back to staff. Still true of the Milestone 5 replacement route, which reuses the same validation. Re-encoding through an image library would fix it; see [`SECURITY.md`](SECURITY.md).
9. **A photo cannot be *removed*, only replaced.** `PUT /me/photo` (Milestone 5) fixed the replacement half; deletion is deliberately not offered, because the photo is a required part of an entrant's record and "no photo" is a state registration cannot produce.
10. **Pre-Milestone-4 `Question` documents are unreadable** and must be deleted — `subject` changed from `String` to `ObjectId`, which is a cast error on read, not a tolerable missing field. Run `npx tsx scripts/migrate-questions.ts` (add `--delete`). All such documents are old template placeholders; nothing references them.
11. **No question-bank rate limit of its own.** Authoring routes sit behind the general `/api` limiter, like the other admin routes. (The Milestone 5 self-service routes *do* have one.)
12. **Question images are not supported.** A question is text plus LaTeX only, so a geometry diagram cannot be attached. Registration photos proved the storage pattern; nothing reuses it yet.
13. **Accounts created before Milestone 5 read as 0 XP with an empty activity feed**, because the activity log is written going forward. Not data loss — nothing was ever stored to lose. Fixed by running `npx tsx scripts/backfill-activity.ts --write`; see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
14. **A lost activity write silently costs XP.** `recordActivity()` never throws, by design, so a failed log write cannot fail the registration or password change it describes — but the student is quietly one event's XP short, visible only as an `error` log line. The alternative (failing the user's action because of a logging failure) is worse; the trade-off is recorded in [`DECISIONS.md`](DECISIONS.md).
15. **The leaderboard aggregates the whole activity collection on every request.** Correct at the scale this product is designed for (a few hundred students; photo storage caps it near 250) and isolated in `leaderboardPipeline()`, but it is the first query that will need a cache if the field grows an order of magnitude.
16. **XP still measures consistency more than ability.** Milestone 6 improved this — `practice_completed` requires actually answering questions — but because it is capped at once per day, a student who practises hard is not distinguished from one who practises lightly. Official exam scoring is what will measure ability properly. Worth telling entrants before the competition runs.
17. **A practice session holds a copy of the answer key.** Deliberate (see [`DECISIONS.md`](DECISIONS.md)): grading must not drift when an author edits a question mid-session. The consequence is that the key exists in a second collection, so projection discipline matters more, not less — `practiceService.ts` builds two explicit views, `sessionReviewView()` throws on an unsubmitted session, and tests assert the forbidden field names are absent from whole in-progress response bodies.
18. **Abandoned practice sessions are never cleaned up.** `PracticeSession` has a third status, `abandoned`, that nothing currently sets: an unfinished session simply stays `in_progress` for ever and the Practice Zone offers to resume it. Harmless, but the collection grows with every session a student starts and does not finish.
19. **No partial credit on multiple choice.** An answer with three of four correct options scores the same as a blank guess — in fact worse, since a wrong answer attracts negative marks. Adding partial credit needs a field on `Question` first (see [`DECISIONS.md`](DECISIONS.md)). Applies to mock tests too, which share the grader.
20. **An abandoned mock-test attempt stays `in_progress` until somebody reads it.** Expiry is finalised lazily — on the student returning, on their attempt list, or when an administrator opens that test's results, which sweeps first. Deliberate: the free tier has no scheduler, and grading uses `expiresAt` rather than the moment of discovery, so a late finalisation produces exactly the same mark. The visible consequence is that a count of submitted attempts is only accurate after a read. (Practice has the same shape of gap in bug #18, but worse: nothing sets `abandoned` at all there.)
21. **A mock test cannot be duplicated.** Changing the paper of a test people have sat is refused, and the honest answer is "publish a new test" — but that means rebuilding the question list by hand. A "copy this test" action is the obvious follow-up.
22. **Mock-test results are not exportable.** The admin results table is on-screen only; there is no CSV download, which is the first thing a real invigilator will ask for.
23. **Mock-test XP does not depend on the score.** 50 XP for completing one, whatever the mark — the same shape of limitation as bug #16, narrowed but not closed. Scoring-proportional XP belongs to the official exam, so that a mock cannot be worth more than the Olympiad it rehearses.
24. **A mock-test attempt holds a copy of the answer key**, exactly as a practice session does (bug #17). The key now exists in two collections beyond `Question`, so projection discipline matters more, not less — which is why `mockTestService.ts` builds three explicit views and `attemptReviewView()` refuses unless the test's policy allows it.
25. **A challenge scheduled for a class with nothing published cannot be filled automatically**, so that class simply has no challenge that day and the page says so. Correct behaviour, but it means the feature is only as alive as the question bank: today only `Class 12 - Science` has published questions, so every other class sees the empty state every day.
26. **A missed day is a missed day.** A student who does not answer on Tuesday cannot go back and answer Tuesday's challenge — the routes only ever resolve *today*. Deliberate (that is what "daily" means, and back-filling would make the streak meaningless), but it does mean the history has gaps that no action can close.
27. **Challenge XP does not depend on correctness**, the same shape of limitation as bugs #16 and #23. Recorded and shown, but not paid for; scoring-proportional XP belongs to the official exam.
28. **`DailyChallenge` grows unboundedly** — one document per class per day, forever, with no TTL because attempts refer to them. A few hundred rows a year at ten classes, so this is a note rather than a problem.
29. **XP still measures participation more than ability** (the standing form of bugs #16 and #23). Milestone 9 centralised how rewards are granted but deliberately did not change what they are for: a student who scores 40/40 on a mock test earns the same as one who scores 4/40. Scoring-proportional XP belongs to the official exam.
30. **Badge and journey thresholds are code, not configuration.** The award *amounts* are tunable; the targets (10 practice sessions for silver, five mock tests for the last journey stage) are not. Deliberate — they interact with each other — but it does mean rebalancing the ladders is a deploy.
31. **`buildRewardFacts()` runs four queries per call**, and both the dashboard and the rewards page call it. Correct and cheap at this scale, and it is the single place to add a cache if a cohort ever outgrows it — the same note as the leaderboard.
32. **A period leaderboard has no history.** "Last 7 days" always means the seven days ending today; there is no way to ask what last week's board looked like, and no notion of a season or a closed competition period. Deliberate for now — a board is a view of the present — but it does mean nothing preserves a weekly winner, so any "champion of the week" award would have to be recorded when it happens rather than reconstructed afterwards.
33. **The Hall of Fame has no official-exam board**, because nothing records an official sitting. Correct rather than missing, but it does mean the most prestigious board on the page is the one that does not exist yet.
34. **The streak board reads every active student's activity days into this process.** `summariseStreak()` is the same function the dashboard uses (which is the point — the honoured number cannot disagree with the student's own page), but computing it in code means loading one array of day keys per active student on every Hall of Fame load. Bounded by the cohort and correct at this scale; the same note as the leaderboard aggregation, and the same place a cache would go.
35. **A signed-out visitor cannot see past rank 100.** Deliberate (see [`DECISIONS.md`](DECISIONS.md)) — pagination would otherwise let the public board be walked to enumerate a roll of children — but a parent checking on a student ranked 140th has to sign in as that student to find them.
36. **The student dashboard's "recent test performance" panel shows official-exam attempts only, never mock results.** It queries `ExamAttempt`, which as of Milestone 13 is genuinely written — so the panel works now, where before it was correctly empty. It still deliberately excludes mock tests: a mock is a rehearsal, and conflating the two is the mistake the collection separation exists to prevent. A student who has sat mocks but no official exam still sees "no results yet" here; their mock history is on `/mock-tests`.
37. **~~Nothing writes `StudentAnalytics`~~ — CLOSED in Milestone 15**, by removing the collection and deriving analytics from the four attempt collections on read.
38. **An abandoned official-exam attempt is finalised lazily**, the same shape as mock tests (bug #20): `sweepExpiredExamAttempts()` runs when results are published and when an attempt is read. Deliberate — the free tier has no scheduler, and grading uses the stored `expiresAt` rather than the moment of discovery, so a late finalisation produces the same mark. Publishing results sweeps first, specifically so an abandoned paper is ranked rather than dropped.
39. **A certificate PDF is rendered on every download**, not cached. `pdf-lib` is fast and the snapshot makes the output deterministic, so this is correct rather than wrong — but it is CPU per request on a free serverless tier, and the first place to look if downloads ever feel slow.
40. **Milestone 14 has not been driven through a real browser.** The backend is covered by 46 integration tests against a real MongoDB, and the frontend type-checks, lints and builds — but the new surfaces (the unread badge, the preferences panel, the delivery console, the broadcast opt-in) have not been clicked through. A second Claude session was holding port 8081 with a backend process started *before* these changes, and since `dev:local` is not a watcher, verifying against it would have exercised stale code — which is worse than not verifying. Do this before deploying: stop any other dev server, then `npm run dev:local --prefix backend` and the frontend.
41. **Email delivery has no deadline on an idle site.** The queue drains on an opportunistic kick and on later requests, because the free tier has no scheduler. If nothing touches the API, a queued message waits. Mitigated by the explicit "Send queued now" action on `/admin/email-deliveries`, and by the fact that the *transactional* mail that matters most is queued during a request that has just happened. A real fix is a cron ping, which needs either a paid Vercel plan or a free external uptime pinger — worth doing before a large cohort registers.
42. **Delivery is at-least-once, so a duplicate email is possible.** If a container dies after the provider accepted a message but before the row was marked `sent`, it is sent twice. Deliberate (see the `EmailOutbox` comment): the alternative bookkeeping cannot close the window without provider-side idempotency, and a duplicate notice is a much smaller harm than a lost one.
43. **A broadcast email is capped at 500 recipients and does not resume past the cap.** `EMAIL_BROADCAST_CAP` reports `cappedAt` so staff can see it happened, but there is no "continue from where it stopped" — the honest workaround is a second, class-targeted announcement. Fine at the scale photo storage caps the cohort to (~250), and it is the explicit ceiling rather than a silent one.
44. **`notificationPrefs` is not exposed on the admin account view.** Staff cannot see why a student is not receiving announcement email, only that the broadcast reported them as suppressed. The aggregate count is enough to explain the outcome, but not to answer "why didn't *this* child get it?".
45. **Recategorising a question moves historical analytics.** Deliberate — the taxonomy join is live, so "how am I doing in Trigonometry?" follows the current filing rather than describing one nobody uses any more (see the Milestone 15 ADR). The visible consequence is that a bulk retag changes every affected student's topic breakdown retroactively. Grading is unaffected: it reads the snapshot, always.
46. **A deleted question's answers drop out of the topic breakdown.** They still count toward the overall totals, and the gap is surfaced — `servedIncludingDeletedQuestions` differs from `served`, and the page says some answered questions have since been removed. An "Unknown topic" bucket was rejected as a fabricated category.
47. **There is no per-question timing anywhere in the product.** No collection stores one; `answeredAt` is a timestamp, not a duration, and a student may answer in any order. So pace is per *attempt* (the sitting's duration over its question count) and the **daily challenge is excluded entirely**, having no clock. Adding real per-question timing means a field on `attemptAnswer` and a change to every service that serves a paper — worth doing before the first national sitting if pace-per-question is ever to be reported honestly.
48. **Analytics are recomputed on every page load, uncached.** Eight indexed operations bounded by one student's own history, which is correct and cheap at this scale — and deliberately preferred over a cache that could show a stale accuracy. It is the same note the leaderboard and `buildRewardFacts()` carry, and `getStudentAnalytics()` is the single place a cache would go.
49. **Question performance scans every submitted attempt.** Unavoidable for a platform-wide figure, and bounded by total attempts rather than by one student. Correct at a cohort of a few hundred; the first thing to reach for if it slows is a nightly rollup, which would then need the drift-versus-freshness argument the ADR makes for the student side.
50. **A recommendation has no sense of time.** A topic answered badly six months ago weighs exactly as much as one answered badly last week — the engine sums a student's whole history, because that is what `analyticsService` reports and because a decay curve is a tuning parameter nobody has evidence for yet. The visible consequence is that a fixed weakness keeps being recommended until enough new answers outweigh the old ones. A `since` window on the facts object is the obvious place this goes.
51. **Recommendations are recomputed on every page load, uncached** — the analytics derivation plus three more indexed operations. The same note the leaderboard, `buildRewardFacts()` and `getStudentAnalytics()` carry, and `getRecommendations()` is the single place a cache would go. Deliberately preferred over a cache that could advise from a stale record.
52. **Recommendations appear on `/analytics` only.** The dashboard is arguably the better home for "what should I do now?", and the `/rewards` journey map already answers a version of it. Not built, to keep one surface and one request rather than three pages each paying for the derivation.
53. **The difficulty ladder assumes `Easy → Medium → Hard` is a progression.** It is the only ordering `Question.difficulty` offers, and the step-up rule reads it as one. If a fourth level is ever added, `DIFFICULTY_LADDER` in `lib/recommendationTypes.ts` is the one place that decides what "the next level up" means.
54. **A weakness is only as well-filed as the taxonomy.** Recommendations inherit bug #45 exactly: the analytics join is live, so a bulk retag moves which topic a student is told to work on. Correct rather than wrong, and worth knowing before a retag.
55. **The Milestone 15 `strongAreas` / `weakAreas` lists overlap when a student has fewer than ten measurable areas** — a **pre-existing defect, found by running the page during Milestone 16** and deliberately not fixed in it. `analyticsService.ts` computes `strongAreas = ranked.slice(0, 5)` and `weakAreas = [...ranked].reverse().slice(0, 5)`, so with six qualifying areas four of them appear in **both** lists. Observed live: a topic at **95% of 20** was listed under "Weak areas", one row below the same topic under "Strong areas". The figures are right and the ordering is right; the labelling is not. It is more visible now, because the Milestone 16 panel sits directly above and (correctly) calls that topic a strength and does not call it a weakness. Fixing it is a *policy* choice rather than a patch — non-overlapping halves, or a par threshold like the recommender's — and it would change behaviour Milestone 15 has tests for, so it wants its own change. The recommendation panel is unaffected: it decides strength and weakness on a confidence interval against fixed thresholds, so a topic cannot be both.

56. **No real Razorpay payment has ever been made.** The whole path — order creation, checkout, signature verification, capture, reconciliation — runs only against a fake transport in tests, because no credentials exist in the development sandbox. 31 tests cover it, including every refusal path, but a test cannot prove that Razorpay's live API shapes its responses the way this code reads them. **Do one test-mode payment before announcing anything**; see "Immediate Next Task".
57. **Settlement waits for somebody to ask.** With no webhook secret configured, a captured payment is recorded when the browser returns, or when the payment page next loads, or when the modal is dismissed — not automatically within seconds. A student who pays and never returns to the site is entitled in Razorpay's records and not in this database until something triggers a reconcile. Deliberate (see the ADR), and closed entirely by setting `RAZORPAY_WEBHOOK_SECRET`, which needs no code change.
58. **Staff are subject to the paywall.** A promoted admin is an ordinary student account and the gate asks about payment, not role — so an administrator who wants to click through practice or a mock test must pay or switch the fee off at `/admin/payments`. Deliberate: a role exemption inside a payment gate is how people get silently admitted. Worth knowing before somebody reports it as a bug.
59. **A fresh database gates everything.** `entryFeeEnabled` reads as `true` when no `PaymentSettings` document exists, so a brand-new local environment with no Razorpay keys shows students "payment is temporarily unavailable" on every locked feature. Correct, and the intended failure direction, but it makes a first local run confusing unless the fee is switched off or the keys are set.
60. **There is no refund path in the product.** A refund is issued from the Razorpay dashboard, and nothing here notices: the `Payment` row stays `captured`, so the student keeps their entitlement. `refunded` exists in the status enum and nothing writes it. Fine while refunds are rare and manual; it needs a route, or at least a documented manual step, before it happens at any volume.
61. **A payment cannot be attributed to a specific exam.** `purpose` is `olympiad_entry` and the entitlement is lifetime — there is no notion of paying again for next year's competition. That is right for one competition and wrong for the second one, and the enum plus a per-exam `purpose` is where that would go.

Fixed in Milestone 5: no way to edit your own details after registering; no way to replace a photo (bug #9's replacement half); the invented dashboard stat tiles and fake leaderboard; the invented landing-page figures and champions; the hardcoded `daily-challenge` and `leaderboard` mocks; and `optionalName` rejecting an explicit `null`, which made "remove my middle name" a 400.

Fixed in the Milestone 5 follow-up (a gap audit against the original brief):
- **The analytics endpoint fabricated every student's performance** — it returned 88% accuracy over 450 questions, a rising learning curve, four topic breakdowns and "top 5% of all national Olympiad participants" whenever no `StudentAnalytics` document existed, which is always. Deleted, and replaced with an honest null plus a real `xpByDay` series. This was the same defect Milestone 5 set out to remove, missed on the first pass because the page sits outside the dashboard route — a reminder that "no fake statistics" has to be audited across every student-facing page, not just the one being built.
- **`GET /me/daily-challenge` had no frontend caller**, leaving "upcoming/available challenges" half delivered. Now surfaced on the dashboard as a read-only card, code-split so KaTeX stays out of the main bundle.
- **`GET /me/activity` had no frontend caller**, capping the feed at 8 with no way to see earlier events. Now paged by a "Show earlier activity" control.

Fixed in Milestone 4: `GET /questions` being **unauthenticated and returning the answer key**; `correctAnswer` stored as literal option text (so editing a typo invalidated recorded answers); `Question` having no `topic` field despite the generator asking for one; subjects and topics existing only as free-text strings; and the template generator being able to invent taxonomy nothing else knew about.

Fixed in Milestone 3: the absent admin tooling for account status, the inline role checks scattered across handlers, the analytics route's role comparison, the 15-minute window in which a demoted admin kept working, and `logout-all` being unusable by a non-student role.

Fixed in Milestone 2: the `studentId` collision risk (now uniquely indexed with retry-on-collision), the absent password reset, the absent email verification, and the inability to revoke a session.

## Technical Debt

- **Staff accounts are `Student` documents.** A promoted admin lives in the `Student` collection with `role: 'admin'`, so the model name is now narrower than what it stores. Renaming it needs a migration and was out of scope — see [`DECISIONS.md`](DECISIONS.md).
- `StudentAnalytics` is read-but-never-written — the last of the half-dead models (`Result` and `ExamAttempt` were rewritten and are written as of Milestone 13).
- No migration tooling — the `email` backfill above has to be done by hand. There are now two ad-hoc scripts (`migrate-questions.ts`, `backfill-activity.ts`), which is the point at which a real migration runner starts to be worth it.
- **Reward settings are read once per grant**, uncached, deliberately: grants are rare, the read is one indexed document, and on serverless a per-container cache would buy nothing while making "why is it still paying the old amount?" a real question. Isolated in `resolveXpFor()`.
- **Four attempt-shaped collections now exist** (`PracticeSession`, `MockTestAttempt`, `DailyChallengeAttempt`, and the unwritten `ExamAttempt`). The dangerous duplication stays extracted — one served-question shape, one grader — but the count is now high enough that a fifth should prompt a rethink rather than another file.
  Note the earlier revision of this entry said "a fourth would be a sign the separation needs revisiting" — Milestone 8 added the fourth. It was still the right call for the reasons in that ADR (a challenge has no session, no clock and no disclosure policy), but the next one should not be waved through on the same argument.
- **`testResults()` ranks in memory.** Correct for a cohort of a few hundred sitting one test, and isolated in one function, but it loads every attempt for that test. A `$setWindowFields` aggregation is where this goes if a single test ever outgrows it — the same note as the leaderboard below.
- **The mock-test results sweep is O(expired attempts) per read.** Bounded by one test's cohort and idempotent, but it does mean the first read after a large test closes does the finalising work for everybody.
- **The leaderboard and progress aggregations are uncached**, deliberately, in exchange for having no counter that can drift. `scopedPipeline()` in `services/leaderboardService.ts` is the single place to add a materialised standing when the cohort outgrows it. A leaderboard page now costs three aggregations (the rows, the total, and the count-ahead that fixes the first row's rank); the period boards are the cheap ones, since `{occurredOn: -1}` narrows them before the grouping.
- The frontend mirrors the activity type names, their labels and the class list in `api/types.ts`. As with the permission names, the *rules* are not duplicated — only the labels — but adding an activity type means touching two places.
- `frontend/src/lib/` now exists (one file, `photo.ts`) with no stated convention in `CLAUDE.md` for what belongs there versus `components/`.
- Hardcoded production backend URL inside `frontend/vercel.json`.
- Mixed English/Hindi error strings are now gone from the auth routes, but `PROJECT_STATE`-era Hinglish may remain elsewhere; no deliberate localisation decision has been made.
- No CI pipeline; verification commands are run manually.
- No CSRF token mechanism (production cookies are `sameSite: 'none'` because the apps are on different domains).
- No frontend test suite at all — so the route guards, permission-aware navigation and unauthorized states are verified only by hand in a browser.
- **Two parsers implement the LaTeX grammar** — `backend/src/lib/mathContent.ts` and `frontend/src/components/MathText.tsx`. Both are deliberately a single left-to-right scan with no nesting so they can be checked against each other by reading them, and they differ in one intended way (the frontend renders an unclosed delimiter as literal text so a half-typed formula still previews). A change to one must be mirrored.
- The frontend mirrors the *names* of the permissions as a TypeScript union in `api/types.ts`. The mapping is not duplicated (it comes from the server), but adding a permission means adding its name in two places.
- The unversioned `/api/*` alias should eventually be removed.
- Pre-existing `npm audit` findings in `@vercel/node`'s build-time dependency tree.

## Immediate Next Task

**Three of the four long-standing owner blockers were cleared by the owner on 2026-08-12:**

- **Email delivery is confirmed.** SMTP works and verification links reach students. This was the item gating everything else, because login requires verification and admin promotion requires a verified account.
- **The Class 12 question bank is live.** `scripts/seed-class12.ts` has been run against the real database: 208 published questions (104 Mathematics, 104 Physics) for `Class 12 - Science`. Other classes still have nothing published, and both the Practice Zone and mock tests are only as good as the bank behind them — so seeding another class is the highest-value content task remaining.
- **The public leaderboard keeps first name + last initial.** Decided deliberately: the entrants are minors and the landing page is indexable. `displayNameFor()` stays as it is.

**Owner actions still outstanding — neither can be done from the development sandbox:**

1. **Two maintenance scripts, if they have not been run yet.** From inside `backend/` (they are not repo-root scripts), both idempotent and report-only without their flag:
   - `npx tsx scripts/migrate-questions.ts --delete` — removes pre-Milestone-4 question documents, which the current model **cannot read at all** (a cast error on `subject`, not a tolerable missing field). Until then the admin question list errors on any of them. If the seeded bank lists and filters cleanly in `/admin/questions`, there were none left to remove and this is already done.
   - `npx tsx scripts/backfill-activity.ts --write` — gives pre-Milestone-5 accounts the enrolment XP they already earned. Optional; skipping it just means those students start from zero and accrue normally.
2. **Publish a mock test for a class that has questions**, and watch one real student sit it. The system is verified end to end locally, but no paper exists in production yet, and a first live sitting is the cheapest way to find out whether the window, duration and disclosure settings are the ones the competition actually wants. Start with something small — ten questions, twenty minutes, results immediate, answers after close.
3. **Seed a second class's question bank.** This is now the highest-value *content* task by some distance, because three features depend on it and all three are empty for nine of the ten classes: the Practice Zone has nothing to draw, a mock test cannot be assembled, and the daily challenge shows "no challenge today" every day. `scripts/seed-class12.ts` is the working model for how to do it — validated through the API's own schema, report-only by default, idempotent.

**Payments are DONE** (Milestone 19, 2026-08-16) — see "Current Payment State". The line that used to sit here said payment integration was reserved for the final milestone and needed a provider decision first; both happened. What remains is **owner-only and blocks the live launch**:

1. **Put the Razorpay keys in `backend/.env`.** Nothing has ever run against the real gateway. From the Razorpay dashboard in **TEST MODE**: Settings → API Keys → Generate Test Key, then add to `backend/.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   ```
   Restart the backend. `/admin/payments` will stop showing "Razorpay is not configured". **Never commit these.** For production, the same two keys from **Live mode**, set in the Vercel project's environment variables rather than in a file.
2. **Drive one real test payment through a browser.** Register a student, verify the email, sign in, and check that the dashboard shows the ₹100 banner and that Practice / Mock Tests / Daily Challenge each show the locked panel. Pay with Razorpay's test card `4111 1111 1111 1111` (any future expiry, any CVV). The lock should lift on all three. Then, deliberately, **close the tab mid-payment** and reopen `/payment` — reconciliation should find the payment and confirm the entry. That last case is the one the whole reconcile path exists for and the only one a test cannot prove.
3. **Decide whether the fee stays at ₹100 in production**, and set it at `/admin/payments`. The code default is ₹100; the settings document overrides it and is audited.

**Two things a future session must not be surprised by:**

- **Staff are not exempt from the paywall.** A promoted admin is an ordinary student account, and the gate asks about payment rather than about role — deliberately, because a role exemption inside a payment gate is exactly the sort of thing that silently admits people. An administrator who wants to click through practice must either pay or switch the fee off at `/admin/payments`.
- **`entryFeeEnabled` now defaults to `true`.** A fresh database with no settings document gates everything. That is the point, but it means a brand-new local environment with no Razorpay keys shows students "payment unavailable" until either the keys are set or the fee is switched off.

**Milestone 18 left three areas of the AI brief unbuilt, in this order of value:**

1. **AI mock-test generation.** The generation pipeline is provider-agnostic and already produces validated questions, so this is assembling a `MockTest` around a batch — difficulty distribution, question-type distribution, total marks, time limit — plus a review screen that reuses the one built here. Roughly a day.
2. **Daily-challenge automation.** Needs a `DailyChallengeConfig` document (enabled, per-day count, classes, subjects, difficulty mix, trigger time), a selection engine that avoids recently-used questions, a **secured trigger endpoint**, and an admin console showing status and the generation log. **You chose a free external pinger** (cron-job.org / UptimeRobot) over paid Vercel Cron, so the endpoint takes a shared secret and you point the pinger at it — a five-minute setup once the endpoint exists.
3. **Bulk population.** A batched, resumable script with `--limit`, run against the 26 Class 12 Science chapters that already exist. The other nine classes have **no subjects or chapters at all**, so they need a syllabus before anything can be generated for them — that is a content decision only you can make.

**Browser verification is outstanding for the whole AI feature.** No `GEMINI_API_KEY` is available in this development sandbox, so the model path has only ever run against a fake transport. Before trusting it in production:
- open `/admin/ai-generator` and confirm the banner reads **Google Gemini**, not "Not configured";
- generate 3 single-choice questions on a chapter that already has some, and check the bank is unchanged until you approve;
- read one solution end to end and verify the marked answer is actually correct — the model is a first draft, not an examiner;
- try *Regenerate this one* and *Approve as drafts*, then find them in `/admin/questions`.

**Milestone 16 (intelligent performance recommendations) is done** — see "Current Development Phase". It needs **no owner action at all**: no new credential, no provider signup, and no cost. The one new environment variable has a working default and should be left unset in production.

**If you later want a model behind the recommendations**, two questions have to be answered first, and neither is technical:

1. **May a named minor's performance record leave this system?** The advice is derived from children's accuracy, weakest topics and progress. Sending that to a third-party API is a decision for you, not for a milestone — and free tiers commonly reserve the right to train on submitted data. If the answer is yes, the safe shape is to send *aggregates without identifiers* (topic names and counts, never a name, an `AMIT_xxxx` or an email).
2. **What is it for?** A model cannot count better than the arithmetic can. What it could add is *phrasing* — turning the same findings into warmer, more personal wording. The seam supports exactly that: an engine returns the same findings with different `detail` text.

If you decide to go ahead, the mechanical part is small and is deliberately the *last* step, not the first: implement `RecommendationEngine` from [`backend/src/lib/recommendationTypes.ts`](backend/src/lib/recommendationTypes.ts), call `registerRecommendationEngine()`, add its API key to `backend/src/config/env.ts` + `.env.example` + [`ENVIRONMENT_VARIABLES.md`](ENVIRONMENT_VARIABLES.md) as usual, and set `RECOMMENDATION_ENGINE` to its id. Nothing about the route, the response shape or the page changes, and the statistical engine remains the fallback whenever the model fails.

**Milestone 14 (the notification system) is done** — see "Current Development Phase". The one outstanding item from it is **browser verification** (known bug #40), which could not be done from this session because another process held the dev port with pre-change code.

**Two operational follow-ups specific to Milestone 14, worth doing before a large cohort registers:**

1. **Give the queue a heartbeat.** Delivery has no deadline on an idle site (known bug #41). The cheapest fix inside the ₹0 constraint is a free external uptime pinger (UptimeRobot, cron-job.org) hitting a cheap endpoint every few minutes, which is enough to make the lazy sweep run. A Vercel cron needs a paid plan.
2. **Watch `/admin/email-deliveries` after the first real broadcast.** A free-tier provider's daily limit is the actual constraint here, and the console is where it will show up — as a run of rows retrying with the provider's own quota error.

**After that, the strongest remaining candidates, in order:**

1. **An official-exam Hall of Fame board and leaderboard scope**, plus **scoring-proportional XP** (known bugs #29 and #33). Both were blocked on official results existing and no longer are. The Hall of Fame's missing sixth board is already documented as deliberately absent, so it is waiting to be filled rather than needing to be justified — and Milestone 15 has now built the aggregation habits it needs.
2. **CSRF tokens.** The exposure widened in Milestone 13 — releasing results and revoking a certificate are administrative state-mutating routes, and an exam answer is a student-facing one. `SECURITY.md` already says a token should land before payments, which makes this a prerequisite of the final milestone rather than an optional extra.
3. **A frontend test suite.** 47 routes and no test at all; needs a `DECISIONS.md` entry before installing anything. This is now the largest unverified surface in the product by some distance.
4. **Per-question timing** (known bug #47), if pace-per-question is ever to be reported honestly. It needs a field on `attemptAnswer` and a change to every service that serves a paper, so it is a deliberate change rather than an addition — best done before the first national sitting, since it cannot be backfilled.

**Closed by Milestone 15:** writing `StudentAnalytics` was the previous top candidate here. It was answered by **deleting** the model instead — see the ADR.

Smaller follow-ups worth doing either way: **CSRF tokens** (note the exposure is narrower than `SECURITY.md` implies — only bodyless POSTs like `/auth/logout` are reachable cross-site, because the API parses JSON only and CORS uses a strict allow-list, so the practical risk is session nuisance rather than data modification); **"duplicate this mock test"** and **CSV export of its results** (known bugs #21 and #22 — both are the first things a real invigilator will ask for); a tighter rate limit on the admin routes; letting a student change their own email or mobile behind a confirm-at-the-new-address flow; re-encoding uploaded photos to strip EXIF; partial credit on multiple-choice questions, which needs a field on `Question` first; **scoring-proportional XP** once the official exam exists (known bug #29); and, for the daily challenge, **bulk scheduling** (a fortnight in one action, rather than a day at a time) plus a way to see which upcoming days are still unfilled across *all* classes at once — the current page answers that one class at a time.

## Recent Architectural Decisions

See [`DECISIONS.md`](DECISIONS.md). Milestone 16 added three: recommendations being derived behind a swappable engine with nothing stored, an engine unable to query or to describe itself; a finding being asserted on a **95% Wilson interval** rather than a percentage — which deliberately does **not** reverse Milestone 15's rejection of an interval, because that rejection was about the flat display floor (still there, still shared) while this is about making a recommendation, a stronger claim; and **no AI provider being integrated**, with Gemini evaluated and declined on the grounds that the task is arithmetic, the data is children's, and the MVP must run unpaid.

Milestone 15 added three: analytics being derived on read with `StudentAnalytics` deleted rather than filled in; grading reading the answer-key snapshot while analytics joins the **live** taxonomy, and why those opposite choices are both right; and a weak area needing a minimum sample, with percentages never averaged.

Milestone 14 added four: email being queued in an outbox rather than sent inline, with a visibility timeout instead of a `sending` state; the in-app inbox being the channel and email an escalation, which is what makes preferences safe (**superseding the Milestone 12 "in-app only" decision** while keeping its reasoning); security and transactional email being deliberately non-optional; and a per-student audience that staff cannot address.

Milestone 13 added two: the official exam being its own collection with `ExamAttempt` and `Result` rewritten rather than wired; and a certificate being a frozen snapshot, verified by a code that is deliberately not its serial.

Milestone 12 added three: results and certificates staying unbuilt until an official exam existed (**superseded by Milestone 13**, which built it — but the reason it existed still governs: nothing may show a figure the database cannot be asked for); a notification being one document with an audience rule rather than a fan-out; and the gallery storing image bytes in MongoDB with a stated ceiling.

Milestone 11 added two: the super administrator getting a database account (reversing the Milestone 3 decision); and an admin being *structurally* weaker than a super admin, via `SUPERADMIN_PERMISSIONS` being defined as a superset.

Milestone 10 added four: leaderboards staying derived, with scope and period as filters on one pipeline rather than materialised variants; equal XP sharing a rank, with a deterministic total order within a tie; a signed-out visitor seeing the top of the board rather than all of it; and the Hall of Fame measuring achievement rather than more XP.

Milestone 9 added four: one reward engine that every grant goes through; badges as tiered families distinct from achievements; the journey map being ordered and measured on cumulative facts; and XP amounts being administrator-tunable while the rules stay in code.

Milestone 8 added four: a day's challenge being pinned to a document rather than recomputed; the daily reward being guarded twice by two different unique indexes; the challenge revealing immediately and paying for answering rather than for correctness; and challenges reaching XP and achievements only through service seams.

Milestone 7 added eight: mock tests being a third collection rather than a variant of practice or of the official exam; the attempt deadline being computed, stored and clamped by the server; expired attempts being finalised lazily rather than by a scheduler; exactly one submission enforced by a conditional write; when a score may be seen and when the answers may be seen being two separate settings; a paper and its clock freezing once anybody has sat it; mock-test XP being 50 once per day; and `dev:local` sending no email and requiring no verification.

Milestone 6 added four ADRs: practice being its own collection rather than a reuse of `ExamAttempt`; a session snapshotting the answer key when it serves a question; practice XP being once per day so it cannot be farmed; and the marking rules (unanswered never penalised, multiple choice requiring the exact set, negative totals reported unclamped).

Milestone 5 added six: XP/levels/streaks derived from an activity log rather than stored as counters; XP earned only from events that really happen, so the sources are deliberately few; the competition day defined as an IST calendar day; self-service editing excluding the email address and mobile number; the public leaderboard publishing a first name and last initial; and a student's own edit of their account being written to the administrative audit trail.

Milestone 3 added four: three roles with the env account as `superadmin` and admins promoted from existing accounts; permission-based authorization held in one table; privileged requests re-reading the role from the database; and an audit trail that records refusals and never expires.

Milestone 2 added six: the access/refresh token split, login by mobile-or-email, verification-before-login, SMTP via nodemailer with a log fallback, admins having no refresh token, and adopting a real in-memory MongoDB for integration tests (superseding the Milestone 1 decision against it).
