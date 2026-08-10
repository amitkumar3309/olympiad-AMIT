# CHANGELOG.md

Chronological development history. For current state, see [`PROJECT_STATE.md`](PROJECT_STATE.md) instead — do not let this file's older entries get treated as current fact.

## 2026-08-11 — No placeholder data anywhere, and a real light/dark theme

Two owner requests: eliminate **all** remaining fake data, strictly; and make the app one consistent theme, light by default, with a user toggle.

### Every remaining piece of fabricated data is gone

A page-by-page audit found five more, plus one regression from the previous change.

- **The result portal was inventing results.** `Result.tsx` hashed whatever string was typed into its search box and derived a score, a national rank and a percentile from it — client-side, with no server call. Any visitor could enter any ID, including one that did not exist, and be shown an authoritative "72/100 · National Rank #146 · 91.4th percentile" for a competition that has not been held. This was the worst fabrication in the product and it was publicly reachable. Replaced by a real `GET /results/:studentId`.
- **The certificate page issued awards nobody earned.** It printed "For outstanding participation and achievement" for anyone signed in — or "Future Champion / AMIT_XXXX" for a guest — stamped with today's date and the student's own ID as the certificate number. A student could print it the minute they registered. Now driven by `GET /certificates/:studentId`, which requires a **published result**.
- **`GET /certificates/:studentId` itself was a static two-item mock** returned for any id. Now a real query.
- **The exam was five hardcoded questions that shipped their own answer key.** Each carried a `correct` field, so the answers for the whole paper were readable in the JavaScript bundle — a smaller version of the hole Milestone 4 closed on the questions API. It now loads **real published questions** for the student's class through the answer-stripped `/questions`, and therefore cannot mark anything and does not pretend to: no score screen, because a score would have to be invented.
- **The admin dashboard's "Weekly Accuracy Trend"** was `[72, 78, 75, 82, 88, 90, 92]` against Mon–Sun. It was labelled as sample data, but a labelled invention is still an invention, and an accuracy trend cannot exist while no answer has ever been scored. Replaced with two real series from a new `GET /admin/stats`: registrations per day and active students per day.
- **Regression fixed**: removing the fabricated analytics in the previous change left `Report.tsx` reading fields off a now-null object, so the page spun forever. It now handles the real response, reports the progress that is genuinely recorded, and states which sections need exam results.

Every one of these is a **live query against the real collection** rather than a hardcoded empty, so each starts working by itself when exam submission lands. New `services/resultService.ts` holds the lookups.

The result portal is public, and deliberately answers **identically** for "no such account" and "no published result", so it cannot be used to enumerate which student IDs exist. Only `isPublished` results are ever visible, so marks cannot be read before release.

### Light and dark theme, light by default

The app was previously half-and-half: public pages light, while the dashboard, admin area and exam each hardcoded `theme-dark` on their own shell. Signing in changed the colour scheme underneath you, and the admin sign-in form was dark while the navbar above it was light.

- New `ThemeContext` applies the theme **once, to `document.documentElement`**, so every page inherits it and no page can disagree with another or forget to opt in.
- **Light is the default**, by the owner's decision — deliberately not `prefers-color-scheme`, so the baseline is predictable.
- The choice persists in `localStorage` and survives reloads. Storage access is wrapped, since it throws outright with site data blocked.
- New `ThemeToggle` in all three shells: the public navbar, the dashboard sidebar and the admin sidebar.
- The three hardcoded `theme-dark` shells are removed.
- The themed background is now painted on `html`, `body` **and** `#root`. Relying on body's background propagating to the canvas is the fragile part — it only holds while `html` has no background of its own — and painting the app root means pages without a full-height wrapper cannot end up with dark cards on a light canvas.
- Verified that every hardcoded `#fff` in the previously dark-only stylesheets sits on a saturated background (blue, green, purple, or a dark overlay), so all of them remain correct in light mode.

**One verification caveat.** The theme is confirmed correct on page load in both modes, on every page. Live *switching* could not be visually confirmed in the preview browser: that engine does not invalidate `var()` substitutions when a custom property changes at runtime — a freshly created element picks the new value up correctly while existing ones keep the old one, and even an inline custom-property write on the root fails to update them. No shipping browser behaves that way (every dark-mode implementation on the web depends on it), and real Chrome was not reachable to compare, so the standards-correct implementation was kept rather than working around a preview-pane artifact. Worth a single click to confirm in a real browser.

### Testing

11 new tests (**322** total): the result portal's empty state, its non-enumeration property, a real published result read back, an unpublished result staying invisible, contact details never appearing beside a result, certificates before and after publication, and the admin stats series including that the old fabricated accuracy figures cannot appear.

---

## 2026-08-10 — Milestone 5 follow-up: three gaps closed

A gap audit against the Milestone 5 brief found three things the first pass missed. All are now done.

**The analytics endpoint was fabricating a student's performance.** `GET /analytics/:studentId` fell back to a hardcoded object whenever no `StudentAnalytics` document existed — which is *every* student, since nothing writes one. It claimed **88% accuracy over 450 questions**, a rising five-point learning curve, four topic breakdowns, and "You are currently in the top 5% of all national Olympiad participants" — presented as the student's own measured performance, on a page linked straight from the dashboard. This was the same class of defect Milestone 5 existed to remove, missed because the page sits outside the dashboard route.
- The fallback is deleted. `data` is now the real document or **null** with `reason: 'no-exam-data'`.
- Added a genuinely real series in its place: `xpByDay`, actual XP earned per competition day over the last 30 days, aggregated from the activity log. Days with no activity are **omitted** rather than zero-filled, because a flat line at zero would imply a measured zero.
- The Analytics page now separates what is measured (XP earned, active days, best day, and a real per-day chart) from what is not (accuracy, speed, topic strengths), with an explicit empty state for the latter that says why and what will fill it.
- The endpoint also now 404s for a non-existent student ID instead of returning data for nobody.

**`GET /me/daily-challenge` had no caller**, so "upcoming/available challenges" was only half delivered — the dashboard showed practice *availability* but nothing served the actual challenge. Added a dashboard card rendering today's real question through `MathText`, with subject › topic › subtopic, difficulty and marks. Code-split into its own chunk so KaTeX (~260 KB) stays out of the main bundle, as with the admin question pages. It is deliberately **read-only**: answering needs somewhere to submit and something to score against, and checking answers client-side would mean shipping the answer key — the exact hole Milestone 4 closed. The card says so plainly.

**`GET /me/activity` had no caller**, so the feed was capped at the newest 8 with no way to see more. Added a "Show earlier activity" control that pages the real endpoint, appends rather than merges (so a reload cannot duplicate rows), and finishes with "That's your whole history — N events."

**Testing** — 5 new tests (**311** total), including one that asserts none of the six deleted fabricated strings can appear in an analytics response, and one that checks `xpByDay` sums to exactly the XP the dashboard reports.

**Also corrected** — the guidance for neutralising email locally. `SMTP_HOST=` (empty) does not work: the zod schema correctly rejects an empty string. Use `REQUIRE_EMAIL_VERIFICATION=false` instead.

---

## 2026-08-10 — Milestone 5: Student Profile and Dashboard

Students can now see and change their own account, and the dashboard shows real progress instead of decoration. The governing constraint was **no fake statistics**: every figure on every page this milestone touched is derived from a database read, and where a student has no data the panel says so and explains why.

**Self-service profile** — closes the gap recorded since Milestone 4 as "no one can edit their own details after registering", which until now needed a direct database edit.
- New `/profile` page: view and edit the nine descriptive registration fields, with `fullName` re-derived server-side.
- **Photo replacement** (`PUT /me/photo`), fixing known bug #9 ("a photo cannot be replaced or removed"). Same 2 MB / magic-byte validation as registration; upserts, so a legacy account without a photo also works. No delete — the photo is a required part of an entrant's record.
- **Change password** from account settings, requiring the current password so a borrowed session cannot lock the owner out. Revokes every other session and re-issues one for the current device, so the student is not signed out of the page they are standing on.
- `email` and `mobile` are deliberately **not** editable — they are the login identifiers and `email` anchors password reset, so changing one needs a confirm-at-the-new-address flow. They are absent from the zod schema rather than filtered in the handler, so extra keys in a request cannot reach the update.

**Progress, derived not stored** — new `StudentActivity` collection, the single source of truth for XP, levels, streaks and achievements. There is no counter document: XP is a `$sum` over real events, the level is a pure function of it, the streak is computed from the distinct days present. A counter that drifts from the events behind it is exactly how "no fake statistics" gets broken.
- XP comes only from events that really happen: account created (50), email verified (50), daily visit (10, once per competition day). Profile, photo and password changes appear on the feed but are worth **0** — they are repeatable at will, and paying for them would make XP a measure of pressing Save. No exam XP, because no exam attempt is recorded anywhere yet.
- A day is an **IST** calendar day, not a UTC one (`lib/competitionDay.ts`). UTC would file a 00:30 IST visit under the previous day and break a streak the student had in fact kept.
- "Once per day" and "once per account" are enforced by a **partial unique index**, not by a check, so two concurrent requests cannot both earn the same visit.
- Achievements are evaluated from real facts on every read, with real progress toward the locked ones. No exam or accuracy achievement is listed: a permanently unearnable row with a bar that can never move is a fake statistic wearing a lock icon.

**Dashboard rewritten** — the three hardcoded stat tiles ("1,280 challenges solved today", "8.91s fastest solve", "450+ participating schools") and the three-name invented leaderboard are gone. Now: XP and level with progress to the next, streak (current and best), leaderboard rank, achievements earned, a real activity feed, available practice derived from the published question bank for the student's own class, and recent test performance.
- **Recent test performance** is a live query against `ExamAttempt`, which nothing writes to yet — so it is honestly empty and the panel says scored exams are not running yet. Written as a real query rather than a hardcoded `[]` so it starts working the moment exam submission lands.

**Two mock endpoints became real.** `GET /leaderboard` now aggregates actual XP, and `GET /daily-challenge` returns a deterministic published question for the caller's class (now authenticated, where the mock was open, because it returns question content). New `GET /public/stats` gives the landing page real counts. The landing page's invented "Today's Champions" and four headline figures are replaced by both — the project owner's explicit choice.
- The public leaderboard publishes a **first name and last initial** ("Ishaan V."), not a full name: the entrants are children in classes 5–12 and the page is public and indexable. `limit` is capped at 50 so it returns a leaderboard rather than an enumerable roll; suspended accounts are excluded before the limit; a student with no XP is genuinely unranked rather than listed last.

**Audit trail** — three actions added (`student.profile.updated`, `student.photo.updated`, `student.password.changed`), because a change to an account belongs in the trail whoever made it, including its own owner. Metadata names the changed **field names, never their values**: the trail is readable by any admin, and a student's home address should not be copied into it.

**Refactors** — session cookie handling moved out of `auth.routes.ts` into `lib/session.ts`, since the password change also has to issue a session; the answer-stripped `studentQuestionView` moved into `services/questionView.ts`, so the daily challenge reuses it instead of a second hand-written stripper (still deliberately separate from the author view). New `accountUpdateLimiter` (20/hour) on the password and photo routes.

**Fixed along the way** — `optionalName` accepted `''` and `undefined` but not `null`, so "remove my middle name" was a 400 on a JSON PATCH. It now accepts all three.

**Migration** — `backend/scripts/backfill-activity.ts` gives pre-Milestone-5 accounts the enrolment rows they have already earned, dated from their real `registeredAt`. Idempotent, and deliberately does **not** invent `daily_visit` rows, so nobody is handed a streak they did not keep. Report-only by default; `--write` applies.

**Testing** — 82 new tests across `tests/profile.test.ts` (27) and `tests/dashboard.test.ts` (55), taking the suite from 224 to **306**. They pin the exact XP a new account holds (an explainable 110, not "some number"), cover the IST day boundary and leap years, the streak rules including a run kept alive by yesterday's visit, the level thresholds and their edges, the leaderboard's ranking, masking and exclusions, that a student cannot change their own role or status, that the audit entry omits the address value, and that the specific invented figures this milestone deleted no longer appear in any response.

## 2026-08-05 — Milestone 4: Complete Question Bank System

The question bank became a real, authored system: a subject/topic/subtopic taxonomy, four question types with per-type answer shapes, marks and negative marks, an editorial workflow, tags, search/filter/sort/pagination, and an admin UI with a live maths preview. **No exam, results, certificate or leaderboard behaviour changed** — those surfaces are still mock; this milestone builds what they will eventually read from.

**Security fix — the answer key was public.** `GET /api/v1/questions` had **no authentication middleware at all** and returned raw documents including `correctAnswer`, so anyone on the internet could fetch the answer key for the whole bank. It is now gated on `questions:read`, and the student response is an explicit allow-list that omits `isCorrect`, `solution`, `booleanAnswer`, `numericAnswer` and `tolerance` by construction. The author view is a separate function behind `questions:write`, deliberately not one function with an `includeAnswers` flag. See [`SECURITY.md`](SECURITY.md).

**Taxonomy**
- New `Subject` collection: name (unique case-insensitively), derived slug, description, status, display order.
- New `Topic` collection holding **both topics and subtopics**, distinguished by a nullable `parent` and a derived `depth` capped at 1. Uniqueness is scoped to the parent, so "Fractions" may exist under two subjects and as a subtopic of each.
- Archiving is refused while published questions still reference the entry, and says how many.

**Questions** — `Question` was rewritten:
- Four types: `single_choice`, `multiple_choice`, `true_false`, `numeric` (with optional tolerance). Each uses exactly one answer representation and the validator **rejects the fields belonging to the other types**.
- Options are now subdocuments with a server-assigned stable `key` and an `isCorrect` flag, replacing `correctAnswer`-as-literal-text — which meant fixing a typo in an option silently invalidated every recorded answer.
- `marks` (0.25–100) and `negativeMarks` (a magnitude to deduct, 0 disables it, cannot exceed `marks`).
- Status workflow `draft → in_review → published`, plus `archived`. Everything is created as a draft; publishing additionally requires a solution and a resolvable answer key.
- Tags (lowercased, de-duplicated), `revision` bumped on every edit, and created/updated actor labels.

**Mathematics** — content is plain text with LaTeX islands (`$…$`, `$$…$$`), rendered by KaTeX. Prose is rendered as React text nodes and only KaTeX's own output is inserted as HTML, so author text never reaches an HTML sink. The backend independently rejects link, file-inclusion and macro-definition commands, unbalanced delimiters, markup and control characters. KaTeX is lazy-loaded so the main bundle stays at ~476 KB.

**APIs** (all under `/api/v1`)
- New: `GET /subjects`, `GET /topics`, `POST /admin/subjects`, `PATCH /admin/subjects/:id`, `POST /admin/topics`, `PATCH /admin/topics/:id`.
- New: `GET /admin/questions`, `GET /admin/questions/:id`, `POST /admin/questions`, `PUT /admin/questions/:id`, `PATCH /admin/questions/:id/status`, `DELETE /admin/questions/:id`.
- Changed: `GET /questions` and `GET /questions/:id` are authenticated, published-only and answer-stripped; a draft asked for by id returns **404, not 403**.
- Changed: `POST /admin/generate-questions` now requires real subject and topic ids and writes **drafts only**, so template placeholder text can never reach a student.
- Listing supports `page`/`limit`, an **allow-listed** `sort` (so a caller cannot make the database sort by an unindexed field), `order`, literal regex-escaped `search` across text/tags/solutions, and filters on status, subject, topic, subtopic, class, difficulty, type and tag. `_id` is a sort tiebreaker so pagination is stable.

**Permissions** — two added: `questions:delete` (separate because it is the one question-bank action that destroys data) and `taxonomy:write`. Six new audit actions.

**Admin frontend** — three new pages: `/admin/questions` (list with search/filter/sort/pagination and loading/error/empty states), `/admin/questions/new` and `/:id/edit` (form with a live side-by-side maths preview), `/admin/taxonomy` (nested subject → topic → subtopic tree). The "AI Question Generator" page now says plainly that it is a template filler, not AI.

**Breaking change** — the `Question` rewrite cannot read pre-Milestone-4 documents (`subject` went from `String` to `ObjectId`, which is a **cast error on read**, not a missing field). Every such document came from the old template generator and nothing references questions yet, so `backend/scripts/migrate-questions.ts` reports them and removes them with `--delete`. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

**Testing** — 77 new tests (`tests/questionBank.test.ts`), taking the suite from 147 to **224**. They cover the whole CRUD flow end to end, per-type answer rules, the maths grammar including macro-expansion and markup attacks, the editorial workflow and its illegal transitions, search/filter/sort/pagination, and the answer-key protection from a real student session. Test files now run **sequentially** (`fileParallelism: false`): five suites start their own `mongod`, and in parallel they contended badly enough to fail with unrelated duplicate-key errors. `clearTestDb()` now throws instead of silently no-oping when there is no connection, which is what made that diagnosable.

## 2026-08-05 — Full registration details are collected and persisted

Registration previously asked for four things (full name, mobile, email, password). It now collects the complete entrant record the owner specified, and every field is written to MongoDB as part of the same request. **No exam, results, certificate or leaderboard behaviour changed.**

**New registration fields** — all required except the middle name:
- First / middle / last name as three separate inputs. `fullName` is now **derived** from them by the schema, so every existing reader of `fullName` (admin list, its search, the session envelope, the certificate) is unchanged.
- Father's name, mother's name, date of birth, class, current school name, full address.
- A mandatory photo, up to 2 MB, as JPEG / PNG / WebP.

**Class** is a fixed list of ten values: `Class 5` … `Class 11`, then `Class 12 - Science`, `Class 12 - Commerce` and `Class 12 - Humanities`. Held in `backend/src/lib/classLevels.ts` and mirrored by name only in `frontend/src/api/types.ts`.

**Database changes**
- `Student` gained `firstName`, `middleName`, `lastName`, `fatherName`, `motherName`, `dateOfBirth`, `classLevel`, `schoolName` and `address`. They are required **on creation only** (`required: () => this.isNew`), so an administrative `save()` on an account that predates this change — suspending it, changing its role — does not fail validation on data the admin never touched.
- New **`StudentPhoto`** collection: one document per account (`student` is unique), holding `contentType`, `size` and the image `data` as a `Buffer`. Deliberately *not* a field on `Student`, so no student query drags a 2 MB binary along with it.

**API changes**
- Changed: `POST /auth/register` now requires the fields above plus `photo` (a base64 data URL). The registration and session payloads return the new details.
- New: `GET /students/:studentId/photo` — serves the raw image. A student may read their own; `students:read` is required for anyone else's, checked **fresh** against the database.
- `GET /admin/students` and `GET /admin/students/:studentId` include the new fields, `null` on pre-existing accounts.
- Only the registration route accepts a large body (2.8 MB); every other endpoint keeps body-parser's 100 KB default.

**Validation**
- The photo's declared MIME type is checked against the file's actual **magic bytes**, so `data:image/png;base64,<anything>` is refused rather than stored and later served back as an image.
- Names accept any script (`\p{L}` plus `\p{M}`, so Devanagari vowel signs work — `अमित` was rejected by a letters-only rule).
- Date of birth must be a real past date implying an age of 5–40.

**Frontend**
- The registration form is regrouped into *Student details* / *Photo* / *Contact & sign-in*, every required field carries a red `*`, and the grid goes to two columns where there is room.
- The chosen photo is previewed with its filename and size; oversized or wrong-type files are refused before submission with a specific message, as is each missing required field by name.
- The admin user table gained photo, class and school columns. Accounts with no photo fall back to an initial.

**Testing** — 40 new tests (`tests/registration.details.test.ts`), taking the suite from 106 to **147** (one more from tightening the older validation suite, whose `fullName` cases no longer described a real field). They read back from the database rather than trusting the response, and cover every required field, each of the ten classes, the photo's size/type/magic-byte rules, the authorization on photo reads (own / another student's / admin / anonymous / the `/api` alias), and that a pre-Milestone-4 account can still be administered.

## 2026-08-05 — Navbar: expose the Admin link to guests

The navbar's **Admin** link previously rendered only for someone already holding `students:read`, so a logged-out visitor had no way to reach the admin sign-in form except by typing `/admin` by hand. It now also renders for guests. It stays hidden for a signed-in plain student, who would only reach the `Unauthorized` screen by following it. No authorization behaviour changed — the link is navigation only, and every admin route is still gated server-side.

## 2026-08-05 — Milestone 3: RBAC and User Management Foundation

Authorization moved from scattered role checks to a single permission table, admin accounts became real and manageable, and administrative actions are now audited. **No exam, results, certificate or leaderboard behaviour changed.**

**Roles**
- Three roles: `student`, `admin`, `superadmin`. The env-configured account (`ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH`) now holds **`superadmin`** and is the bootstrap root, still with no database document.
- A super admin grants or revokes `admin` on any existing verified account. Promoted admins are ordinary accounts with `role: 'admin'`, so they inherit login-by-mobile-or-email, lockout, refresh-token rotation, email verification and password reset — and keep their student capabilities.
- `superadmin` is **not assignable through any API**: there is deliberately no path to a second root administrator.

**Authorization**
- New `backend/src/lib/permissions.ts` — nine named permissions and the only role → permission mapping in the codebase. Comparing `req.user.role` to a literal is now forbidden outside that file.
- `middleware/auth.ts` rewritten: `requirePermission(...)` is the gate routes should use, with `requireAuth(...)` kept for the rare identity-only gate. Adds `callerCan` / `callerCanFresh` for decisions that depend on the data being addressed.
- **Privileged requests re-read `role`, `status` and `tokenVersion` from MongoDB** rather than trusting the access token, so a demotion or suspension takes effect immediately instead of surviving up to 15 minutes. Student-level requests stay stateless.
- `verifyAccessToken()` now rejects any token whose `role` is not a recognised role.
- Role changes and suspensions revoke every refresh token and bump `tokenVersion`.
- `GET /analytics/:studentId` lost its inline `role !== 'admin'` check in favour of `analytics:read:self` plus a database-fresh `analytics:read:any`.

**Database changes**
- `Student` gained `role` (`student`|`admin`, indexed, default `student`), `roleUpdatedAt` and `roleUpdatedBy`.
- New `AuditLog` collection: action, actor (role + id + denormalised label), target, outcome, metadata, ip, user agent. Indexed newest-first plus by action and by actor. **No TTL** — unlike the token collections, this must not expire.

**API changes** (all under `/api/v1`)
- New: `GET /admin/students`, `GET /admin/students/:studentId`, `PATCH /admin/students/:studentId/status`, `PATCH /admin/users/:studentId/role`, `GET /admin/audit-logs`.
- Changed: `POST /auth/login`, `POST /auth/refresh` and `GET /auth/me` now return `role` and the caller's effective `permissions` array.
- Changed: `POST /auth/admin/login` returns `role: 'superadmin'` and issues a token marked `root`.
- Changed: `POST /auth/logout-all` is now `requireAuth()` rather than `requireAuth('student')`, which would have locked promoted admins out of their own session management.
- Changed: `POST /admin/generate-questions` is gated on `questions:write` and writes an audit entry.

**Security**
- `users:role:write` belongs to `superadmin` alone, so a compromised admin session cannot mint more admins.
- An ordinary admin cannot change the status of an account that holds a role; nobody can change their own role or status; an unverified or inactive account cannot be promoted.
- The admin listing's free-text search is regex-escaped, so `.*` matches literally instead of matching every account. `:studentId` params are constrained to `AMIT_` plus four digits.
- Refused privileged requests are recorded as `authz.denied` with the missing permission — a run of them is the signature of an escalation attempt.

**Frontend**
- `AuthContext` now carries `role` and `permissions` from the server and exposes `can(permission)`. `status` distinguishes only *which kind of account* is signed in, never what it may do.
- `AdminRoute` replaced by `RequirePermission`, which shows a real **unauthorized state** to a signed-in user instead of silently redirecting.
- New `Unauthorized` component; permission-filtered navigation in `Navbar` and in a new shared `AdminShell`.
- New pages: `/admin/users` (real paginated listing, search, status and role filters, suspend/reactivate, grant/revoke admin for a super admin) and `/admin/audit-log` (filter by action and outcome).
- `Admin.tsx`'s four hardcoded student rows and invented "15,000+ students" tiles are **gone**, replaced by real counts. The weekly-accuracy chart remains sample data and is now labelled as such.
- `api/client.ts` gained `patch`.

**Testing**
- New `backend/tests/rbac.test.ts` — **62 tests**, taking the suite from 44 to **106**. Covers: every admin route refused to a student (403) and to a guest (401), including through the unversioned `/api` alias; forged, role-tampered, unknown-role and role-less tokens; `role` submitted at registration being ignored; a demoted admin's still-valid token; suspended and deleted accounts; an admin trying to promote anyone or suspend a peer; cross-account analytics reads; and every audit entry, including refusals.
- `tests/setup.ts` provisions root-admin credentials in-process so the real admin-login path is exercised without committing a password hash.

**Verified**
- `npm test` (105 passed), `npm run typecheck`, `npm run lint`, `npm run compile` in `backend/`; `tsc -b && vite build` and `oxlint` in `frontend/`.
- Driven end-to-end in a browser against a real MongoDB: root admin sign-in, promotion, suspension, the audit trail, the promoted admin's reduced UI, and a student's unauthorized states. Escalation attempts were then made **directly against the API**, bypassing the UI entirely, plus cookie/`localStorage`/header tampering — all refused with 403 and no data leaked.

---

## 2026-08-04 — Milestone 2: Complete Authentication System

Authentication is now real end-to-end: registration, email verification, login, token refresh, logout, password reset, revocation, account status and lockout. **No mock authentication and no fake logged-in users remain anywhere.**

**Database changes**
- `Student` extended: added `email` (required, unique, lowercased), `isEmailVerified`, `status` (`active`/`suspended`/`deactivated`), `tokenVersion`, `failedLoginAttempts`, `lockedUntil`, `lastLoginAt`. `studentId` is now **unique**, and `passwordHash` is `select: false` so it cannot leak through a route that forgets to exclude it.
- New `RefreshToken` collection: SHA-256 hash only, per-login `familyId`, rotation bookkeeping (`revokedAt`, `replacedByHash`), TTL index.
- New `VerificationToken` collection: SHA-256 hash only, `type` (`email_verify` | `password_reset`), single-use `usedAt`, TTL index.
- **Breaking for existing data**: `email` is required and unique, so `Student` documents created before this milestone will fail validation on their next save. No migration script — see `TROUBLESHOOTING.md`.

**API changes** (all under `/api/v1`)
- New: `POST /auth/verify-email`, `POST /auth/resend-verification`, `POST /auth/refresh`, `POST /auth/logout-all`, `POST /auth/forgot-password`, `POST /auth/reset-password`.
- Changed: `POST /auth/register` now requires `email`, enforces a stronger password policy, returns `201`, and **no longer issues a session** — the student must verify first.
- Changed: `POST /auth/login` now takes `identifier` (mobile **or** email) instead of `mobile`, and can return `403` with `code: 'EMAIL_NOT_VERIFIED'` or `423` when locked out.
- Changed: `POST /auth/logout` revokes the presented refresh token server-side rather than only clearing a cookie.
- Changed: the auth cookie `token` is replaced by `access_token` (15 min) plus `refresh_token` (30 days). **Any session issued before this deploy is invalidated.**

**Security changes**
- Access/refresh token split with rotation and theft detection: replaying a rotated refresh token revokes the entire token family.
- Both refresh and email tokens are stored as SHA-256 hashes only; raw values never reach the database.
- Email tokens are single-use, consumed atomically via `findOneAndUpdate` on `usedAt: null` so concurrent redemptions cannot both succeed.
- bcrypt cost raised from 10 to 12.
- Password reset revokes every session and bumps `tokenVersion`.
- Account lockout after 5 failed logins for 15 minutes.
- Per-endpoint rate limits replacing the single shared auth limiter (tightest on the email-sending routes, which consume a third-party quota).
- No account enumeration on login, `forgot-password`, or `resend-verification` — asserted by a test comparing known/unknown responses.
- `studentId` collision bug fixed (unique index plus retry-on-duplicate).

**Email**
- New `lib/email.ts` using `nodemailer` over plain SMTP, so any free-tier provider works via env vars alone. Falls back to writing emails (with working links) to the structured log when SMTP is unset, and captures them in memory under test.
- **Owner action still required**: SMTP is not configured, so production would only log emails. See `ENVIRONMENT_VARIABLES.md`.

**Frontend**
- `api/client.ts` transparently refreshes an expired access token once and replays the request, de-duplicating concurrent refreshes through one shared promise (necessary, or the backend's reuse detection would correctly kill the session).
- `AuthContext` gained verify / resend / forgot / reset / logout-everywhere, and now restores sessions across a browser reload by falling back to one refresh attempt.
- New pages: `/verify-email`, `/forgot-password`, `/reset-password`.
- Registration form gained an email field and a stronger password rule; the post-registration step now says "check your email".
- **Removed the fake OTP step** that accepted the hardcoded string `123456`.

**Breaking changes**
- All existing sessions are invalidated (cookie names changed).
- `POST /auth/login` request shape changed (`mobile` → `identifier`).
- `POST /auth/register` requires `email` and no longer logs the user in.
- Pre-existing `Student` documents need an `email` before they can be saved or logged into.

**Verification**
- Backend: `typecheck`, `lint`, `test` (**44/44**, up from 12) and `build` all pass; tests still pass after a build.
- Frontend: `lint` passes (one pre-existing warning) and `build` succeeds.
- **32 auth integration tests run against a real MongoDB** (`mongodb-memory-server`), covering both required journeys plus invalid and expired tokens, rotation reuse, revocation, account status and lockout.
- Additionally verified by hand against a real database and a real browser: registered, was correctly blocked from logging in unverified, verified via the real emailed link, logged in with the mobile number, hit a protected route, refreshed (confirming rotation), replayed the old token (confirming family revocation), then reset the password through the UI and confirmed the old password and pre-reset sessions were dead.
- Atlas connectivity itself remains unverified from this sandbox (network-restricted); a local MongoDB was used instead.

---

## 2026-08-04 — Milestone 1: Backend & Database Foundation

Foundation work only — **no new product features, no new business endpoints**. All pre-existing route behaviour and response shapes were preserved.

**Structure**
- Split the single ~450-line `backend/src/server.ts` into a modular app: `config/`, `db/`, `lib/`, `middleware/`, `models/`, `routes/v1/`, `validation/`.
- `src/app.ts` now assembles the Express app (imported by both the local server and the Vercel entry); `src/server.ts` is reduced to process bootstrap plus graceful shutdown.
- `backend/api/index.ts` now imports from `src/app.ts` instead of `src/server.ts`.
- The 5 Mongoose models moved to one file each under `src/models/`, each with an exported TypeScript document interface. **No schema changes.**

**New capabilities**
- Environment validation via zod (`config/env.ts`) with a typed app config (`config/index.ts`); no other module reads `process.env`.
- MongoDB connection module with cached, de-duplicated connects and an explicit `serverSelectionTimeoutMS` (8s; 300ms under test) instead of Mongoose's 30s default.
- Structured logging (pino) and request logging (pino-http).
- Global error handler + 404 handler emitting the standard `{success:false, error}` envelope, hiding internals in production.
- Request validation architecture (`middleware/validate.ts`) with zod schemas per route.
- `GET /health` (liveness, no DB) and `GET /ready` (503 when Mongo is disconnected), both mounted before the rate limiter so probes are never throttled.
- Graceful shutdown on SIGTERM/SIGINT with a 10s forced-exit fallback.
- Backend test suite: vitest + supertest, 12 tests, no database required.
- ESLint + typescript-eslint for the backend; `build`, `typecheck`, `lint`, `test`, `test:watch` scripts.
- `backend/.env.example` with placeholder values.

**API changes**
- All routes are now served at **`/api/v1/*`** (canonical). The unversioned **`/api/*`** is retained as a compatibility alias mounting the same router, so existing clients keep working. A test asserts both return the same status.
- The frontend was migrated to the versioned API through a single `API_BASE = '/api/v1'` constant in `frontend/src/api/client.ts`; callers now pass version-agnostic paths (`/auth/login`). No deploy config changed, because both the Vite dev proxy and the Vercel `/api/(.*)` rewrite pass the remaining path through unchanged.

**Security changes**
- `JWT_SECRET` is now **mandatory in production** — startup throws instead of falling back to a hardcoded default (previously it only warned).
- CORS no longer falls back to reflecting any origin; it always uses an explicit allow-list and warns if `FRONTEND_URL` is unset in production.
- Added `helmet` and disabled `x-powered-by`.
- Added rate limiting: a general limiter on `/api` and a stricter limiter on the three auth routes.
- `GET /questions` query params are now schema-validated before any Mongoose filter is built.
- Corrected a factual error in `SECURITY.md`: the documented `qs` bracket-notation NoSQL-injection vector does not apply, because Express 5 defaults to the `'simple'` query parser. Verified empirically against Express 5.2.1.
- Per owner instruction, security behaviour is **implemented but deliberately not automatically tested** at this milestone (see `TESTING.md`).

**Bug fixes found by actually running the app**
- Restored `.env` loading. The refactor had dropped `dotenv.config()`, so locally the backend silently ignored `backend/.env` — falling back to `localhost:27017` and port 8080 instead of the configured Atlas URI and port 8081.
- Fixed the request-validation middleware crashing on success. `req.query` is a getter-only accessor in Express 5, so assigning the parsed value threw `Cannot set property query of #<IncomingMessage>`, returning 500 for otherwise-valid requests. Now uses `Object.defineProperty`.
- Added `middleware/ensureDb.ts`. The refactor had left the serverless path with **no database connection at all** (`api/index.ts` imports `app.ts`, which never called `connectDB()`), so production would have failed on every data route. DB-backed routes now connect lazily per request and return a clean 503 when the database is unreachable.
- Local boot no longer exits when MongoDB is unreachable; the server starts and `/ready` reports the true state, so a transient database problem doesn't require a manual restart.
- Fixed `npm run build` and `npm test` being mutually exclusive: `tsc` was compiling `tests/` into `dist/`, after which vitest tried to run the emitted CommonJS copies and crashed.

**Database changes**
- None. No schema, field, index, or collection changed.

**Breaking changes**
- None for API consumers (the unversioned alias preserves compatibility). One **deployment-ordering requirement**: deploy the backend before the frontend, since the frontend now calls `/api/v1/*`.

**Verification**
- Backend: `typecheck`, `lint`, `test` (12/12), and `build` all pass; `build` followed by `test` also passes.
- Frontend: `lint` passes (one pre-existing fast-refresh warning) and `build` succeeds.
- Both servers were run together: `/health` returned 200, `/ready` correctly returned 503 with the database unreachable, validation returned 400, unknown routes 404, protected routes 401, the versioned and aliased paths matched, and the SPA loaded in a browser with no console errors, reaching the backend through the Vite proxy.
- **Live MongoDB Atlas connectivity remains unverified** — blocked by sandbox network restrictions, not by credentials. See `TROUBLESHOOTING.md`.

---

## 2026-08-04 — Phase 0 repository audit (no code changes)

- Performed a full read-through of the existing repository: `frontend/` (React 19 + Vite SPA, 9 pages) and `backend/` (single-file Express + Mongoose API).
- Created the full project documentation set: `CLAUDE.md`, `PROJECT_STATE.md`, `SYSTEM_ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`, `FEATURE_STATUS.md`, `SECURITY.md`, `ENVIRONMENT_VARIABLES.md`, `DEPLOYMENT_GUIDE.md`, `TESTING.md`, `CHANGELOG.md`, `DECISIONS.md`, `TROUBLESHOOTING.md`.
- No source code was modified. No database changes. No API changes. No security changes (issues found are documented in `SECURITY.md`, not yet fixed).
- Key findings recorded: real auth (register/login/admin login) is genuinely wired to MongoDB; most "feature" pages (exam, results, certificates, leaderboard, daily challenge, admin student list, analytics for real students) are either hardcoded mock UI or backend endpoints the frontend never calls. Full detail in `FEATURE_STATUS.md`.

---

## Prior history (reconstructed from `git log`, pre-dates this documentation set)

- **`9dbdf27`** — Rebuilt the frontend in React (from an earlier non-React form), added real bcrypt+JWT authentication, and split the project into two independently deployed services (frontend/backend). This is the current architecture baseline.
- **`e19adb6`** — Pinned TypeScript to `5.9.3` in the backend to fix a Vercel build failure caused by a newer/incompatible TypeScript version.
- **`6df3e60`** — Merged a branch restructuring the project for a working Vercel deployment.
- **`1938876`** — Restructured the project layout to get Vercel deployment working.
- **`9bba7cf`** — Fixed Vercel configuration (earlier attempt).
- **`c32c717`** — Fixed Vercel deployment (earlier attempt).
- **`0fdd1b5`** — "all code" — initial/bulk commit of the original (pre-React-rebuild) codebase.

Note: commits prior to `9dbdf27` describe a different, earlier architecture (pre-dating the React rebuild and service split) that no longer reflects the current codebase — treat only `9dbdf27` onward as describing the current system.
