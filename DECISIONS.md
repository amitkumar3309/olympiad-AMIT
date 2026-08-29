# DECISIONS.md

Lightweight Architecture Decision Records. Add a new entry (don't edit old ones except to add a "Superseded by" note) whenever a significant technology/architecture choice is made, so future sessions don't silently reverse it.

---

## 2026-08-29 — An optimistic answer is rolled back when the server refuses it

**Context.** Both answer runners save optimistically: local state updates on the click, the `PUT`
follows. That is the right shape — on a timed paper the UI must not lag a click behind, and the
server's response carries the authoritative remaining time.

What it did on failure was show the error *and keep the optimistic answer*. The Phase H regression
run tripped the rate limiter mid-paper and got the full consequence: the header read **"3
answered"**, the palette showed three filled keys, the submission dialog said **"All 3 questions are
answered"**, and the marked paper came back **0/12 with every question NOT ANSWERED**.

**Decision.** On a failed save, restore the previous response and say so: *"That answer was not
saved — try again."* `answeredCount` then means what the server holds, which is the only thing it
can usefully mean — it is the number a student reads when deciding whether they are finished.

**Rejected: keeping the answer and marking it "unsaved".** A third state (answered / unanswered /
answered-but-not-saved) has to be understood under time pressure by a child, and every surface that
counts answers would need to decide which bucket it belongs in. The palette, the header, the
dialog and the progress bar would each be a place to get it wrong.

**Rejected: retrying silently.** A retry that succeeds is invisible and fine; a retry that fails
leaves the same lie in place for longer, and on a paper with a deadline the student needs to know
*now* that something did not save.

**Consequence.** The 409 path is unchanged — that means time ran out, and it reloads to show the
marked paper rather than rolling anything back. The rule generalises: any optimistic write in this
product must roll back, and the practice runner was fixed at the same time even though the failure
was only reproduced on the mock test, because the two share the shape.

## 2026-08-29 — The colour tokens split fill from text, and the audit is what proved it matters

**Context.** `tokens.css` has carried both `--success` and `--success-text` since Phase A, and the
same pair for warning, danger, info and primary. The distinction was never written down as a rule,
so it was followed where somebody happened to think about it and ignored everywhere else. Phase G
measured the result:

| what | measured | needs |
|---|---|---|
| "Paid" badge, student directory | 2.22:1 | 4.5:1 |
| "Pending" badge | 1.91:1 | 4.5:1 |
| "Published" badge, question bank | 2.13:1 | 4.5:1 |
| "WELL ESTABLISHED", recommendations | 2.42:1 | 4.5:1 |
| row actions, question bank (dark) | 4.21:1 | 4.5:1 |
| white on `--success-solid` | 3.77:1 | 4.5:1 |
| white on `--warning-solid` | 3.19:1 | 4.5:1 |
| `--text-muted` on a soft tint | 4.28:1 | 4.5:1 |

None of these is a typo. Each is somebody reaching for the colour that *names the meaning* — green
for paid, amber for pending — without asking whether that particular green can carry 12px text.

**Decision.** Three rules, and the tokens to make each one expressible.

1. **A fill colour is not a text colour.** `--success` and friends fill and border; `--*-text`
   carries words. 109 `color:` declarations rewritten.
2. **`--royal-blue` is not a text colour either.** The legacy alias is re-pointed *lighter* in
   `.theme-dark` precisely so it stays visible as a border on a dark surface, which is what makes it
   useless for text there. 38 declarations rewritten to `--primary-text`.
3. **Every solid fill has an explicit on-colour**, and not all of them are white. `--success-on` and
   `--warning-on` are near-black, because green and amber are light fills. The values are the same in
   both themes because the `-solid` fills are.

And one token moved: **`--text-muted` from `--slate-500` to `--slate-600`**. At the old value it was
4.76:1 on white — AA, and the tokens file called it "the floor" — but it dropped to 4.28:1 the moment
it sat on a tint, which is a thing every card, highlighted row and empty state does.

**Rejected: fixing the call sites and leaving the tokens.** The call sites *are* the fix for rules 1
and 2, but leaving `--text-muted` at slate-500 would have left the next tinted card to rediscover the
same failure. A secondary colour that only passes on pure white is not a secondary colour.

**Rejected: an automated contrast check in CI.** There is no frontend test suite (adding one needs
its own ADR), and the interesting cases are composited translucent fills that a static analyser
cannot see — the audit had to blend `rgba()` over its opaque ancestor to get real numbers.

**Consequence.** The rules are in `CLAUDE.md` and the reasons are in the tokens file beside the
values. `--text-subtle` remains for non-text glyphs only. Anything measuring under 4.5:1 for body
text is a defect, not a style choice.

## 2026-08-29 — Every claim on the landing page has to be checkable in the code

**Context.** The brief for the redesign said *do not invent claims, statistics or achievements; use
only verified project information.* Reading the existing landing page against the code found three
statements that failed that test, and none of them looked like a lie — they looked like ordinary
marketing copy somebody wrote once and nobody re-read:

- **"No — there is no negative marking."** `Question.negativeMarks` exists, `services/grading.ts`
  subtracts it, and the AI generator defaults it to **1**. A student who read this page and then sat
  a paper with a penalty would have been misled about what a wrong answer costs.
- **"Results are published on your personal dashboard within 48 hours of your exam."** No timer, no
  job, no setting. Releasing results is a deliberate administrative act in `services/examService.ts`.
- **"AMIT MATHS OLYMPIAD 2027."** The year is nowhere else in the product. The certificate it
  actually prints is titled `A.M.I.T MATHS OLYMPIAD` with **no** year, and the only year in the
  system is the *current* one, inside `AMIT-CERT-<year>-<n>`.

**Decision.** A claim goes on the landing page only if it can be traced to code, and where the
product genuinely varies the copy says *where the real figure appears* instead of naming one:

- Marks and penalties: "every question shows its marks and any penalty before you answer it" — true,
  because `studentQuestionView` returns both.
- Results: "the organisers release them after the sitting has closed" — which is what the code does.
- The year: removed. A sitting's dates come from the `Exam` window an administrator announces, and
  there is no public endpoint for them.

Two omissions follow from the same rule. **The entry fee is not named**, because `GET
/payments/status` is behind `requireAuth` and there is no public figure to read — and adding a public
route so a marketing page could print one would be a backend change made for the UI's convenience,
which this milestone forbids. **Referral earnings are not mentioned at all**, because
`ReferralSettings.rewardEnabled` defaults to `false`; the most public page in the product must not
promise money that is switched off.

**Rejected: keeping the claims and adding "subject to change".** A disclaimer under a wrong sentence
is still a wrong sentence, and the specific reader who is harmed — a child who expected no penalty —
does not read the small print.

**Rejected: reading the fee from a new public endpoint.** It is a one-line route and it is the wrong
instinct: the page does not need the number, it needs to be honest that a number exists. Adding an
endpoint so a marketing page can print a price is exactly the "backend change for UI convenience"
the milestone rules out.

**Consequence.** The ten class levels are rendered from `CLASS_LEVELS` rather than typed out, so the
page cannot advertise a class registration would refuse. The four figures still come from
`/public/stats` and still render only if they load — this page has never carried a placeholder
headline number. And **the year is flagged for the owner rather than decided**: if there is a real
one, it is a one-line change to the hero.

## 2026-08-29 — An address nobody declared gets a page, not a blank screen

**Context.** This app had no catch-all route. React Router renders nothing when no path matches, so
`/admin/studnets`, an old bookmark or a link from an email produced a **blank white page** — no
header, no navigation, no message. It is indistinguishable from a crashed bundle, and the reader's
only recovery is to retype the address they already got wrong.

This is not a hypothetical failure. `referralLinkFor()` generates `<app>/register?ref=<code>`, and
`/register` was not a declared route until Milestone 22 Phase F — so **every referral link the
product had ever sent was a blank page**, and nothing in 1,086 backend tests could see it.

**Decision.** `<Route path="*" element={<NotFound />} />`, last in the table. The page **names the
path that did not resolve** and offers the two destinations anybody can reach without knowing which
kind of account is signed in.

**Rejected: redirecting to `/` instead.** A redirect hides the typo that caused it — the reader ends
up somewhere plausible and never learns why. It also makes a genuinely broken link
indistinguishable from a working one, which is how the `/register` gap survived.

**Rejected: guessing the intended route.** "Did you mean /admin/students?" needs a route table with
edit distances and would confidently propose a page the reader has no permission for. Naming the
path is the fact that helps; a guess is a second thing that can be wrong.

**Consequence.** The route count is now 54 rather than 53. A future route added *after* the
catch-all will never match — put new routes above it.

## 2026-08-29 — A step indicator says what has happened, not how far along you are

**Context.** Bulk import and AI drafting are both state machines: configure/upload, then review, then
save. Neither said so. An examiner looking at a screen of parsed questions had **no way to tell
whether anything had been written to the question bank** — which is precisely the distinction those
two features are built around, since uploading and generating are deliberately non-writing
operations and approval is the only writer.

**Decision.** One shared `ui/Steps`, used by both and by registration (whose hand-built version it
was extracted from). Three properties:

1. **The current step is derived, never stored.** `saved ? 'saved' : batch?.length ? 'review' :
   'upload'`. A separate `stage` state would be a second source of truth about the screen, and the
   two would eventually disagree — the same reason there is no `hasPaid` flag on `Student`.
2. **The middle step is called Review, not "Imported" or "Generated".** A previewed file has been
   *read*. Naming that step after the work would assert something the database cannot confirm.
3. **It is not navigation.** The steps are not links; a step you have not reached does not exist yet.
   `aria-current="step"` marks the position, which is how a screen reader is told.

**Rejected: a percentage bar.** The rule from Phase A applies — `Progress` is determinate only with a
real value out of a real max. "60% through an import" is a fiction, and the honest indeterminate
form says nothing about *which part* is done.

**Consequence.** Adding a fourth multi-step flow means reusing this, not building a fourth row of
chips. A completed step is drawn with a soft fill rather than a solid one: white on
`--success-solid` measures 3.77:1, which passes SC 1.4.11 for a graphic but is a poor signal for the
one state that says a stage is finished.

## 2026-08-29 — The dashboard opens with what to do, not with what has happened

**Decision**: the student dashboard leads with three actions — Practice, Mock tests,
Daily challenge — then progress, then the record. The "Quick actions" card that used to
sit at the bottom is gone; its links are the top of the page.

**Reason**: it opened with four figures and ended, seven cards later, with the actions.
On a 390px screen that put the thing a student came to do below three screens of
scrolling, and XP and rank — which are *consequences* of practising — above the practice
button. Nothing was removed and no request was added: the counts in the action cards come
from the same `GET /me/dashboard` payload the page already had.

**No recommendation panel was added here.** The brief lists "recommended practice" as a
dashboard priority, and it exists — on `/analytics`, from a separate engine with its own
latency. Putting it on the page every student opens would add a second request to the
most-loaded route in the product for advice that is one tap away. What the dashboard shows
instead is the availability it already knows: how many published questions are waiting for
that student's class.

---

## 2026-08-29 — A table becomes cards on a phone, and no column is ever dropped

**Decision**: the listings that are *records* — recent test performance, referrals — render
as a `DataCardList` below 768px and as a `Table` above it. Both render every field.

**Reason**: five numeric columns on a 375px screen is five illegible columns, and the
usual fix — hiding the least important two — means the information only exists on a
desktop. A card per record keeps the label beside the value, where a phone has room for
exactly one pair per line.

The alternative, `TableScroll`, is still right where the columns are a *comparison* rather
than a record: the analytics breakdowns keep it, because reading "accuracy by difficulty"
means reading down a column.

---

## 2026-08-29 — Charts take their colours from the tokens, and follow the theme

**Decision**: `ChartCard` resolves `--primary`, `--text-muted`, `--border-subtle` and the
tooltip tokens at render time, and re-reads them when the theme changes. Callers pass a
semantic `tone` (`primary`, `info`, `success`), never a colour.

**Reason**: Chart.js draws on a canvas and cannot use a CSS variable, so the three charts
carried hex literals — `#0052ff`, `#4f46e5`, `#0ea5e9` — which is both a violation of the
token rule and the reason a chart stayed light-mode blue with grey axes on a dark page.
Reading the resolved value keeps one source of truth for colour.

**A canvas is an image to a screen reader**, so each chart carries `role="img"` and a
summary naming the series and its range. The numbers themselves are always in a table on
the same page, which is the honest fallback rather than a promise the canvas cannot keep.

---

## 2026-08-29 — Registration and sign-in are components, not part of the landing page

**Decision**: the registration wizard and the sign-in panel moved out of
`pages/Landing/Landing.tsx` into `pages/Auth/RegisterForm.tsx` and
`pages/Auth/LoginDialog.tsx`. The landing page renders both and keeps the orchestration
that is genuinely its own — the `?ref=` check, the `/register` scroll, the `#login` hash.

**Reason**: 749 lines held a marketing page, a three-step form with thirteen fields and
a photo uploader, and a hand-rolled modal, with their state interleaved. Neither half
could be read without the other, and the form's problems were invisible inside it. The
split is also what Phase F needs: the landing page can be redesigned without touching a
registration flow that works.

**The dialog is a dialog now.** The sign-in overlay had no focus trap, no Escape, no
scroll lock, and a backdrop click handler that also fired for clicks bubbling out of the
form. `ui/Modal` owns all four, and on a phone it is a bottom sheet.

**Sign-in stays a dialog rather than becoming a `/login` route.** It has never been a
route, the header and footer address it through `/#login`, and a second copy of the form
on a page of its own is a second thing to keep correct.

---

## 2026-08-29 — Every field reports its own error, and the summary moves focus

**Decision**: the registration form validates every field in one pass and renders each
message **on the field it belongs to**, with a summary at the top listing the problems as
buttons that focus the field they name. The same shape is used on the reset-password and
forced-password-change forms.

**Reason**: it validated into a single string — the first problem found, printed at the
top of a form that is two screens long on a phone. A student with three mistakes was sent
round three times, scrolling up each time to read a message that never said which field it
meant. That is the single worst thing about the pre-Milestone-23 product on a phone, and
it sat in front of the only door into it.

The rules did not change and are still convenience: the server's zod schema remains the
authority. What changed is that a mistake is now reported where the eye already is.

**The summary is not decoration.** With twelve problems on a 375px screen, a list of
names is only useful if pressing one takes you there — which is why `Field` gained an
optional explicit `id`. Passing an `id` to the control instead would have broken the
label's `htmlFor`; doing it on the field replaces the generated id everywhere at once.

---

## 2026-08-29 — A sign-in form needs its own error humanizer

**Decision**: `humanizeSignInError()` in `lib/errors.ts`, used by the student dialog and
the administrator's form. A 401 or 423 passes its message through; a 400 is replaced;
everything else defers to `humanizeError`.

**Reason**: both halves of this were found by typing a wrong password in a browser, and
neither is visible in the code.

`humanizeError` rewrites a 401 as *"Your session has ended. Please sign in again."* That
is right for a page whose data request was refused, and nonsense on the form you would be
signing in **with** — it told somebody who mistyped their password that their session had
expired. On a sign-in form the 401 **is** the answer, and the backend's message is
deliberately identical for an unknown account and a wrong password, so passing it through
is both clearer and keeps the non-enumeration property.

The 400 goes the other way. This product's 4xx copy is written for the reader, which is
why `humanizeError` passes it through — but the sign-in 400 is a zod aggregate
(`identifier: Enter your mobile number or email; password: Password…`), a schema talking
to a machine. It reached the screen once. Empty fields are now caught client-side so it is
rare, and replaced when it happens anyway.

---

## 2026-08-29 — One shell for both signed-in areas, and one navigation model

**Decision**: `components/layout/AppShell` renders the chrome for the student area *and*
the admin area, over one data model in `components/layout/navigation.ts`.
`StudentShell` and `AdminShell` survive as thin wrappers holding the parts only their
half knows — the unread count and the entry-fee padlock; the permission filter and the
identity block.

**Reason**: they were copies. Two sidebars, two drawers, two topbars, two active-item
comparisons, and the drift you would predict: the student drawer had a backdrop and the
admin one did not, neither trapped focus, and both left twenty links in the tab order
while off-screen. A navigation *model* rather than JSX is what lets four surfaces — the
desktop sidebar, the drawer, the bottom bar and the permission filter — agree by
construction.

**Grouping is part of the decision.** Sixteen student links and twenty admin links in a
flat column is a search task. Five student groups (Prepare / My progress / The Olympiad
/ Account) and six admin ones (Students / Question bank / Assessments / Insights /
Communication / Settings) make it a choice. The grouping is by what the reader came to
do, not by which milestone built the page.

**Two things are deliberately absent**, and both look like omissions until you know the
product: there is **no admin "Practice"** item, because practice is student-initiated
and there is no `PracticeSet` to curate (the Milestone 21 Phase G ADR) — the
administrative act is bulk-publishing in the Question Bank; and there is **no general
admin "Settings" page**, so that group holds the settings that actually exist.

**One thing was added**: `/exam`, the official Olympiad, which has existed since
Milestone 13 and was reachable only from the dashboard. The thing the product is named
after was missing from its own navigation, which is also why the `paid` padlock the nav
model had always described was dead code.

---

## 2026-08-29 — Mobile navigation: a bottom bar for students, a drawer for staff

**Decision**: three layouts rather than one that shrinks. Below 768px the student area
gets a **bottom bar** — Home, Practice, Tests, Challenge, More — and the admin area gets
a burger. From 768px both use a burger in the topbar. From 1024px the sidebar is
permanent.

**Reason**: the brief allows either a bottom bar or a compact header with a drawer, and
the two halves of this product have different users. A student opens four destinations
over and over on a phone, and a bottom bar puts them where a thumb already is; **More**
lives in the bar rather than as a burger in the top-left corner, which is the least
reachable part of a phone held one-handed. An administrator has twenty destinations and
opens them from a desk or a tablet; a bottom bar of four would be arbitrary.

**The permanent sidebar moved from 768px to 1024px.** The admin area is wide tables, and
a 264px sidebar on a 768px screen leaves 500px for them.

**A timed paper drops the bottom bar** (`focus`). It sits exactly where the answer
buttons are, and a mis-tap during an exam navigates away from the paper. The burger
stays at every width, because a student must always be able to leave.

---

## 2026-08-29 — The drawer is mounted, not hidden — because correctness must not depend on an event

**Decision**: the permanent sidebar is `display: none` below 1024px, and the mobile
drawer is a **separate element mounted only while it is open**. The same navigation is
rendered into whichever exists. No `visibility` toggle, no `inert`, no JavaScript media
query in the correctness path.

**Reason**: two earlier implementations were written and both were wrong, and neither
was visible by reading the code — the browser pass found both.

1. **One element that slides.** A drawer translated off-screen keeps all twenty links in
   the tab order and the accessibility tree. Adding `visibility: hidden` fixes that and
   breaks something else: `focus()` on an element the browser still considers invisible
   is a **silent no-op**, so moving focus into the newly-opened drawer depended on a
   style recalculation having already happened. It intermittently did nothing, and
   nothing announced that the menu had opened.
2. **`inert` instead.** It solves both — but it then has to be *removed* on a desktop,
   which needs `matchMedia` in JavaScript. A media-query change is delivered as part of
   the browser's style recalculation, which a tab that is not rendering never performs.
   A stale reading left the **permanent desktop sidebar `inert`**: the entire navigation
   unreachable by keyboard and absent from the accessibility tree. The worst failure the
   component could have, produced by its least reliable signal.

The general rule this is an instance of, and the one worth keeping: **anything delivered
with the rendering steps — `requestAnimationFrame`, `ResizeObserver`, `MediaQueryList`
change, a CSS transition's completion — may simply never arrive.** It is fine as an
optimisation and unusable as the only path to a correctness-relevant effect. Mounting is
not a signal; it either happened or it did not.

The one place a media query survives is closing an open drawer when the window is
widened past 1024px, and if that listener never fires the CSS has already hidden it.

---

## 2026-08-29 — The public header carries four destinations; the footer carries the utilities

**Decision**: the public navbar shows Leaderboard, Hall of Fame, Gallery and Verify a
certificate, plus a theme toggle and one call to action. The result and certificate
lookups moved to the footer, along with the administrator's door. A **Sign in** button
was added.

**Reason**: it carried eight links in one row, which meant nothing was primary — and one
of the eight was **Admin**, so a marketing page was advertising its own staff entrance to
every visitor. The two lookups are utilities: things somebody arrives already intending
to use, which is what a footer is for. Nothing became unreachable, and the footer gained
real structure in the process.

**The Sign in button is a genuine gap being closed**, not a redesign. The login form is a
panel on the landing page rather than a route, so a visitor reading the leaderboard had
no way to ask for it. It links to `/#login`, and the landing page opens the panel on that
hash — the smallest change that works, and cheaper than inventing a `/login` route with a
second copy of the form.

**A promoted admin sees both Admin and Dashboard.** They hold `students:read` *and* have
a student record with their own progress, so "which did they mean?" has no single answer.
The root administrator has no student progress and gets Admin alone.

---

## 2026-08-29 — There is one design system, in `components/ui`, and one token layer under it

**Decision**: Milestone 23 Phase A introduces `frontend/src/components/ui` — twenty domain-agnostic
primitives — and splits the 207-line `styles/theme.css` into `tokens.css` (custom properties only),
`base.css` (element defaults) and `utilities.css` (global classes + the pre-existing compatibility
ones). `theme.css` survives as the three `@import`s, so `main.tsx` is unchanged. **No colour, radius,
shadow, duration or z-index may be hardcoded in `src/` again**; if no token fits, one is added to
`tokens.css`.

**Reason**: the product had grown 12,450 lines of CSS Modules across 29 pages, and the shared layer
under them was thirteen colours, four radii, two shadows and a `.card` class. Everything else was
re-described per page: **52 separately-declared `.status` badges, 66 `.table`s, 16 `.notice`s, 8
`.modal`s**, three private notions of a stat tile. They mostly agreed — which is worse than
disagreeing, because nobody could tell whether a difference was a decision. None of the eight modals
trapped focus or restored it on close. That is not a styling problem, it is the absence of a system.

**The seam is the domain boundary, not the file type.** A component belongs in `ui/` only if it has
no knowledge of this product: `Badge` does not know what a payment state is, `Table` does not know
what a student is. `EntryFeeBanner`, `Recommendations`, `MathText` and the two shells stay in
`components/`, where they are allowed to talk about entry fees and answer keys. Without that line the
design system becomes a second home for business rules.

**Three token layers, and components may only touch the middle one.** Palette (`--blue-600`) →
semantic (`--primary`, `--danger-soft`) → legacy aliases (`--royal-blue`, `--text-main`, `--gold`).
The palette exists so the semantic layer can be re-pointed once; the aliases exist because 144
`--royal-blue` references across the un-migrated pages must keep working. Retokenising all of it in
one commit would be a rewrite disguised as a refactor.

**Nothing was deleted from under the old pages.** `.card`, `.form-control`, `.form-group`,
`.error-text` and `.success-text` are kept *and modernised*, and `components/Button.tsx`,
`Spinner.tsx` and `StatTile.tsx` became re-exports of the new ones. Those 88 imports pick up the
redesign without being touched, and no page breaks while it waits for its phase. The aliases and the
compatibility classes retire page by page, which is the only version of this change that can be done
in eight reviewable phases rather than one unreviewable commit.

---

## 2026-08-29 — Phosphor stays, as a webfont, from the CDN it already used

**Decision**: keep the existing icon library (Phosphor 2.1.1, `regular` and `bold` only, loaded from
unpkg in `index.html`) and put **one** `Icon` component in front of it. No new dependency.

**Reason**: the project already had a single consistent icon library — roughly 87 distinct glyphs
across 40 files, written as raw `<i className="ph-bold ph-target" />`. The brief's instruction is to
reuse an existing library, and the alternatives were both worse: `@phosphor-icons/react` would mean
rewriting several hundred call sites and maintaining a name→component map (a typo then renders
nothing), and self-hosting the webfont was tried and **reverted** — the package's `@font-face` lists
woff2, woff, ttf **and a 3 MB SVG font**, all four of which the bundler then emits as assets, for a
file the browser was already fetching from a CDN with a good cache hit rate.

**What the component earns.** Accessibility becomes structural rather than remembered: an icon with a
`label` is `role="img"`, one without is `aria-hidden`, and the default is the safe one. And the weight
type admits **only `regular` and `bold`**, because only those two stylesheets are loaded — `ph-fill`
matches no `@font-face` and renders an *invisible* glyph rather than falling back, so the failure is
silent and had to be made unrepresentable.

**The known cost, recorded honestly**: the icons depend on unpkg at runtime, and unpkg is a
development CDN rather than a production one. The mitigation is a rule rather than infrastructure —
**no icon is ever the only carrier of meaning** (which is an accessibility requirement anyway), so
the product stays readable if the font never arrives. A `preconnect` was added because the upstream
`@font-face` is `font-display: block`, which hides the glyphs until the file lands. If this ever
needs fixing properly, the answer is vendoring the two woff2 files plus their glyph CSS into
`public/`, not the npm package.

---

## 2026-08-29 — Inter joins Poppins: the interface reads, the brand speaks

**Decision**: `--font-body` becomes Inter (variable, 400–800, one file); Poppins stays as
`--font-heading` and keeps the brand voice. Poppins' 300 and 400 weights were dropped, so the page
requests **fewer** font files than before despite the extra family.

**Reason**: the brief says to improve typography without needlessly replacing the stack, and this
keeps what the stack was *for*. Poppins is a geometric display face — good for a hero and a wordmark,
poor at 13px in a dense admin table, and half of this product is dense admin tables of names, marks
and money. Inter was designed for exactly that and has proper tabular figures. Nothing in the product
set Poppins at 300 or 400, because Poppins now applies only to headings, so those two files were pure
waste.

Cinzel remains loaded for **one** surface, the printed certificate, and JetBrains Mono for figures.

---

## 2026-08-29 — The design-system reference page is development-only

**Decision**: `/design-system` renders every primitive in every variant, with a live viewport
read-out, and is gated behind `import.meta.env.DEV`. It is statically dead in a production build, so
there is no route and **no chunk** — verified by grepping `dist/`.

**Reason**: this frontend has no test suite (adding one needs its own ADR), so the only way a design
system stays consistent across 29 pages migrated over six phases is to be able to see all of it at
once, in both themes, at any width. A style guide that ships to visitors would be placeholder content
in production, which the brief forbids; one that does not exist at all means each phase re-derives
what a badge looks like. Dev-only is the version with the benefit and neither cost.

It contains **no product data and makes no API call** — its sample rows are labelled as samples, so
nothing on it can be mistaken for a real figure.

---

## 2026-08-28 — Referral tracking is real; the reward is configuration, and defaults to nothing

**Decision**: Refer & Earn is built end to end — a per-student code, server-validated attribution at
registration, conversion driven by captured payments, and a full reward lifecycle with an audit
trail. The **reward amount and whether it is paid at all are administrator-editable settings**, and
they default to **off and ₹0**.

**Reason**: nothing in this project has ever specified a referral reward — not an amount, not an
eligibility condition, not a payout method. So none was invented. A plausible default (₹50, say)
would be indistinguishable from a decision somebody made, and it would start accruing real
liabilities against real students on the day it shipped. The tracking is what was genuinely asked
for and is complete; the number is the owner's to set, and until they do every surface says the
programme is not running rather than displaying ₹0 as though it were an offer.

**Eligibility is deliberately NOT configurable.** A referral converts when the referred student's
entry fee is actually captured, and that rule lives in code. An amount is a business decision; a
rule about when money is owed is a correctness one, and a configurable version could quietly start
paying out on registration alone — the one thing a referral programme must not do.

**Two new models, and why neither is derived.** Almost everything else in this product is computed
on read — the entitlement, analytics, invoices, the leaderboard. A referral cannot be: **"who
introduced this student?" is not recoverable from any other collection**, and it has to survive the
code changing, the fee changing and the reward rules changing. `ReferralSettings` mirrors
`PaymentSettings` for the reason that one exists — a price needs an audit entry and must not be a
redeploy.

**What is still derived**: whether the referred student has paid. That is a query over `Payment`,
exactly as the entitlement is; duplicating it on the referral would be a second source of truth
about money. `convertedAt` records when the conversion was *observed*, and read paths reconcile a
stale row against the payment record — the pull to match the hook's push, the same shape as
`reconcileOrder()`.

**A refused registration, and why that is right.** A referral code that does not resolve **fails the
registration** and rolls the account back. Every other failure in that handler is best-effort, so
this is the exception: the alternatives are dropping the attribution silently (the referrer never
gets credit and nobody finds out why) or guessing (unthinkable). The register page validates the code
from the link before the form is submitted, so a student meets this only if they typed one by hand.

**One new permission, `referrals:write`, held by `admin` and `superadmin`.** Reading the console is
`students:read` — it is student account data — while deciding money is owed is a financial act. A
competition desk can chase referrals without being able to authorise payouts.

---

## 2026-08-28 — The brand's full form was asked for, not derived, and lives in one constant

**Decision**: **A.M.I.T = Advance Mathematics and Intelligence Test**, owner-supplied. It is defined
once in `frontend/src/lib/brand.ts` and displayed in exactly **one** visible place — under the
wordmark in the landing page hero — plus `index.html`'s SEO metadata.

**Reason it was asked for**: the expansion existed nowhere in the repository. A landing page is the
most public surface the product has, and an invented organisation name there is not a bug that gets
quietly fixed later — it is a false statement about somebody's business, printed under their own
brand. The founder being named "Amit Kumar" made it genuinely possible that the four letters were a
person's name rather than an acronym, so guessing had a real chance of being wrong in an
embarrassing way.

**Reason for a constant even with one on-screen use**: it is what stops the visible name and the
page metadata drifting apart, and it is the single place to change if the wording is ever corrected.

**Reason it is shown once and never explained.** The first implementation of this phase put the
expansion in the hero, in a new About section that broke the letters into boxes with a paragraph
about the competition, and again in the footer. The owner rejected all of it: the boxes were
unnecessary, `and` hanging off the `I` looked wrong, no explanation was wanted, and the name belongs
at the top. That is the durable rule — **a name is displayed, not glossed**. An acronym broken into
per-letter cards reads as a teaching aid, which is the wrong register for a masthead; and a brand
that explains itself on its own front page sounds unsure of itself.

The navbar keeps the four-letter wordmark for the same reason, with the expansion on the logo's
`alt` and the link's `title`, so nothing is lost to assistive technology or search.

**The one duplication, accepted**: `index.html` is static and served before any JavaScript, so it
spells the name out literally. Putting a page title behind a script would cost every visitor a render
for a string that never changes. Both files carry a comment naming the other.

**Deliberately not changed**: the certificate PDF and the invoice issuer default still read
`A.M.I.T Maths Olympiad`. Those are documents students and parents keep, and redesigning them was not
what was asked for — but if the expansion should appear on a certificate, that is a deliberate change
to a printed record and worth deciding on its own.

---

## 2026-08-28 — The content reset refuses rather than cascades, and is super admin only

**Decision**: four reset scopes (`questions`, `mock-tests`, `daily-challenges`, `chapters`), gated
on a new **super-admin-only** permission `content:reset`, each requiring a **typed phrase** and each
**refusing with a 409 that names its blockers** rather than cascading into the areas that depend on
it. Owner request, 2026-08-28.

**Reason the feature exists**: a platform loaded with trial data before launch has no way back.
Deleting three thousand questions one at a time is not a path anybody takes, so in practice the
trial data ships.

**Reason it refuses rather than cascades**: `Question.topic` is `required`, so deleting chapters
beneath questions leaves every question pointing at a chapter that no longer exists — invisible to
every filter an administrator can construct, and unfixable through the interface. A cascade would
make one click destroy four areas; refusing makes the dependency order visible and deliberate
(daily challenges → mock tests → questions → chapters). The **official exam is a blocker with no
resolution**: there is no reset for it and there must not be, because its results and certificates
are a permanent record.

**Reason for a new permission rather than reusing `questions:delete`**: that permission removes one
never-published question and refuses anything a student could have seen. This one removes published
questions in bulk, which **deliberately overrides** `deleteQuestion()`'s central rule. Overriding a
safety rule is precisely what should be confined to the role that holds the other irreversible
capabilities.

**Reason attempts go with their paper but XP does not**: a `MockTestAttempt` whose `MockTest` is
gone is a row the student's page cannot render, so it cannot sensibly outlive it. `StudentActivity`
is different in kind — it is a record of something that really happened, and taking it back would
re-rank the leaderboard against children who did nothing wrong. That asymmetry is stated in the
dialog rather than left for somebody to discover.

**Reason the dialog lists what survives**: a warning that only threatens gets clicked through. Half
the hesitation at that moment is "will this take the students' XP?", and answering it plainly is
what makes the button usable rather than something staff avoid and work around.

**No transaction**, so deletes run **dependents first** within a scope. A partial failure then
leaves the less broken state. This is the same constraint registration works under; if transactions
ever become available, this is a place to use them.

---

## 2026-08-28 — An invoice is a rendering of a payment, not a record of one

**Decision**: there is **no `Invoice` collection**. `services/invoiceService.ts` renders a captured
`Payment` on demand, and the invoice number is **derived** —
`AMIT-INV-<capture year>-<last 12 hex of the payment's ObjectId>`.

**Reason**: every property the requirement asked for falls out of this rather than having to be
maintained. *Idempotent*: downloading is a pure read, so nothing can be created twice. *Stable*: the
number is a function of the transaction, so it is the same on every call, in any process, for ever.
*Unique*: it rests on the `ObjectId`, which is unique by construction. *Correct about money*: the
amount is `Payment.amount`, a snapshot of what was charged, so re-pricing the fee — which happened on
2026-08-28, Rs.100 to Rs.199 — cannot alter an invoice already issued.

**The alternative, and why it was rejected**: a sequential number (`…-000123`) is what people picture
when they hear "invoice number", and it needs a counter. Allocating one at download time means a
**write on a GET**, which is the idempotency rule inverted; allocating it at capture time means every
payment already in the database has none, and a migration to invent numbers for historical
transactions. Two concurrent readers could also allocate the same counter value, which is the one
mistake an invoice register must never make.

**Only a captured payment has an invoice**, and the refusal is a **409 naming the state** rather than a
404. "No invoice exists" sends a student to support to be told their payment never completed — which
the page could have said itself. `refunded` is refused too: the document would be true of the past and
read as true of the present.

**What is deliberately *not* snapshotted**: the buyer's name, class and contact come from the live
`Student`. This is the opposite of `Certificate`, which freezes every printable field, and the
asymmetry is the point — a certificate is a claim about a past event that must never change, an invoice
is *addressed to a person*, and somebody who corrects a misspelt name wants the correction to appear.
Every financial fact is a snapshot; only the address block is live.

---

## 2026-08-28 — Nothing about tax is invented, and the issuer block is environment configuration

**Decision**: `INVOICE_GSTIN` and `INVOICE_TAX_NOTE` are optional and have **no defaults**. With them
unset the document is titled `INVOICE` and carries no tax line, no rate and no "inclusive of all
taxes". With a GSTIN set it is titled `TAX INVOICE` and the number is printed. The organisation name,
email and phone default to what the platform already publishes in its own footer; the address is
absent when unset.

**Reason**: a tax rate, a registration number or the phrase "inclusive of all taxes" is a legal claim
about the owner's business. Guessing one puts a false statement on a financial document a parent may
present to an employer or a school. Absent is recoverable; wrong is not.

**Why environment variables here, when the fee is deliberately a database document**: the fee is a
*price* — it changes, needs an audit trail, and is decided by someone who should not need a redeploy.
A registered address and a tax registration change roughly never, are decided once, and must be
**absent rather than wrong**: an unset variable prints nothing, whereas an empty settings field would
print an empty line on an invoice. If the owner ever wants to edit these from the admin panel, moving
them into a settings document is a small change — the rule that must survive it is that unset stays
absent.

**One operational trap recorded here because it is invisible until it bites**: `pdf-lib` **throws** on
a character its standard font cannot encode, and registration deliberately accepts names in any Indian
script (the `\p{L}\p{M}` pattern in `authSchemas.ts`). Every string reaching the PDF goes through a
sanitiser; without it, every student with a Devanagari name gets a 500 instead of their receipt.
Embedding a Unicode font would fix it properly at the cost of a font binary in the repository — which
the certificate already declined for the same reason. There is a test.

---

## 2026-08-28 — The student directory is one assembly, and payment state is derived

**Decision**: `services/studentDirectoryService.ts` is the single place the admin student
directory is built. `GET /admin/students` and `GET /admin/students/export` run the **same
pipeline** with the same filters and differ only in the renderer. Each student's entry-payment
state (`paid` / `pending` / `failed` / `refunded` / `not_started`) is **derived in the
aggregation from their `Payment` rows on every read**, and is stored nowhere.

**Reason for one assembly**: an export built from its own query is an export that quietly
disagrees with the table the administrator was looking at when they pressed the button — and the
person who finds the disagreement is whoever is reconciling the money, months later. Sharing the
pipeline makes "the file contains what the screen showed" a structural property rather than a
convention. There is a test that sends one set of filters to both endpoints and compares.

**Reason for deriving**: it is the same rule that put no `hasPaid` flag on `Student` (Milestone
19) and no `StudentAnalytics` collection (Milestone 15). A stored rollup is a second source of
truth about money, and when it drifts a student who paid is shown as unpaid. Deriving it *in the
database* rather than in JavaScript is what additionally makes the payment filter and the page
totals correct — a filter applied after `$limit` returns short pages and a wrong total.

**The cost, accepted**: a `$lookup` per page. It is bounded by the page size, indexed on
`{ student, purpose, status }`, and the alternative costs correctness.

**What must not be done to it**: do not add a `paymentState` field to `Student`; do not give the
export its own query; do not default the payment filter to `paid`. The last is the one that would
be easiest to justify and worst to ship — the directory exists to show **everyone who
registered**, and `not_started` is a first-class state rather than an absence.

**An aggregation bypasses `select: false`.** `passwordHash` is protected at the schema level,
which covers `find()` and nothing else. Every stage that can reach a response ends in an explicit
`$project` allow-list, and it must stay an allow-list rather than an exclusion list: with an
exclusion list, a field added to `Student` later is published by default, and the field most
likely to be added to a student record is another secret.

---

## 2026-08-28 — The Excel export renders; it does not query

**Decision**: `services/studentExportExcel.ts` has no database access. It takes
`StudentDirectoryEntry[]` and returns bytes. It is bounded by `EXPORT_MAX_ROWS` (20,000) and
**refuses** beyond that with a 413 naming the cap, rather than truncating. `exceljs` is reused —
already a dependency since Milestone 21 — and no new one was added.

**Reason**: the security property is that the file can only contain what the shared view holds,
so putting a secret into a spreadsheet that leaves the platform would take a deliberate change in
two other files first. The refusal-over-truncation rule is the same one the importer follows for
a row it cannot read: a spreadsheet quietly missing its last few thousand rows looks complete,
gets filed, and is reconciled against months later.

**Two sheets, not banner rows.** The data sheet starts at row 1 with the header, because the
first thing anybody does to it is filter, sort or re-import it — and a title row above a header is
exactly the shape that makes an importer read the title as the header, which is a defect this
project has already had once, in `services/excelImportParser.ts`. The context (what the file
contains, when, by whom, and what each payment state means) goes on a second sheet, because the
file gets emailed and opened months later by somebody who was not in the room.

**Types, not strings.** Dates are written as dates and money as a number in **rupees** with a
number format. A column of `"₹100.00"` strings sorts alphabetically and sums to zero, and the
first thing a competition desk does with this file is a pivot table.

---

## 2026-08-28 — An importer still never creates chapters; the review screen offers to

**Decision**: `previewImport()` returns `unknownChapters` — the distinct chapter names a file
stated that the bank does not have — and the review screen offers to create them in one action via
`POST /admin/chapters/bulk`. The import path itself is **unchanged**: a stated chapter that does
not resolve is still an error against that row, and no parser or import ever writes a `Topic`.

**Reason**: the rule was right and the outcome was unusable. A bank seeded with Class 12 chapters
refuses every row of a real NCERT Class 9 paper, and "create it under Chapters first" asked the
examiner to retype ten names exactly into a one-field form — while the rejected rows never reach
the review screen where the chapter dropdown lives. The feature was correct and unusable at the
same time, which is the case worth designing for.

**Why it does not weaken the rule**: the safety property is *not* that creating a chapter is
laborious. It is that **an examiner reads an explicit list of what will be created before anything
is created**. Preview writes nothing, the names are listed verbatim above the button, and reading
"Polynomails" among ten is what catches it. Retyping it catches nothing — it just re-enters the
typo. Keeping creation inside the importer, keyed off a row, is the thing that stays forbidden:
that is what would let one spreadsheet reshape the syllabus unread.

**Consequences**: the re-run is a **fresh preview**, not a patch — the previously rejected rows go
back through the same resolution, screening and duplicate detection, so the second answer is the
one approval will act on. The route lives in `taxonomy.routes.ts` under `taxonomy:write`, not in
the import router, because it creates chapters and is not an import step; the importer merely
names them. Subtopics are not creatable in bulk — a parent has to be chosen per item.

---

## 2026-08-28 — Every student-facing question path is scoped to the implicit subject

**Decision**: `getPracticeAvailability()`, `startPracticeSession()`, `pickAutomaticQuestion()` and
`getAvailableChallenges()` all filter by `findImplicitSubject()`. The two admin screens that choose
what a child is served — the mock-test paper builder and the daily-challenge scheduler — pass
`subject=<implicit>` to `/admin/questions`. The **Question Bank is deliberately left unscoped**.

**Reason**: Phase J removed the subject picker, so the practice page stopped sending a `subjectId`
and those queries became unfiltered across subjects. On a database holding a legacy Physics subject
that meant a mathematics olympiad dealing Physics questions in mixed practice — and because a
session snapshots its answer key at serve time, that is a real mark on a real report, not a display
bug. The dashboard advertised them and the daily challenge could pin one for a whole class.

**Why in the service, not the page**: the practice page flattens the API’s subject grouping into
one chapter list, so it *could* have filtered there. But the guarantee wanted is that the product
**serves** mathematics, not that one screen hides the rest — the session endpoint would still have
dealt the questions to anything that asked.

**Why the Question Bank stays unscoped**: it is where an administrator finds and manages legacy
data. Hiding a published question from the only people who can unpublish it is worse than showing
it. The two *pickers* are a different job and are scoped.

**`null` leaves the query unscoped**, matching `suggestPaper()`: refusing to serve any practice
because legacy data is ambiguous would break a working feature over a condition a student can
neither see nor fix.

**Consequences**: `scripts/retire-extra-subjects.ts` is the way to retire the legacy subject now
that the interface has no subject management. Archiving is enough — every availability pipeline
already matches `subjectDoc.status: 'active'`, and with one active subject the implicit resolution
stops depending on a name match. Adding a genuine second subject later means revisiting this ADR,
not deleting it: the scoping is what would need a per-student or per-paper subject choice.

---

## 2026-08-28 — One frontend resolver for the implicit subject

**Decision**: `frontend/src/api/implicitSubject.ts` is the only place the browser decides which
subject the product is. It mirrors `findImplicitSubject()` exactly, **including returning null**
when several subjects exist and none is named for mathematics.

**Reason**: five screens had no resolution at all and listed every subject’s chapters; a sixth used
`subjects[0]`, which ignores the maths-named preference the server applies and could therefore have
scoped a bulk import to Physics while the server filed it under Mathematics. Three answers to one
question is how a chapter list comes to disagree with what the page writes.

**Why it mirrors the null rather than falling back to the first subject**: a fallback would show an
examiner chapters the server would then refuse to write to. An empty list that explains itself is
better than a populated one that fails on save.

**Consequences**: keep the two in step — if `findImplicitSubject()` changes, this changes with it.
A new chapter picker should call `loadChapters()`; a screen that also needs to filter questions
should call `loadChapterScope()`, which returns the id and the chapters together so it cannot
filter by one subject while listing another’s chapters.

---

## 2026-08-28 — Classes run 3–12, and the three Class 12 streams collapse into one

**Decision**: `CLASS_LEVELS` becomes a flat ten — `Class 3` … `Class 12`. Class 3 and 4 are new;
`Class 12 - Science`, `- Commerce` and `- Humanities` are retired into a single `Class 12`. Owner
decision, taken in Phase A and executed here. The string form was kept over integers because
`classLevel` is a stored enum on nine collections, appears in compound indexes, and is printed on
certificates.

**The consequence, stated plainly**: a Commerce student and a Science student now **sit the same
papers** — one practice pool, one mock test list, one daily challenge per day. The streams existed
because the competition paper differed by stream, so this is a real product change and not a
tidy-up.

**If a stream ever matters again, it must not return as three class values.** That shape put a
curriculum distinction inside the field that decides *which children see which questions*, so
every filter, every compound index and the `{day, classLevel}` unique constraint all had to carry
it — which is precisely why merging them needed a migration with collision handling. An optional
`stream` field on `Student` is the shape to reach for.

**Consequences**: `scripts/migrate-class-levels.ts` is report-only by default and refuses to write
while daily-challenge collisions are unresolved, because two challenges on one day become one key
and a mid-run failure would leave the database half-converted. `Certificate` and `GenerationLog`
are **not** migrated — they are historical snapshots, and rewriting a certificate would make the
record disagree with the paper a child was handed. `RETIRED_CLASS_LEVELS` lives in
`lib/classLevels.ts` so a future reader can tell why a certificate prints a class that is not in
the enum.

---

## 2026-08-28 — Subject leaves the interface; the model stays

**Decision**: every user-facing Subject control is removed — the taxonomy page, the student
practice picker, the question editor, the question bank filter, both admin question pickers, the
AI generator, and the analytics/report breakdowns. The `Subject` model, the `/subjects` routes and
`Question.subject` all **stay**.

**Reason for removing the UI**: AMIT is a mathematics olympiad. A dropdown with one item is a
decision nobody can get wrong and everybody has to make, and it taught administrators a concept
the product does not have. "By subject" in analytics was worse than useless: with one subject it
repeated the overall figures under a heading that made them look like a different measurement.

**Reason for keeping the model**: `Topic` is scoped by subject, and a topic name is only unique
within one — removing the field would break the taxonomy and every question already filed. Keeping
it also means adding a second subject later is a new page rather than a migration.

**How it was made clean**: `subject` became **optional** on `createQuestionSchema`,
`generateQuestionsSchema` and the approve/validate schemas, and `resolveTaxonomy()` derives it
from the chapter. Deriving beats asking for the reason the import path already worked this way — a
chapter records its subject, so accepting both admits a pair that can disagree. The cross-check is
**kept** for callers that still send one (AI approval, import): for them a mismatch is a real
client bug worth refusing rather than resolving silently.

**Consequences**: `findImplicitSubject()` / `requireImplicitSubject()` in `taxonomyService.ts` are
the one place that answers "which subject is this product?", and the Chapters page makes the same
choice client-side so the two agree about where a new chapter goes. The Physics seed was deleted:
it is what put Physics chapters into a "whole syllabus" mathematics paper. **Do not add a subject
selector back** without an ADR — if a second subject is genuinely wanted, the honest change is a
new page, not resurrecting a dropdown of one item.

---

## 2026-08-23 — A question’s chapter may be detected, deterministically, and is never guessed

**Decision**: the chapter is **optional** when importing and when authoring by hand, and is worked
out from the question text by `lib/chapterDetection.ts` — a pure, deterministic function of the
text and the chapter names. No language model is involved. Precedence: what the file states, then
detection, then the examiner’s fallback.

**Reason for no model**: the same argument the Phase D ADR makes for `.docx`. The signal is already
in the text, so a model adds cost, latency, a third party on every upload, and a credential
dependency in a *core* authoring path the product must work without. A chapter is also exactly the
kind of claim a model states confidently and wrongly, and the mistake is invisible: the question
looks fine, and only the analytics and a practising student ever notice.

**Reason it may not guess**: a question in the wrong chapter is **served to a student practising
something else**, and it corrupts the per-topic counts `services/analyticsService.ts` derives and
`lib/statisticalRecommender.ts` reads. So three outcomes, not one: `matched` carries a note naming
the words it matched on, `ambiguous` **names the candidates** rather than choosing, and `none`
reports the row by its number. Refusing to choose between two equal fits is the important one —
that is where a guess is most likely to be wrong and least likely to be questioned, because both
answers look reasonable to a reviewer skimming.

**Consequences**: everything in that module is pure, so every detection is reproducible from its
inputs and testable without a fixture. The manual editor and the importer share the one function,
so they cannot disagree about what a question looks like. The stemmer is crude on purpose — a real
stemmer is a dependency and a black box — and it is short enough to read, which is how the
`derivatives`/`derivative` bug was found. If detection ever needs to be better, the honest
improvements are richer chapter descriptions or explicit keywords on `Topic`, not a model.

---

## 2026-08-23 — A whole-syllabus paper is a spread, and is scoped to the implicit subject

**Decision**: `GET /admin/questions/paper-suggestion` round-robins across every chapter that has
published questions for the class, and filters to the platform’s implicit subject via
`findImplicitSubject()`.

**Reason for the spread**: the obvious implementation — the existing listing with `limit=40` — is
not a syllabus paper. It returns the forty most *recent* questions, and a bank filled chapter by
chapter means that is one or two chapters and none of the rest. The spread is the entire feature;
a test seeds a second chapter *after* the first specifically so a "newest N" implementation would
fail it.

**Reason for the subject scope**: a Class 12 whole-syllabus paper came back containing Ray Optics
and Electromagnetic Induction, because this database still holds a legacy Physics subject and the
spread dutifully included every chapter. Scoping at the query means the endpoint is right
**regardless of whether that data is ever deleted**, rather than depending on a cleanup.

**The two resolvers are deliberately different.** `findImplicitSubject()` returns `null` when it
genuinely cannot tell and the caller degrades to unscoped; `requireImplicitSubject()` throws.
A *filter* should not break a working feature over legacy data an examiner cannot see, and a
*write* must not file questions under a guessed subject — that makes them invisible to every filter
a user can construct, which looks exactly like data loss.

**Consequences**: `ImportBatch` now records `subject`. Approval used to derive it from
`defaultTopic`, which broke when the chapter became optional — an import that left the chapter to
detection had nothing to derive from and would have been unapprovable for a reason the examiner
could do nothing about. There is a fallback to the old derivation for rows written before the
field existed.

---

## 2026-08-23 — A question becomes practice content by being published; there is no `PracticeSet`

**Decision**: "assign imported questions to Practice" is implemented as a **bulk publish** from
the question bank, plus a preview of what a class can then practise. No `PracticeSet` collection
was created. Owner decision, taken after Phase A raised it and re-confirmed before Phase G.

**Reason**: Practice in this product is **student-initiated**. `startPracticeSession()` takes a
class, an optional chapter and an optional difficulty from the *student* and `$sample`s the
published questions matching them. There is no curated set, and never has been — so there is
nothing for an administrator to assign *to*.

Building one would mean a new model, new routes, a new student picker, and — the part that
settles it — **a second path that serves questions to students**. Every such path has to
re-implement the answer-key snapshot rules, and `CLAUDE.md` records that a forgotten field in a
hand-written projection is an answer leak. The product brief also says in terms: *do not create a
second Practice system*. A `PracticeSet` would have been one.

So the honest reading of "select thirty approved questions and make them practisable" is:
publish them with the right class and chapter. That is already true — a test in Phase C asserts
an imported, published question appears in a student's practice availability — and what was
missing was only the *affordance* and the *confirmation*.

**Two things make it a real feature rather than a shrug.** `PATCH /admin/questions/bulk-status`
moves a selection in one request, and `GET /admin/questions/practice-availability?classLevel=…`
answers "what would a Class 7 student now find in the picker?" by calling the **same**
`getPracticeAvailability()` the student route calls. A second count would eventually disagree
with the picker, and then the preview would be reassuring an administrator about something
untrue.

**The bulk route loops rather than bulk-writes, and that is the safety property.** A single
`updateMany` would be a second path to a published question that skips `assertPublishable()` —
the check that refuses a question with no solution or no resolvable answer key. A student is
*graded* on a published question, so a bulk publish that bypassed it would put ungradeable
questions in front of children, quietly, in batches. There is a test that publishes two
questions where one has no solution and asserts the refusal.

**Consequences**: a partial success is the normal outcome and is reported per question, not as a
400, and nothing is rolled back — the questions that moved were each legitimately publishable.
The selection is held by **id** and cleared whenever the filters, sort or page change: an
index-based selection surviving a filter change would let somebody publish questions they can no
longer see, and "publish" here means "show to children". If a curated practice set is ever
genuinely wanted, it needs its own ADR and it must reuse `studentQuestionView` rather than
hand-rolling a projection.

---

## 2026-08-23 — Image import uses a model; it transcribes, and our own code reads the answer

**Decision**: `services/imageImportParser.ts` calls Google Gemini to read questions off a
photograph — and asks it for **a transcription of what is printed**, not for an answer key. The
response schema carries `questionText`, `options` as printed, and `answer` **as written** in a
plain string. It deliberately contains no `isCorrect`, no `booleanAnswer`, no `numericAnswer` and
no `marks`. Those are derived afterwards by `lib/importAnswerText.ts`, the same readers a
spreadsheet cell and an `Answer: B` line in Word go through.

**Reason for using a model at all**: the Phase D ADR declined AI for `.docx` because a Word file
*is text we already have*. A photograph is the opposite: there is no text, and OCR is the only way
in. This is not a reversal of that decision, it is the case it was drawn around — and it is why
the image path is the only importer that is non-deterministic, spends quota, and reports
`extraction: 'model'`.

**Reason for the transcribe-only schema**, which is the more interesting half. Asking a model to
fill in typed answer fields would make it the authority on **what counts as correct**, in a
product where that is the one thing that must not be wrong. Asking it only what the page *says*
keeps its job to the thing it is good at (reading pixels) and keeps the judgement in code that a
human can read. Two further properties fall out of it: **what is not in the schema cannot come
back** to be misinterpreted, and the phase needed **no new answer reading at all**, which is
exactly what extracting `lib/importAnswerText.ts` in Phase D was for.

**The refusal that matters most**: a question with **no printed answer is refused, never given
one.** The prompt forbids the model from working an answer out, and an empty `answer` becomes a
named failure. A calculated answer would be indistinguishable from a printed one, and children
would be marked against it.

**Consequences**: `marks`, `class`, `topic` and `difficulty` come from the upload defaults only —
reading "(4 marks)" or a "Class 8" page header off a photograph is precisely the plausible
misreading that changes a score or files a question for the wrong cohort. Temperature is 0.1,
not the generator's 0.9, because transcription has one right answer. Every image import carries a
standing warning that mathematical notation is where OCR is least reliable; that warning is not
boilerplate and must not be trimmed. And **no other format may depend on a model credential** —
with `GEMINI_API_KEY` absent, Excel and DOCX stay available and only this route answers 503.

---

## 2026-08-23 — There is exactly one Gemini call: `requestGeminiJson()`

**Decision**: the provider call was extracted out of `geminiQuestionGenerator.generate()` into
`requestGeminiJson()`, and image extraction calls that rather than building its own request.
Per-caller concerns — the prompt, the response schema, the temperature, the output budget, the
remedy to suggest on truncation — are parameters.

**Reason**: the alternative was a second call site, and what would have been duplicated is exactly
the set of things this codebase has already got wrong once and documented at length. The shared
**deadline** in `attemptGenerate()` is the sharpest example: a signal built outside the retry loop
made a real 503 report as "timed out", and a fresh full-length signal per attempt outlives a
serverless invocation — there is a `TROUBLESHOOTING.md` entry about it. Alongside that: the client
via `clientFactory` (so `setGeminiClientFactory()` still intercepts **every** call the suite
makes and no test can reach the network), the credential check, `redact()` so a provider error
surfaced verbatim can never carry the API key, and the empty-reply and `MAX_TOKENS` cases —
which arrive as an empty response rather than as an error, and would look like "the model
returned nothing" to whichever caller forgot to check.

A second copy would eventually differ on one of those, and the difference would surface as a
mysterious failure on one feature and not the other.

**Consequences**: the generator's 52 tests pass unchanged, which is the evidence the extraction
was behaviour-neutral. Adding a third model-backed feature is now a prompt and a schema rather
than a client. The rule in CLAUDE.md stands and is now structural rather than aspirational:
**there is one Gemini client, and one function that calls it.**

---

## 2026-08-19 — DOCX extraction is deterministic; no AI is used for it

**Decision**: `services/docxImportParser.ts` reads Word documents by **reading them** —
`mammoth` to text, then conventions for numbering, options, answers, solutions and metadata. No
language model is involved, even though the product specification explicitly permits
"AI-assisted extraction for complex DOCX structures behind a provider abstraction".

**Reason**: a `.docx` is *text we already have.* The structure is genuinely recoverable by reading
it, which makes a model a way of paying money and latency for something arithmetic-adjacent —
exactly the objection Milestone 16 raised against an LLM for recommendations. Three further costs
settle it: it would send an examiner's file to a third party on every import; it would make a
**core format depend on a credential the product is required to work without** (the rule that
`GEMINI_API_KEY` absent must never disable anything but question drafting); and a model's
confident misreading of a paper is much harder for a reviewer to spot than a heuristic's obvious
one.

The image path in Phase E is a genuinely different case, and the difference is the whole reason
this ADR is narrow: there is no text to read off a photograph, so OCR is the only way in at all.

**Consequences**: DOCX extraction is reproducible — the same document always yields the same
questions — and costs nothing. It is also **less capable**, and the design absorbs that rather
than hiding it: every interpretation is a note on the candidate, every unusable block is a failure
naming its question number, and a document that cannot be read at all is told what the parser
looked for. If a future document defeats it, the honest fix is better conventions in the document
or a hand-authored question, not a model.

---

## 2026-08-19 — Reading an answer is shared by every import format

**Decision**: the readers for a human-written answer — option letters, `TRUE`/`FALSE`, accepted
answers, a question type name, type inference — moved out of the Excel parser into
`lib/importAnswerText.ts`. Format detection moved to `lib/ooxml.ts`. Both parsers now call them.

**Reason**: the same argument that keeps one grader, one screener and one ranking service.
**"The answer is B" has to mean the same thing** whether it was written in a spreadsheet cell or
on an `Answer: B` line in Word. Two implementations would drift, and the drift would be invisible:
the same question imported from two formats would carry two different answer keys, and nobody
would find out until a correct answer was marked wrong.

It also concentrates the decisions that are easy to get subtly wrong in one reviewable place —
the type-inference order (options, then true/false, then number, because `1` is a boolean
spelling), and the `|` separator for accepted answers (because `1,000` is one answer containing a
comma).

**Consequences**: everything in that module is a **pure function of a string**, like
`lib/questionQuality.ts` and the reward catalogues, so every reading is reproducible and testable
without a fixture file. The inference note is now phrased for any format rather than mentioning a
spreadsheet column, which broke two Excel assertions that were asserting the wording — stale
rather than wrong, and fixed. Adding a third format should require **no new answer reading at
all**.

---

## 2026-08-18 — The Excel template uses one `Correct Answer` column, read per question type

**Decision**: the import template has a single `Correct Answer` column rather than a column per
answer shape. Its contents are interpreted according to the row's question type — an option
letter or letters for a choice question, `TRUE`/`FALSE` for `true_false`, a plain number for
`numeric`, and a **bar-separated** list of accepted spellings for `fill_blank`. A blank `Type`
column is inferred from the row and always carries a note.

**Reason**: the alternative — `Correct Option`, `Boolean Answer`, `Numeric Answer`, `Accepted
Answers`, `Tolerance` as five separate columns — is what the `Question` model looks like
internally, and it would put four permanently-empty columns in front of an examiner filling in
a sheet of MCQs. A template is a human interface, and a column somebody will never fill in is a
column that makes the ones that matter harder to find. The per-type reading is not ambiguous
because the type is either stated or inferable from the row's own shape.

**The bar separator is the load-bearing detail.** `fill_blank` accepted answers are separated by
`|`, not `,`, because **`1,000` is one answer containing a comma** — as are `2, 3 and 5` and any
coordinate pair. A comma-separated list would silently split real answers into wrong ones, and
the failure would be invisible: the question would import, look right on the review screen, and
mark a correct answer wrong months later. The same reasoning as `normalizeAnswerText()`
forgiving case and nothing else — a grader that guesses is worse than one that refuses.

**Type inference order** is options → true/false → number → fill-in-the-blank, and the
true/false-before-number step matters: `1` and `0` are boolean spellings, and a bare `1` in an
answer column is far more often "true" than the number one. Every inference carries a note,
because an inference is exactly the thing a reviewer should check.

**Consequences**: the template is readable by somebody who has never seen the data model. Adding
a question type means teaching `readAnswerFor()` and `inferType()` about it, on top of everything
already listed in CLAUDE.md — which is one more reason that list is long.

---

## 2026-08-18 — The import template is generated per request, not checked in

**Decision**: `GET /admin/questions/import/excel/template` builds the `.xlsx` with `exceljs` on
every request and serves it `no-store`, rather than serving a file committed to the repository.

**Reason**: its `Class`, `Type` and `Difficulty` columns carry **Excel dropdowns generated from
`CLASS_LEVELS`, `QUESTION_TYPES` and `DIFFICULTIES`**, and its Instructions sheet lists those
same values in prose. A checked-in file would be correct on the day it was committed and wrong
afterwards — and the class list is about to change in Phase J, which would have made the
template advertise classes the API refuses. **A template that offers an invalid value is worse
than no template**, because the examiner only finds out after filling in two hundred rows.

Generating it also makes the strongest available test possible: the template is pushed through
the product's own parser and its example rows must import cleanly. That test caught both Phase C
defects, and it cannot be written against a static asset without the asset going stale.

**Consequences**: a few hundred milliseconds of CPU per download, which is nothing for a route an
examiner hits once. The route is the only `GET` in the importer that does not return the
`{ success, ... }` envelope, which is the certificate-PDF precedent. Its path is advertised by the
status endpoint so no page hardcodes it. The class dropdown degrades to a free-text cell if the
class list ever exceeds Excel's 255-character inline-list limit, rather than emitting a broken
dropdown.

---

## 2026-08-18 — Bulk import reuses the AI generator’s pipeline instead of getting its own

**Decision**: the bulk question importer is built on the two-phase shape
`services/questionGeneratorService.ts` already uses — parse/propose, then a separate approval that is the
only writer — and it reuses that module's screener rather than having one of its own.
`screenCandidates()` gained a sibling, `screenEach()`, which takes a screening target **per candidate**;
the original now delegates to it and is unchanged in behaviour. `ImportedCandidate` composes
`GeneratedCandidate` **verbatim** for its content half, so there is exactly one canonical candidate
representation in the codebase.

**Reason**: the product spec asked for "one canonical question representation" and explicitly forbade an
`ExcelQuestion` / `DocxQuestion` / `ImageQuestion` per format. The stronger reason is the one behind the
one-grader and one-ranking-service rules: a second implementation of "may this become a question?" would
eventually disagree with the first, and **the more permissive of the two would decide what got into the
bank**. What imports genuinely needed was not a different screener but a per-row target, because a
spreadsheet legitimately carries a `Class` and a `Topic` column and row 3 may belong to a different
chapter from row 40. Generalising one function is a smaller change than a parallel path, and it keeps
batch-internal duplicate detection spanning the whole upload — so the same question pasted into two
chapters of one file is still caught.

**Consequences**: adding a format is implementing `ImportParser` and calling `registerImportParser()`.
Nothing about the routes, the validation, the duplicate detection, the review screen or the approval path
changes. Anyone touching `screenEach()` is now changing the gate for **both** the generator and the
importer, which is the intended pressure.

---

## 2026-08-18 — Uploaded files travel as base64 in the JSON body, and nothing touches the filesystem

**Decision**: `.xlsx`, `.docx` and image uploads arrive as base64 data URLs inside the JSON body, are
validated by magic bytes in `validation/uploadSchemas.ts`, and are parsed from a `Buffer`. No multipart
parser (`multer` or otherwise) was added, and no file is ever written to disk. The large body allowance
is granted to the import path prefix only, on both URL prefixes.

**Reason**: it is the pattern the registration photo and the event gallery already use (Milestone 4 ADR),
so it needs no new dependency and works with the existing `validate` middleware and `{ success, ... }`
envelope. The decisive argument is what it removes: the spec asked for safe temporary filenames,
temp-file cleanup and path-traversal prevention, and **with nothing on disk all three stop being risks
to get right and become risks that do not exist.** No uploaded file is ever in a position to be executed,
and there is no upload directory to leak or traverse. The filename is kept only as a label for error
reports, and validated anyway.

**Consequences**: base64 inflates the payload by about a third, so the body-parser limit is 1.4× the
decoded ceiling and the schema re-checks the decoded total. Very large imports have to be split across
requests — acceptable, since a batch has to stay reviewable by one human regardless. A **decompression
bomb is not defended against** beyond the size cap; recorded as a residual risk in `SECURITY.md`.

---

## 2026-08-18 — `ImportBatch` is a new collection rather than a reuse of `GenerationLog`

**Decision**: bulk imports get their own `ImportBatch` model (the 27th), and `Question.provenance.source`
gains `excel_import`, `docx_import` and `image_import` alongside `human` and `ai_assisted`.

**Reason**: two things had to be true at once. `Question.provenance` must be able to say how a question
entered the bank, and **`source` is the one field worth lying about** — a client that could set it could
file questions a model read off a photograph as hand-written ones. So the facts have to be read back from
a row we wrote, using an id we issued, exactly as `approveQuestions()` reads them from `GenerationLog`.
But `GenerationLog` is thoroughly model-shaped — a model name, a language, a Bloom's level, a requested
count, a prompt-instruction flag — and reusing it for a spreadsheet would have produced a row of nulls
whose reader could not tell an absent field from an inapplicable one.

It is also genuinely read, not just written: approval reads provenance **and the subject** from it, which
is what keeps it from being the sort of write-only model Milestone 15 deleted.

**Consequences**: a missing batch row is a hard 400 rather than a degraded stamp, unlike the generator's
equivalent — without it there is nowhere to file the questions and nothing to fall back to that would not
be a guess. `source` and `generatorKind` are kept as **separate** facts: an image import is
`image_import` *and* `generatorKind: model` with a model name, while an Excel import is `excel_import`
with `deterministic` and no model. Collapsing them would lose one of the two things worth knowing. The
new values are lowercase snake_case to match what is already stored; renaming the existing two to the
spec's upper case would have been a migration over the whole bank for a cosmetic gain.

---

## 2026-08-18 — An importer suggests a taxonomy by name; it never supplies an id, and never creates one

**Decision**: `ImportedCandidate.taxonomy` is an `ImportedTaxonomyHint` of **names as the file wrote
them** (class, chapter, subtopic, difficulty), all nullable. `services/questionImportService.ts` resolves
those names against the live taxonomy, falling back to the examiner's per-upload defaults when a row is
silent, and **reporting an error against that row** when a row names something that does not resolve. No
importer can create a `Topic`.

**Reason**: this is the closest the importer comes to relaxing the generator's rule that a candidate
carries no taxonomy at all, so the difference is worth stating. That rule exists because a *model* must
not be able to file questions where it was not asked to. A spreadsheet with a `Class` column is a
different thing: it is the examiner's own data, and a file of two hundred questions spanning six chapters
is the normal case rather than an attack. What survives unchanged is that **an id is never accepted from
the extraction side** — a name is a request to look something up, and the lookup is ours.

The asymmetry between "silent" and "wrong" is the important half. A missing `Class` column is a file the
examiner has already answered for with a default. A `Class` column saying `13` is a **mistake in the
data**, and silently replacing it with the default would file a question under the wrong cohort and serve
it to the wrong children. So one defaults and the other is refused with its row number.

**Consequences**: name matching forgives capitalisation and spacing, and reads a class as `8`, `8th`,
`Grade 8` or `Class 8` — because that is what a real workbook contains. It is **not** fuzzy beyond that:
`Clss 8` is refused, on the same principle as `normalizeAnswerText()` forgiving case and nothing else.
An unknown chapter means the examiner creates it under Chapters first, or corrects the spelling; **one
bad spreadsheet cannot reshape the syllabus.** At approval, each question does carry its own placement as
ids — safe for a different reason: a human picked them on the review screen, and `resolveTaxonomy()`
still refuses a topic outside the subject, a subtopic outside the topic and an archived either. A client
can choose an existing placement; it cannot invent one.

---

## 2026-08-18 — `exceljs` and `mammoth` are added; images need no new dependency

**Decision**: two dependencies for the importer — `exceljs` (MIT) to read and write `.xlsx`, and
`mammoth` (BSD) to extract text from `.docx`. Image extraction adds **nothing**: the already-installed
`@google/genai` accepts inline image bytes, so the image path reuses the existing Gemini client,
`GEMINI_API_KEY` and `GEMINI_MODEL` rather than introducing a second provider or a second credential.
Approved by the owner on 2026-08-18.

**Reason**: both are free, offline, widely used, and need no external account, so the ₹0 constraint holds
— Razorpay remains the only paid service. `exceljs` does both halves of the Excel job, which matters
because the spec asks for a downloadable template as well as parsing. Hand-rolling DOCX (a ZIP of XML)
was considered and rejected: hand-written ZIP and XML handling over untrusted files is exactly where
malformed-file and zip-bomb bugs live, and `mammoth` is a smaller risk than a bespoke unzipper.

**On the advisory**, because it will show up in `npm audit` and should not be re-investigated from
scratch: `exceljs@4.4.0` depends on `uuid` < 11.1.1, which carries a moderate advisory for a missing
buffer bounds check in **v3/v5/v6 when a `buf` argument is supplied**. It is **not reachable here** —
exceljs calls only `uuid.v4()`, with no `buf`, in one file
(`lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`). Verified by reading the installed source rather
than assumed. The other ten advisories in that report predate this work and all descend from
`@vercel/node`. `exceljs` is also no longer actively maintained, which is the real thing to watch: if a
maintained replacement appears, or if our usage grows to touch conditional formatting, re-check this.

**Consequences**: the serverless bundle grows. Both libraries are `require`-able CommonJS, so neither
repeats the `@google/genai` packaging problem. The importer stays behind `ImportParser`, so replacing
either library is a change to one file.

---

## 2026-08-17 — CSRF is defended by verifying the request's origin, not by a token

**Decision**: `backend/src/middleware/csrf.ts` refuses any `POST`/`PUT`/`PATCH`/`DELETE` under `/api` whose `Origin` (or, if absent, `Referer`) names a host outside the CORS allow-list and outside the request's own host. A request carrying neither header is allowed. No CSRF token, cookie or header is issued.

**Reason**: A browser sends `Origin` on every request whose method is not `GET`/`HEAD`, including a cross-site form post, and `Origin` is a forbidden header name that page script cannot set or strip. This backend already keeps an exact allow-list of legitimate origins for CORS, so "did this come from our own front end?" was already answerable — CORS simply never asked it about *simple* requests, because CORS governs whether a response may be **read**, not whether a request may be **sent**. Asking it in one mounted middleware closes the gap with no client change at all.

Rule 3 — allow when neither header is present — is the part that looks like a hole and is not. CSRF is by definition a browser attack: the attacker's entire leverage is the victim's browser attaching the victim's cookies. A request with no `Origin` and no `Referer` did not come from a browser, so it cannot be a forgery, and refusing it would break `curl`, the test suite and Razorpay's server-to-server webhook while protecting nobody.

**Alternatives considered**: A **double-submit cookie / `x-csrf-token` header**, which SECURITY.md had promised since Milestone 5. Rejected as an addition *on top of* the origin check rather than on its merits: for browser-issued requests — the only category that exists here — it adds no coverage the origin check lacks, while requiring every client to read a cookie and echo it in a header. That is a change at 610 call sites in the existing suite and a permanent obligation on every future API consumer. Also considered and rejected: relying on `SameSite`, which is unavailable because production cookies must be `sameSite: 'none'` for the two-domain split (see the 2026-08-04 ADR).

**Consequences**: `FRONTEND_URL` becomes load-bearing for *writes* in production, not only for emailed links — if it is wrong, browser-issued writes are refused. That is a deliberate tightening: the same variable already had to be right for anybody to verify their address at all, and the startup log reports it as an error. Adding a `urlencoded` body parser or loosening the CORS allow-list no longer silently removes the CSRF defence, because the defence is now explicit rather than incidental. If a token is ever wanted as a second layer, add it *behind* this check, not instead of it.

---

## 2026-08-17 — The public result and certificate lookups publish a masked name

**Decision**: `GET /results/:studentId` and `GET /certificates/:studentId` return the student's name through `displayNameFor()` — a first name and a last initial — instead of the full legal name. The `/certificate` page was moved to the authenticated `GET /me/certificates`, which still carries the full name.

**Reason**: Both routes are unauthenticated by design and keyed on `AMIT_0000`–`AMIT_9999`, which is ten thousand identifiers. Once results are released, that is a walk of the whole roll returning every entrant's full name beside their score, national rank and percentile. The leaderboard was given `displayNameFor()` and an anonymous depth cap precisely to stop this product becoming a directory of children; these two routes were answering the same question a different way, which was never a decision anybody took.

**Alternatives considered**: **Rate limiting alone** — added as well, but it is a delay rather than a property, and on serverless the per-instance counters make it weaker still. **Requiring authentication** — rejected, because a parent or a school checking a child's result should not need an account, which is the whole reason the portal is public. **Returning no name at all** — rejected, because a parent typing an ID needs to confirm they are looking at the right child.

**Consequences**: One more surface now depends on `displayNameFor()`, which keeps the count of places that decide how much of a child's name is published at exactly one. Widening it stays a one-line change and the owner's call. The holder's own view is unaffected, and public verification (`GET /verify/:code`) still returns the full name — correctly, because it keys on 16 symbols of randomness rather than a walkable serial.

---

## 2026-08-04 — MongoDB (via Mongoose) as the database

**Decision**: Use MongoDB with Mongoose ODM for all persistence.
**Reason**: Already in place when this audit began (inherited decision, not made in this session) — `mongoose` is a backend dependency and all 5 models are Mongoose schemas. Documented here retroactively so it isn't silently changed to a relational DB later without discussion.
**Alternatives considered**: None recorded from prior sessions.
**Consequences**: Free-tier MongoDB Atlas fits the ₹0 cost constraint. Schema-less flexibility suits an evolving MVP. Tradeoff: no foreign-key enforcement (see `studentId`-as-soft-reference issue in [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md)) — relationships must be enforced in application code, not the database.

---

## 2026-08-04 — JWT (httpOnly cookie) for session auth, not server-side sessions

**Decision**: Stateless JWT signed with a shared secret, delivered via `httpOnly` cookie; no session store (no Redis/Mongo session collection).
**Reason**: Inherited decision. Fits a serverless (Vercel) backend well, since there's no persistent server process to hold in-memory sessions, and avoids needing a separate session-store service (cost).
**Alternatives considered**: None recorded from prior sessions.
**Consequences**: No server-side session revocation — logout only clears the client cookie; a leaked token remains valid until its 7-day expiry. Acceptable for MVP; revisit if handling sensitive data (e.g. payments) at scale.

---

## 2026-08-04 — Two separate Vercel projects (frontend/backend split), not one

**Decision**: `frontend/` and `backend/` are deployed as independent Vercel projects with independent `vercel.json` configs, communicating over HTTPS with CORS + cross-site cookies.
**Reason**: Commit `9dbdf27` ("Rebuild frontend in React, add real authentication, split into separate services") deliberately moved away from an earlier combined structure — prior commits (`1938876`, `6df3e60`, `9bba7cf`, `c32c717`) show repeated struggles getting a single combined Vercel deployment working, suggesting the split was chosen to simplify each deployment's build/runtime concerns independently.
**Alternatives considered**: Single Vercel project serving both static frontend and API routes (attempted in earlier commits, apparently caused deploy friction — see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)).
**Consequences**: Requires CORS + `sameSite: 'none'` cookies (cross-site) in production, which is a materially different security posture from same-origin — see [`SECURITY.md`](SECURITY.md) CSRF notes. Also means `frontend/vercel.json` must hardcode/track the backend's production URL manually.

---

## 2026-08-04 — TypeScript pinned to 5.9.3 (backend) / `~6.0.2` (frontend)

**Decision**: Backend pins `typescript@^5.9.3` specifically (commit `e19adb6`, "Pin TypeScript to stable 5.9.3 to fix Vercel build failure"). Frontend separately uses `~6.0.2`.
**Reason**: A newer/prerelease TypeScript version broke the Vercel build; pinning to a known-stable version fixed it.
**Alternatives considered**: None recorded.
**Consequences**: The two apps intentionally run different major TypeScript versions since they're independent npm projects — this is fine (no shared build), but don't "helpfully" unify them without first confirming both builds still pass on Vercel, given this exact class of issue caused a prior outage.

---

## 2026-08-04 — Single hardcoded admin account via env vars, no admin registration

**Decision**: Exactly one admin identity exists, defined by `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` env vars, compared directly in the login route. No `Admin` collection, no admin signup UI/route.
**Reason**: Inherited decision — appropriate for a small MVP with a single founder/operator ("Amit Kumar" branding throughout the UI implies a single-admin operation).
**Alternatives considered**: None recorded.
**Consequences**: Scaling to multiple admins later requires a real `Admin` model + registration/invite flow — not built yet; flag this as a future decision point rather than retrofitting silently.

---

## 2026-08-04 — No payment gateway integrated yet; static QR placeholder only

> **Superseded on 2026-08-16 by "Razorpay Standard Checkout, verified server-side" below.** The provider decision was made (Razorpay), the QR placeholder was deleted, and real payment collection exists. The concern recorded here — that the UI implied a payment nobody was taking — was exactly right and is what the replacement was written to close.

**Decision (implicit, by omission)**: Ship the registration flow with a static QR code image and a self-reported "I've paid" button, with no real payment verification, pending a real decision.
**Reason**: MVP needs to demonstrate the registration UX before committing to a specific payment provider (which likely has fees, KYC requirements, or isn't free-tier-friendly).
**Alternatives considered**: Not yet evaluated — needs owner input (Razorpay, Cashfree, etc. are common India-market options with free/low-cost test modes, but this has **not been decided** and must go through the owner per [`CLAUDE.md`](CLAUDE.md)'s cost-constraint rule before any SDK is added).
**Consequences**: Currently zero real payment collection is happening — registrations are effectively free regardless of the UI implying payment. Must be resolved before any real-money launch.

---

## Audit note

This is the first `DECISIONS.md` for the project (created during the 2026-08-04 Phase 0 audit). Entries dated 2026-08-04 above are **retroactive documentation of decisions already embedded in the existing code/git history**, not new decisions made during the audit itself. No new architectural decisions were made in this audit session.

---

## 2026-08-04 — Milestone 1: split `backend/src/server.ts` into a modular foundation

**Decision**: Break the single-file backend (`server.ts`, ~450 lines) into `config/`, `db/`, `lib/`, `middleware/`, `models/`, `routes/v1/`, `validation/`, with `app.ts` (builds the configured Express app, used by both the dev server and the Vercel serverless entry) and `server.ts` (dev/production process bootstrap: connects the DB, starts listening, handles graceful shutdown — not used by the Vercel serverless path).
**Reason**: This is the deliberate refactor `CLAUDE.md` anticipated ("When it grows, split into `models/`, `routes/`, `middleware/`... as a deliberate refactor recorded in `DECISIONS.md`"). Milestone 1 explicitly required env validation, structured logging, error handling, validation architecture, security headers, rate limiting, health/readiness checks, and a testing foundation — all of which need their own modules; cramming them into one file would make the foundation itself unreadable.
**Alternatives considered**: Keep everything in `server.ts` and just add more top-level consts/functions — rejected, defeats the purpose of "foundation" work and makes the new pieces (logger, error handler, validation) hard to unit test in isolation.
**Consequences**: All existing route **behavior and response shapes are unchanged** — this was a structural move, not a rewrite of business logic. `backend/api/index.ts` (Vercel entry) now imports the app from `src/app.ts` instead of `src/server.ts`.

---

## 2026-08-04 — API versioning: `/api/v1/*` as canonical, `/api/*` kept as a compatibility alias

**Decision**: All real routes are now defined once and mounted at both `/api/v1/...` (canonical, versioned) and `/api/...` (unversioned, for backward compatibility).
**Reason**: The milestone asked for API versioning as a foundation piece, but the deployed frontend (`frontend/src/api/client.ts` and every page) calls unversioned `/api/...` paths today, and `frontend/vercel.json` rewrites `/api/*` to the backend. Introducing `/api/v1` as the *only* path would silently break the frontend's already-working login/register/analytics flows — out of scope for a backend-only milestone and against the "don't break working functionality" rule in `CLAUDE.md`.
**Alternatives considered**: (a) Version-only, breaking the frontend — rejected, out of scope and destructive to working features. (b) No versioning at all — rejected, the milestone explicitly required it and unversioned APIs are a known long-term maintenance problem.
**Consequences**: New backend work should call/add routes under `/api/v1/...`.

**Update (same day, later in Milestone 1)**: the frontend migration originally deferred here **was completed** in this milestone. `frontend/src/api/client.ts` now owns a single `API_BASE = '/api/v1'` constant and every caller passes a version-agnostic path (`/auth/login`). This turned out to be low-risk rather than out-of-scope, because both the Vite dev proxy and the Vercel `/api/(.*)` rewrite pass the remainder of the path through unchanged, so no deploy configuration had to change — verified by loading the SPA and watching it call `/api/v1/auth/me` through the proxy. The unversioned `/api/*` alias is **kept** so any other client (or a stale cached frontend bundle) keeps working; a test asserts the two paths behave identically. Removing the alias remains a future follow-up. One new operational constraint: **deploy the backend before the frontend**, or a new frontend will call `/api/v1/*` against an old backend that only serves `/api/*`.

---

## 2026-08-04 — Chosen foundation libraries (all free, no paid infra)

**Decision**: `zod` (env + request validation), `pino` + `pino-http` (structured/request logging), `helmet` (security headers), `express-rate-limit` (rate limiting), `vitest` + `supertest` (backend test runner, per the framework choice already flagged as pending in `TESTING.md`), `eslint` + `typescript-eslint` (backend linting — the frontend's `oxlint` is not reused here since it's a separate npm project and oxlint's current config in this repo is React-focused).
**Reason**: All are free/open-source npm packages (₹0 cost constraint), widely used, and each maps directly to one Milestone 1 requirement. `mongodb-memory-server` was considered for DB-backed tests but rejected for this milestone (see Testing decision below).
**Alternatives considered**: Jest instead of Vitest (Vitest chosen for faster ESM-native startup and lower config overhead with `tsx`); Winston instead of Pino (Pino chosen for lower overhead and native JSON structured output); Joi instead of Zod (Zod chosen for TypeScript-first inference, avoids hand-maintaining separate types).
**Consequences**: `backend/package.json` gains these as new dependencies. None require a paid service or external account.

---

## 2026-08-04 — Backend tests do not require a real/in-memory MongoDB

**Decision**: Milestone 1's test suite (health, readiness, error handling, validation) uses `supertest` against the exported Express `app` with the Mongo connection state abstracted behind `src/db/connection.ts`'s `getConnectionState()`, which tests mock directly — no `mongodb-memory-server` and no real Atlas connection is used in automated tests.
**Reason**: `mongodb-memory-server` downloads a real MongoDB binary on first run, adding test flakiness/slowness and a dependency on outbound access that may not always be available (this sandbox's egress is HTTP(S)-only with raw DNS/TCP blocked — see `TROUBLESHOOTING.md`). Foundation-level tests (is the health check reachable, does the error handler format errors correctly, does validation reject bad input) don't need a real database to be meaningful.
**Alternatives considered**: `mongodb-memory-server` for full integration tests — deferred to a later milestone once real data-bearing routes (exam attempts, results) are built and actually need to be tested against real query behavior.
**Consequences**: Test coverage added in this milestone does not exercise real Mongoose queries end-to-end. That gap is intentional and documented in `TESTING.md`, not accidental.


---

## 2026-08-04 — Database connection is established per-request (`ensureDb`), not only at startup

**Decision**: DB-backed routes carry an `ensureDb` middleware that lazily connects (via the cached `connectDB()`) before the handler runs, applied **after** validation and auth. Startup also connects eagerly, but non-fatally.
**Reason**: Discovered while actually running the app: `backend/api/index.ts` (the Vercel entry) imports `src/app.ts`, and only `src/server.ts` called `connectDB()`. Because `server.ts` never executes on the serverless path, **production would have had no database connection at all** on every data route — a regression from the original single-file version, which connected at module load. Connecting per request is the standard serverless pattern and `connectDB()` already caches and de-duplicates, so warm containers pay nothing.
**Alternatives considered**: (a) Call `connectDB()` at module scope in `app.ts` — rejected: an unhandled rejection at import time in a serverless cold start is hard to surface, and it would connect even for `/health`. (b) One app-level `app.use(ensureDb)` before all routes — rejected: it would make malformed input return 503 instead of 400 when the DB is down, and would gate the static mock routes and 404s on a database they don't need.
**Consequences**: Ordering is load-bearing — `validate → requireAuth → ensureDb → handler`. Every new DB-touching route must add `ensureDb` explicitly; forgetting it produces a route that works locally (where startup connected) but fails in production. A side effect is that `/auth/me` answers 503 rather than 401 for guests while the DB is down; the frontend treats any failure as "guest", so this is acceptable and is logged in `PROJECT_STATE.md`.


---

## 2026-08-04 — Milestone 2: split tokens into a short-lived access JWT plus a rotating opaque refresh token

**Decision**: Replace the single 7-day JWT with two credentials. The access token is a JWT (15 minutes by default) carrying `role`, `sub`, `studentId` and a `tv` token-version claim. The refresh token is 32 bytes of `crypto.randomBytes`, opaque (not a JWT), stored in MongoDB **only as a SHA-256 hash**, rotated on every use, and grouped into a "family" per login.
**Reason**: The old design could not revoke anything — a stolen 7-day token stayed valid until expiry even after logout, which `SECURITY.md` recorded as an open issue. Splitting the two lets access checks stay stateless and cheap (no database read per request) while sessions become genuinely revocable, because the refresh token is a database row we can mark dead.
**Alternatives considered**: (a) Keep one long JWT and maintain a denylist — rejected: a denylist has to be consulted on every request, which is the database read we were trying to avoid, and it grows unboundedly. (b) Make refresh tokens JWTs too — rejected: a JWT is self-validating, so it cannot be revoked without the same denylist problem; an opaque token's authority *is* the database row. (c) Store refresh tokens in plaintext — rejected outright: a database leak would then hand out live sessions.
**Consequences**: Revocation of *access* is bounded by the access-token TTL (≤15 minutes); refresh tokens die instantly. That trade-off is written down in `SECURITY.md` rather than hidden. Reusing an already-rotated refresh token is treated as theft and revokes the entire family, which means a legitimate client that replays a token (e.g. two parallel refreshes) also gets signed out — the frontend therefore de-duplicates refreshes through a single shared promise in `api/client.ts`.

---

## 2026-08-04 — Login accepts either the mobile number or the email address

**Decision**: `POST /auth/login` takes one `identifier` field holding either value; the handler matches it against both columns.
**Reason**: Owner's explicit choice when asked. Email had to be added to `Student` because verification and password reset are impossible without it, but students had already been registering with mobile numbers, and `CLAUDE.md` forbids breaking working functionality. Accepting both keeps every existing login working while making email a first-class identifier.
**Alternatives considered**: (a) Mobile-only login, email purely for mail — rejected by the owner as needlessly restrictive. (b) Switch to email-only — rejected: it would strand anyone who registered with a mobile number.
**Consequences**: `email` is now required and unique on `Student`, so **any student document created before this milestone lacks it** and will fail validation on its next save. There is no migration script; see the "existing student documents" note in `TROUBLESHOOTING.md`. The lookup uses `$or` over two explicitly-normalised strings, never raw user input, so no query operator can be injected.

---

## 2026-08-04 — Registration does not sign the student in; email verification is required first

**Decision**: `POST /auth/register` creates an unverified account, emails a single-use link, and returns **no session cookies**. Login is refused with `403` and `code: 'EMAIL_NOT_VERIFIED'` until the link is clicked. Governed by `REQUIRE_EMAIL_VERIFICATION` (default `true`).
**Reason**: Owner's explicit choice, and it matches the register → verify → login sequence the milestone asked to be tested. It also means a mistyped address cannot produce a usable account, which matters because that address is the only password-recovery channel.
**Alternatives considered**: Sign in immediately and nag with a banner — rejected by the owner; it gives unverified accounts real access.
**Consequences**: The old registration flow ended with "you're logged in, go to your dashboard"; it now ends with "check your email". The fake client-side OTP step (which accepted the hardcoded string `123456`) was deleted rather than kept alongside real verification. The env flag is the escape hatch if mail delivery ever breaks — flipping it to `false` must be a deliberate, temporary act.

---

## 2026-08-04 — SMTP via nodemailer, with a logging transport when unconfigured

**Decision**: Send mail through `nodemailer` over plain SMTP, configured entirely by env vars. When SMTP is unset, write the email — including the action link — to the structured log. Under test, capture emails in memory.
**Reason**: SMTP is the lowest common denominator, so the owner can use any free tier (Brevo 300/day, Resend, Mailtrap, or a Gmail app password) by changing env vars alone, with no code change and no vendor SDK. The ₹0 constraint rules out anything paid. The log transport means the whole verification and reset flow is exercisable locally before the owner has signed up for anything.
**Alternatives considered**: A provider SDK such as Resend's — rejected: it locks the choice into code and adds a dependency for no gain over SMTP. Skipping email entirely and auto-verifying — rejected: that is exactly the mock authentication the milestone forbade.
**Consequences**: Delivery failures are logged and swallowed, never surfaced as a 500, because an auth route must not leak whether an address exists nor break because a mail provider is down. The log transport prints a real, working token, so **the backend log is sensitive in development** and must not be pasted into public issues.

---

## 2026-08-04 — Admins get a longer-lived access token and no refresh token

**Decision**: Admin login issues a single access token (8 hours by default) with no refresh token and no rotation.
**Reason**: The admin identity is two env vars, not a database row, so there is no `Student._id` to hang a refresh-token family off. Building a parallel refresh mechanism for exactly one account would add a schema and a code path for no real benefit.
**Alternatives considered**: Give `RefreshToken` a nullable student plus a `subjectType` discriminator — rejected as over-engineering for a single-operator MVP. Keep the admin on a 7-day token — rejected: 8 hours is a working day and much tighter than 7 days.
**Consequences**: Admins re-authenticate roughly daily. If multi-admin support ever lands (which needs a real `Admin` model anyway), refresh-token support should be added at the same time.

---

## 2026-08-04 — Integration tests run against a real in-memory MongoDB

**Decision**: Adopt `mongodb-memory-server` for the auth suites, superseding the Milestone 1 decision to avoid it.
**Reason**: That earlier decision was made because the tooling was unverified in this environment and foundation tests did not need a database. Milestone 2 changes both halves: the auth flows are *defined* by database behaviour — unique indexes, atomic single-use token consumption, rotation bookkeeping — and none of that can be meaningfully mocked. The package was verified working here before being adopted.
**Alternatives considered**: Mocking the Mongoose models — rejected: it would assert that our mocks behave as written, not that the flows work, and would have missed the duplicate-key and atomicity paths entirely.
**Consequences**: Auth tests are slower (a few seconds to boot a database per test file) and depend on a downloaded MongoDB binary. Supersedes the "Backend tests do not require a real/in-memory MongoDB" entry above for the auth suites; the Milestone 1 foundation tests still run without a database.

---

## 2026-08-05 — Three roles, with the env account as `superadmin` and admins promoted from existing accounts

**Decision**: Authorization has three roles — `student`, `admin`, `superadmin`. The environment-configured account (`ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`) now holds **`superadmin`** and remains the bootstrap root with no database document. A super admin grants or revokes `admin` on any existing verified account via `PATCH /api/v1/admin/users/:studentId/role`, which sets a new `role` field on that account's document. `superadmin` is deliberately **not** assignable through the API.
**Reason**: A third role only means anything if more than one admin can exist, and "admin account handling" is meaningless while admin is a single pair of env vars. Promoting an existing account reuses the entire Milestone 2 stack — login by mobile-or-email, bcrypt, lockout, email verification, refresh-token rotation, password reset — so an admin account gets all of it for free. Confining role assignment to a role no ordinary admin holds is the actual security win: a compromised admin session cannot mint more admins.
**Alternatives considered**: (a) Two roles only, documenting super admin as unnecessary — rejected: it leaves admin un-creatable and un-manageable, which is most of what this milestone asked for. (b) A separate `AdminUser` collection with its own login, invite and password-setup flow — rejected: it duplicates the whole authentication stack for a handful of staff accounts, roughly doubling the work and the surface area to keep secure. Chosen after presenting all three to the owner.
**Consequences**: Staff accounts are `Student` documents with `role: 'admin'`. The model name is now narrower than what it stores — renaming the collection was out of scope and would need a migration. A promoted admin therefore keeps their student capabilities (they can sit the exam and see their own analytics), which is intentional. Because the root account has no document, `superadmin` cannot be suspended or demoted from the UI: withdrawing it means changing the environment variables.

---

## 2026-08-05 — Authorization is permission-based, not role-based, and lives in one table

**Decision**: Routes declare a *permission* (`requirePermission('students:read')`), never a role. The role → permission mapping lives only in `backend/src/lib/permissions.ts`. Comparing `req.user.role` to a literal anywhere else is forbidden. The effective permission list is returned to the client on login, refresh and `/auth/me`, and the frontend drives guards and navigation from that array rather than from a copy of the table.
**Reason**: Role checks scattered through handlers are how authorization rots: moving a capability between roles means finding every site, and missing one is a vulnerability that looks like working code. One table also makes the whole policy reviewable in a single screen. Sending permissions to the client removes the second copy of the rules that a frontend would otherwise maintain and drift from.
**Alternatives considered**: (a) Keep `requireAuth('admin')` role gates — rejected: it hardcodes today's role layout into every route, which is exactly what a milestone named "RBAC foundation" should remove. (b) Mirror the permission table in the frontend — rejected: two copies of an access-control rule will disagree eventually, and the UI's copy would be the one silently wrong.
**Consequences**: `requireAuth(...roles)` still exists for the rare gate that genuinely is about identity rather than capability (`/auth/logout-all`). `requirePermission` returns a middleware *array*, so it bundles the freshness check below; this puts `ensureDb` before `validate` on privileged routes, inverting the order CLAUDE.md documents for data routes — deliberate, since refusing an unauthorized caller before doing any parsing work is the safer order. The client's permission array is a UI convenience only and is re-checked on every request.

---

## 2026-08-05 — Privileged requests re-read the role from the database

**Decision**: A request needing any permission a `student` does not hold re-reads the caller's `role`, `status` and `tokenVersion` from MongoDB and uses those, not the token's claims. Student-level requests stay stateless with no database read. The env root admin is exempt, having no document. Role changes and suspensions additionally revoke refresh tokens and bump `tokenVersion`.
**Reason**: The access token carries the role it was signed with and lives up to 15 minutes. Without this, revoking someone's admin rights would leave them administrative for the rest of that window — the one moment you most need the revocation to bite. Administrative traffic is a rounding error next to student traffic, so one indexed read per privileged request costs nothing measurable.
**Alternatives considered**: (a) Shorten the access-token TTL for admins — rejected: it narrows the window without closing it, and worsens the experience for everyone. (b) Maintain a revocation list in memory — rejected: serverless containers do not share memory, so it would be wrong on the platform this deploys to. (c) Accept the 15-minute window and document it — rejected: this milestone's explicit requirement is that a student can never reach an admin API, and a stale token is the most likely way that fails.
**Consequences**: Privileged routes now require a database connection to *authorize*, so they answer 503 when MongoDB is down instead of 403 — an availability-for-correctness trade that is right for administrative endpoints. `callerCanFresh()` provides the same guarantee for in-handler decisions such as reading another student's analytics. Tested by demoting an account directly in the database, leaving `tokenVersion` untouched, and confirming the still-valid token is refused.

---

## 2026-08-05 — The audit trail records refusals as well as actions, and never expires

**Decision**: A new `AuditLog` collection records administrative actions (`user.role.changed`, `student.status.changed`, `questions.generated`, `admin.session.started`) **and** refused privileged requests (`authz.denied`). It has no TTL index. A failed audit write is logged at `error` level but does not fail the request that triggered it.
**Reason**: Recording refusals is what makes the trail useful for detection rather than just accounting: a burst of `authz.denied` against one account is the signature of an escalation attempt, and it is invisible if only successes are stored. No TTL because an audit trail that silently deletes itself is not an audit trail — unlike `RefreshToken` and `VerificationToken`, where expiry *is* the point.
**Alternatives considered**: (a) Fail the request when the audit write fails (fail-closed) — rejected: the administrative action has already been committed by then, so reporting failure would be a lie that invites the admin to repeat a change that already happened. (b) Log refusals only to pino — rejected: platform logs are not queryable by an admin and roll off; the point is that an operator can see this in the app. (c) A TTL on denials to bound growth — rejected as premature; denials are bounded by the rate limiters.
**Consequences**: Only authenticated callers produce `authz.denied` rows, so an unauthenticated flood cannot inflate the collection. `actorLabel` is denormalised (`AMIT_xxxx`, or the root admin's email) so history stays true even if the account is later renamed or deleted. Retention is unbounded; if that ever needs a limit it is a policy decision and belongs here.

---

## 2026-08-05 — Registration photos are stored in MongoDB, in their own collection

**Decision**: The mandatory registration photo (max 2 MB) is stored as a `Buffer` in a new `StudentPhoto` collection, one document per account, rather than on the `Student` document or in external object storage. It is served by `GET /students/:studentId/photo` as raw image bytes.
**Reason**: The project targets ₹0 spend and the owner chose the option that needs no external account, so an image CDN was out. Given MongoDB, a separate collection rather than a `Student` field is what keeps the cost bounded: every student query — the admin list, the login lookup, the freshness read on each privileged request — would otherwise carry the binary, and `select: false` on a field is one forgotten projection away from being very expensive. A separate collection also means moving to object storage later is a change to one collection instead of a field migration across every account.
**Alternatives considered**: (a) Cloudinary/imgkit free tier — offered to the owner and declined; it needs a signup, API keys and a new env group. (b) A `photo` field on `Student` with `select: false` — rejected for the projection risk above. (c) GridFS — rejected: it exists for files over the 16 MB BSON limit, and a 2 MB cap is comfortably under it, so it would add chunking machinery for nothing.
**Consequences**: Storage is bounded by the database. At 2 MB a photo, the Atlas free tier's 512 MB holds roughly **250 students** — enough for a first cohort and a known ceiling to revisit before scale; this is the first thing that will force a paid tier or a CDN. Photos are personal data behind an authorization check, so the route sets `Cache-Control: private` and checks `students:read` *freshly* against the database before serving someone else's.

---

## 2026-08-05 — The photo is carried as a base64 data URL in the JSON body, not multipart

**Decision**: `POST /auth/register` takes the photo as a `data:image/...;base64,...` string inside the ordinary JSON body. Only that route is given a larger body limit (2.8 MB); every other endpoint keeps body-parser's 100 KB default.
**Reason**: It keeps registration a single atomic request — the account and its mandatory photo are created together, so there is no window in which one exists without the other. It also needs no new dependency (`multer`) and works unchanged with the existing `validate` middleware, the zod schemas and the `{ success, ... }` envelope, none of which understand multipart. Scoping the larger limit to one route means a large-payload flood has exactly one rate-limited door rather than the whole API.
**Alternatives considered**: (a) `multer` + multipart — rejected: a new dependency, a second body-parsing path, and every other route's validation would have to learn about a request shape it never sees. (b) A separate upload endpoint after registration — rejected: the photo is mandatory, so an account could exist without one whenever the second request failed, and something would then have to reconcile that. (c) Raising the global JSON limit — rejected: it widens the attack surface of every endpoint to solve a problem on one.
**Consequences**: Base64 inflates the payload by about a third, so a 2 MB photo travels as ~2.7 MB — comfortably inside Vercel's 4.5 MB request limit, but that limit, not the 2 MB rule, is the real ceiling and would bite first if the cap were ever raised. Because the client controls the declared MIME type, the validator checks the decoded bytes' **magic bytes** against it. If the photo write fails after the account is created, the account is deleted again rather than left photo-less: there is no transaction available (the local test database is a single node), so a compensating delete is the honest substitute.

---

## 2026-08-05 — New registration fields are required on creation only

**Decision**: The nine registration fields added in Milestone 4 are declared `required: function () { return this.isNew }` on the `Student` schema, rather than plainly `required: true`.
**Reason**: Registration is the only path that creates a `Student`, and its zod schema already rejects a missing field with a 400 — so the database-level requirement adds nothing for new accounts, but plainly-required fields would break *existing* ones. Accounts created before this change do not have the fields, and Mongoose validates the whole document on `save()`: suspending or promoting a legacy account would have failed on data the administrator never touched. This is the same class of problem already recorded for `Student.email` in `TROUBLESHOOTING.md`, and worth not repeating nine more times.
**Alternatives considered**: (a) Plain `required: true` plus a migration script — rejected for now: there is no migration tooling in the project, and the failure mode until one exists is an admin panel that errors on old accounts. (b) No database-level requirement at all — rejected: it would leave the schema silent about what a valid new account is, and the constraint is free where it matters. (c) Backfilling placeholder values — rejected: inventing a father's name or a date of birth puts fiction in the record.
**Consequences**: A legacy account reads back with these fields `undefined`, so every API view of them is explicitly nullable and the admin table renders `—`. A test writes a pre-Milestone-4 document straight to the collection and asserts an admin can still suspend it. If a backfill ever happens, the `isNew` scoping can be tightened to a plain `required` in the same change.

---

## 2026-08-05 — Topics and subtopics are one self-referencing collection

**Decision**: `Topic` holds both topics and subtopics, distinguished by a nullable `parent` pointing at another `Topic` in the same subject. `depth` (0 or 1) is derived from `parent` by the service layer and capped at `MAX_TOPIC_DEPTH = 1`. There is no `Subtopic` model.
**Reason**: a separate collection would duplicate every field, every index and every query, and "list everything under this subject" would become two queries and a merge instead of one `find`. A self-reference also means the depth limit is a constant rather than a structural fact, so raising it later is a change to one number and the admin form.
**Alternatives considered**: (a) A separate `Subtopic` collection — rejected for the duplication above. (b) An unbounded materialised-path tree — rejected as speculative: nothing in the syllabus needs three levels, and an arbitrary-depth tree makes both the admin UI and the question form materially harder to get right for no present benefit. (c) An array of subtopic strings on `Topic` — rejected because a question needs to *reference* a subtopic, and a string in an array has no stable id to reference.
**Consequences**: uniqueness has to be scoped (`subject + parent + slug`) rather than global, which is also what makes "Fractions" legitimately exist under both Arithmetic and Algebra. The service must check that a subtopic's parent belongs to the stated subject, because Mongoose refs are not foreign keys and a mismatch would produce a question no filter could ever find. Archiving is refused while published questions reference the entry as either `topic` or `subtopic`.

---

## 2026-08-05 — Mathematics is LaTeX in plain text, rendered by KaTeX with the text/math split

**Decision**: question content is stored as plain text containing LaTeX islands (`$…$` inline, `$$…$$` display). The frontend splits that text and renders prose as React text nodes while handing only the LaTeX to KaTeX (`trust: false`). The backend independently validates the same grammar at write time and rejects link, file-inclusion and macro-definition commands. Added `katex` (MIT, ~260 KB) as a frontend dependency.
**Reason**: "represented safely and correctly" needs both halves. *Correctly* means real typesetting — a maths olympiad cannot show `rac{-b \pm \sqrt{\Delta}}{2a}` as literal source. *Safely* means author-controlled text must never reach an HTML sink, which the split guarantees structurally rather than by sanitising: React escapes the prose, and the only HTML inserted is KaTeX's own output from a restricted grammar. Validating at the storage boundary as well means a future export or PDF generator inherits the guarantee instead of re-deriving it.
**Alternatives considered**: (a) Store HTML from a rich-text editor and sanitise on render — rejected: it makes every consumer responsible for sanitisation forever, and one missed sink is an XSS. (b) MathJax — rejected: much larger, and its default configuration is more permissive about the commands we specifically forbid. (c) Store LaTeX but display it as monospace source — safe and cheap, but not *correct*; the owner asked for both. (d) Render maths to images server-side — rejected: needs a TeX toolchain, which breaks the ₹0 and serverless constraints.
**Consequences**: KaTeX would have added ~300 KB to the initial bundle, so the question-bank routes are lazy-loaded via `React.lazy` and KaTeX lands in a separate chunk — the main bundle is unchanged at ~476 KB. Two parsers now exist for the same grammar (`lib/mathContent.ts` and `MathText.tsx`); both are a single left-to-right scan with no nesting *precisely* so they can be verified against each other by reading them, and a change to one must be mirrored. The two differ in one deliberate way: the frontend treats an unclosed delimiter as literal text so a half-typed formula still previews, while the backend refuses to save it.

---

## 2026-08-05 — Archive-first removal, with hard delete only for never-published questions

**Decision**: `archived` is a question status and the normal removal path, and it is reversible (`archived → draft`). `DELETE` exists but is refused for any question that is currently published *or* whose `publishedAt` is set, even if it has since returned to draft. It needs a separate `questions:delete` permission.
**Reason**: once a question has been visible to students it may have been answered, and deleting it would orphan the attempt that references it — with no way to reconstruct what the student saw. But a mistyped draft should not have to be kept forever, so a narrow delete is worth having. `publishedAt` is the witness, and it is deliberately *not* cleared on a return to draft: clearing it would let anyone sidestep the guard by unpublishing first and then deleting.
**Alternatives considered**: (a) No delete at all, as with accounts — defensible, and nearly chosen; rejected only because question drafts are created far more casually than accounts and accumulate faster. (b) A `deletedAt` soft-delete flag in addition to `archived` — rejected: two mechanisms for "not visible" is one more than the reader can keep straight, and `archived` already means it. (c) Cascade deletion of dependent attempt data — rejected: destroying a student's record to tidy the question bank is the wrong trade.
**Consequences**: `publishedAt` is documented as historical rather than current state, with `status` as the authority on visibility — a distinction that has to be stated because the field name suggests otherwise. The admin UI only offers a Delete button for a draft with no `publishedAt`, mirroring the server rule so the button is never a dead end.

---

## 2026-08-05 — A `services/` layer between routes and models

**Decision**: added `backend/src/services/` (`questionService.ts`, `taxonomyService.ts`). Route handlers do HTTP — parse, authorize, shape a response — and the services own the rules. Services signal refusals by throwing `ApiError`, which `lib/serviceError.ts` maps to the envelope.
**Reason**: the question bank's rules are the first in this codebase that more than one route needs. That a topic must belong to the stated subject is required by create *and* update; the status transition table is needed by the status route and implicitly by delete. Inlining them would mean two copies, and a copy that drifts is a silent data-integrity bug rather than a visible failure. It also keeps handlers readable at the size the rest of the codebase expects.
**Alternatives considered**: (a) Keep the logic in the route files, as Milestones 1–3 did — that was right when each rule had exactly one caller; it stops being right here. (b) Mongoose statics and middleware — rejected: the cross-document checks need to query other collections and return good error messages, which schema hooks do badly. (c) A full repository pattern abstracting Mongoose — rejected as ceremony with no present payoff.
**Consequences**: `CLAUDE.md`'s folder list gains a directory. Throwing `ApiError` from a service means a handler that forgets to catch would surface a 500, so every handler routes through `respondToServiceError`, which passes an `ApiError` through and logs anything else as a genuine bug — the distinction that stops a real fault being flattened into a tidy 4xx.

---

## 2026-08-10 — XP, levels and streaks are derived from an activity log, never stored as counters

**Decision**: Milestone 5 added one new collection, `StudentActivity`, an append-only log of real student events carrying the XP each was worth at the time. Total XP is a `$sum` over that collection, the level is a pure function of the total (`lib/xp.ts`), and the streak is computed from the distinct days the collection contains. There is **no** `StudentProgress` document and no stored `xp` field anywhere.
**Reason**: this milestone's actual requirement was "do not display fake statistics". A denormalised counter is the standard way that requirement gets broken — not by anyone inventing a number, but by a counter drifting from the events behind it until it shows a figure nobody can account for. With one source of truth every number on the dashboard traces to rows a person can read, and "why do I have 60 XP?" has an exact answer. It also removes a class of bug outright: there is no increment to double-apply and no counter to keep in step.
**Alternatives considered**: (a) A `StudentProgress` document with counters updated on each event — the conventional choice, rejected for the drift reason above; it is the right change *later*, as a cache, once read cost actually matters. (b) Storing the level alongside the XP — rejected: it is a function of the XP, so storing it creates a second thing that can disagree. (c) Deriving XP but storing the streak, since the streak needs day arithmetic — rejected as an inconsistent half-measure; `distinct('occurredOn')` is bounded by days active, not by event count, so it stays small.
**Consequences**: one aggregation per dashboard load, plus a pair for the leaderboard, which groups the whole collection. That is correct for a first cohort of a few hundred (photo storage caps it near 250 anyway) and is isolated in `leaderboardPipeline()`, the one place to change if the field grows an order of magnitude. Re-pricing an event later does not restate history, because `xpAwarded` is copied at write time — the same reasoning as `AuditLog.actorRole`.

---

## 2026-08-10 — XP is earned only from events that really happen, so the sources are deliberately few

**Decision**: XP accrues from exactly three events today — `account_created` (50), `email_verified` (50) and `daily_visit` (10, once per competition day). `profile_updated`, `photo_updated` and `password_changed` appear on the feed but are worth **0**. There is no exam XP, because no exam attempt is recorded anywhere in the product.
**Reason**: chosen by the project owner when the alternative — showing 0 XP everywhere until the exam milestone — was put to them. Each of the three is a real, dated, verifiable event, so a new student's 110 XP is a true statement about things they did rather than an encouraging fiction. The zeros matter as much as the awards: editing a profile is repeatable at will, so paying for it would make XP a measure of how often you pressed Save, and the leaderboard sortable by fidgeting.
**Alternatives considered**: (a) Exam XP only — honest, but leaves the entire progress panel empty for an unknown number of months. (b) Account milestones without the daily visit — rejected because nothing would then record per-day presence, so the streak would have to be dropped rather than merely read zero. (c) XP for profile completeness — rejected: registration already makes every field mandatory, so it would pay everyone equally for nothing.
**Consequences**: the top of the leaderboard currently measures consistency, not ability, and will until exam scores exist — worth stating plainly to entrants before the competition runs. Adding exam XP is an entry in `ACTIVITY_TYPES` and `XP_AWARDS`, not new machinery. Achievements follow the same rule: no exam or accuracy achievement is listed, because a permanently unearnable row with a bar that can never move is a fake statistic wearing a lock icon.

---

## 2026-08-10 — The competition day is an IST calendar day, not a UTC one

**Decision**: `lib/competitionDay.ts` defines a day as a calendar day in Indian Standard Time, implemented as a fixed UTC+05:30 offset with no timezone database. Every activity row stores `occurredOn` as that `YYYY-MM-DD` key.
**Reason**: a streak counts consecutive days, so something must decide when a day ends, and UTC gets it wrong for these users: a student practising at 00:30 IST would have the visit filed under the previous UTC day and see a streak they had in fact kept reported as broken. IST observes no daylight saving, which is precisely what makes a plain fixed offset correct rather than an approximation — and it keeps the ₹0 dependency budget intact.
**Alternatives considered**: (a) UTC days — simplest, and wrong by five and a half hours for every entrant. (b) A per-student timezone — rejected: this is a national Indian competition, and a streak meaning different things for different students is not comparable on a leaderboard. (c) `Intl` or a tz library — unnecessary while the zone has no DST, and one more dependency to audit.
**Consequences**: if the competition ever runs somewhere that observes DST, `competitionDay.ts` is the only module that changes — everything else speaks solely in the opaque keys it returns. Stored keys are timezone-tagged by convention only, which makes that module's comment load-bearing documentation.

---

## 2026-08-10 — Self-service profile editing excludes the email address and mobile number

**Decision**: `PATCH /api/v1/me/profile` accepts the nine descriptive registration fields. `email` and `mobile` are shown on the profile page as read-only with an explanation, and are absent from the zod schema entirely.
**Reason**: both are unique login identifiers, and `email` additionally anchors email verification and password reset. Letting a student set an address in one request creates an account-takeover primitive: change the address, then use "forgot password". Doing it safely needs a confirm-at-the-new-address flow — issue a token to the *new* address, switch only on redemption — which is its own piece of work. Offering a field that cannot be made safe in this milestone would be worse than not offering it.
**Alternatives considered**: (a) Allow the change and re-send verification, reverting on failure — rejected: the account sits in an ambiguous state in between and the reset path is open throughout. (b) Allow only the mobile number, which anchors nothing — rejected as an inconsistency that still needs uniqueness handling for no real gain. (c) Route the change through an administrator — plausible, and left for the owner to ask for rather than built on speculation.
**Consequences**: a student with a typo'd address still cannot fix it themselves; the page tells them to contact the organisers. Omitting the fields from the *schema* rather than filtering them in the handler is what makes it safe — `validate` replaces the body with the parse result, so extra keys cannot reach the update. A test sends `email`, `mobile`, `studentId`, `role`, `status`, `isEmailVerified` and `tokenVersion` and asserts none of them changes.

---

## 2026-08-10 — The public leaderboard publishes a first name and a last initial

**Decision**: `GET /api/v1/leaderboard` is readable without signing in — an explicit decision by the project owner, taken so the landing page shows a real standing instead of the invented one it carried. Names are rendered by `displayNameFor()` as a first name plus a last initial ("Ishaan V."), alongside class, school and XP.
**Reason**: the owner chose a real public leaderboard over keeping the fake one or deleting the section. The masking is this implementation's own addition: the entrants are children in classes 5–12 and the landing page is public and indexable, so a full legal name beside a school and a class would identify a minor to anyone on the internet. The masked form is still real, still ranked, and still recognisable to the student — the dashboard additionally labels the caller's own row "You".
**Alternatives considered**: (a) Full names, as a printed prize list would carry — the plain reading of the owner's choice, and a one-line change in `displayNameFor`; not taken by default because the safer form loses nothing the section needs. (b) Requiring a session to read it — defeats the purpose of the landing-page section. (c) Student IDs only — rejected: `AMIT_3028` is not something to celebrate.
**Consequences**: `limit` is validated and capped at 50, so the endpoint returns a leaderboard rather than an enumerable roll; suspended and deactivated accounts are excluded by a `$lookup` that runs *before* the `$limit`, so a suspended account cannot silently consume a place in the top ten; a student with no XP is genuinely unranked (`rank: null`) rather than listed last. Widening the name format is the owner's call and one function to change. Tests assert the full name, email address and mobile number do not appear in the response.

---

## 2026-08-10 — A student's edit of their own account is written to the administrative audit trail

**Decision**: three audit actions were added — `student.profile.updated`, `student.photo.updated`, `student.password.changed` — recorded when the account's *own owner* makes the change. Metadata names the fields that changed, never their values.
**Reason**: `CLAUDE.md` requires any route that changes an account to call `recordAudit`, and the rule is worth keeping literal rather than carving out a self-service exception: the trail exists to answer "who changed this school name, and when?", and "the student did, last Tuesday" is a valid and useful answer. An unexpected password change is also what a compromised account looks like — exactly what the trail should make visible.
**Alternatives considered**: (a) Record nothing, treating the trail as administrative-only — rejected; it would leave a gap precisely where account data changes most often. (b) Record before/after values, as a change log would — rejected on privacy grounds: the trail is readable by anyone holding `audit:read`, and a student's home address and date of birth must not be copied into it. A test asserts the address value is absent from the entry.
**Consequences**: the audit list is noisier than before, so the admin page's action filter matters more; three new labels were added there. Volume is bounded by the new per-route limiter (20/hour).

---

## 2026-08-11 — Surfaces that cannot yet have real data show an empty state, never a placeholder

**Decision**: every remaining piece of fabricated data was removed rather than relabelled. The result portal, certificate page, exam paper, student report, analytics page and admin chart now each query the real collection and render an explicit empty state when it is empty. Nothing anywhere returns a hardcoded figure, including things previously *labelled* as sample data.
**Reason**: the project owner's instruction was "no fake stats, strictly", and the audit found that a labelled invention is still an invention — the admin dashboard's "Weekly Accuracy Trend (sample data)" was the clearest case, an accuracy trend for a competition where no answer has ever been scored. Two of the finds were worse than decoration: the result portal *computed* a score, national rank and percentile from a hash of whatever ID was typed, publicly, and the certificate page printed an achievement award for anyone signed in. A parent could have believed either.
**Alternatives considered**: (a) Keep them behind a clearer "demo" label — rejected; the label is not what a user takes away from a printed certificate or a percentile. (b) Hide the pages entirely until the exam exists — rejected: the pages answer a real question ("is my result out yet?") and an honest "not yet" answers it. (c) Return hardcoded empty arrays from the frontend without an endpoint — rejected, and this is the subtle one: a hardcoded `[]` is something a human has to remember to replace later, whereas a live query against an empty collection starts working by itself.
**Consequences**: several pages are visibly emptier than before, which is the point. Each empty state says *why* it is empty and what will fill it, because "no data" and "not measured yet" are different messages. `services/resultService.ts` centralises the lookups. The result portal is public, so it deliberately answers identically for "no such account" and "no published result" — otherwise it becomes a student-ID enumerator — and only ever exposes `isPublished` results, so marks cannot be read before release.

---

## 2026-08-11 — One global theme, light by default, applied to the document element

**Decision**: a `ThemeContext` toggles a single `theme-dark` class on `document.documentElement`, persisted in `localStorage`, defaulting to **light**. The per-page `theme-dark` classes on the dashboard, admin shell and admin login are removed. A `ThemeToggle` appears in all three shells.
**Reason**: the app was inconsistent — public pages light, interior pages hardcoded dark — so signing in changed the colour scheme underneath the user, and the admin sign-in form was dark beneath a light navbar. Applying the theme once, at the document root, is what makes that impossible to reintroduce: a new page inherits it and cannot forget to opt in, and no two pages can disagree. Light as the default was the owner's explicit choice.
**Alternatives considered**: (a) Follow `prefers-color-scheme` — rejected on the owner's instruction, and it would mean two users seeing different colours with no shared baseline for screenshots or support. (b) A per-page or per-route theme — that is what was already there, and what caused the problem. (c) Storing the preference on the account — rejected: the theme is a per-device display preference, not account data, and it would then require a session to work at all on the public pages.
**Consequences**: the background is painted on `html`, `body` **and** `#root` — belt and braces, because relying on body's background propagating to the canvas holds only while `html` has no background of its own, and pages without a full-height wrapper would otherwise show dark cards on a light canvas. All hardcoded `#fff` in the previously dark-only stylesheets were checked and sit on saturated backgrounds, so they stay correct in light mode. Live switching could not be visually confirmed in the preview browser, which does not invalidate `var()` substitutions on a runtime custom-property change — an engine artifact, not a CSS fault (a fresh element picks up the new value while existing ones do not, and even an inline write on the root fails); the load path is correct in both themes and the standards-correct implementation was kept rather than hacked around.

---

## 2026-08-11 — Practice is its own collection, not a reuse of `ExamAttempt`

**Decision**: Milestone 6 introduced a new `PracticeSession` collection. `ExamAttempt` and `Result` are left alone for the official Olympiad.
**Reason**: they describe different things. Practice is unlimited, self-selected by subject and topic, and must never influence a ranking; the official exam is one marked, ranked sitting that produces a published result and a certificate. Sharing a collection would mean every query about official performance had to remember to exclude practice rows — and the first one that forgot would award a national rank for a practice run. The dashboard's test-performance panel and the result portal both already query for official attempts, so the failure would have been silent and in production.
**Alternatives considered**: (a) One collection with a `kind: 'practice' | 'official'` discriminator — rejected for the reason above: it makes correctness depend on every future caller remembering a filter. (b) Rewriting `ExamAttempt` now to serve both — rejected as scope: that model needs rewriting anyway (it stores a single `selectedOption` string, so it cannot represent a multiple-choice answer at all), and doing it as a side effect of the Practice Zone would have coupled two milestones.
**Consequences**: two collections with a similar shape, which is real duplication. It buys the guarantee that no practice attempt can ever be mistaken for an official one. When the official exam lands it should be written against the current `Question` model rather than the pre-Milestone-4 shape `ExamAttempt` still has.

---

## 2026-08-11 — A practice session snapshots the answer key when it serves a question

**Decision**: each question in a `PracticeSession` stores a copy of what counts as correct — the correct option keys, the boolean or numeric answer and its tolerance, plus the marks, negative marks and the question's `revision` — taken at the moment it was served. Grading uses the snapshot, not the live `Question`.
**Reason**: an author can edit or archive a question while a session is open. Grading against the live document would mark a student against a question they were never shown, and if the edit changed the answer *shape* (say choice to numeric) grading would fail outright. Recording `revision` also lets the review tell the student the question has changed since they answered it, instead of silently showing different text above their old answer.
**Alternatives considered**: (a) Re-read the `Question` at submit time — simpler and avoids duplicating the key, but wrong for the reason above. (b) Forbid editing a published question while any session references it — rejected: it would let one abandoned session block an urgently needed correction.
**Consequences**: the answer key now exists in a second collection, so projection discipline matters more, not less. `practiceService.ts` therefore builds two explicit views and never returns a raw document, `sessionReviewView()` throws unless the session is submitted, and tests assert the forbidden field names are absent from whole in-progress response bodies rather than checking one field at a time.

---

## 2026-08-11 — Practice XP is once per day, not once per session

**Decision**: submitting a practice session with at least one answered question records `practice_completed` (25 XP), deduplicated by competition day through the existing partial unique index. Further sessions the same day are stored in full but earn no more XP.
**Reason**: XP feeds a public leaderboard, so it has to resist farming. Paying per session would be trivially farmable — start, submit empty, repeat. Paying per correct answer is the fairest measure but would need its own daily cap to resist the same attack, which means new machinery; keying on the day reuses the index that already makes `daily_visit` race-free across concurrent serverless invocations.
**Alternatives considered**: (a) XP per correct answer with a daily ceiling — better signal, more moving parts; worth revisiting when official exam scoring lands and ability is measured properly there. (b) No XP for practice at all — rejected: practice is the first thing on this platform that involves actually answering questions, and it would have been odd for the one genuinely effortful action to be worth nothing.
**Consequences**: XP still measures consistency more than ability, which remains recorded as a known limitation. A student who practises hard for one day and not again is not distinguished from one who practised lightly. Empty submissions earn nothing at all, which is asserted by test.

---

## 2026-08-11 — Unanswered practice questions are never penalised, and multiple choice needs the exact set

**Decision**: a question with no response scores 0 and no negative marks. `multiple_choice` is correct only when the chosen set exactly equals the correct set — no partial credit. A wrong answer costs `negativeMarks`, so a session score may be negative and is reported unclamped.
**Reason**: a blank is not a wrong answer; penalising it would push students to guess, which is the opposite of what practice is for. Partial credit sounds kinder but needs a second policy — how much to deduct for a partially-right answer under negative marking — and the question bank has no field to express it, so any rule would have been invented here rather than authored per question.
**Alternatives considered**: clamping the displayed score at zero — rejected, because a negative total is the honest consequence of negative marking and hiding it would misrepresent the arithmetic the student is being taught.
**Consequences**: accuracy is reported over *answered* questions rather than over the paper, so skipping is not punished twice; the unanswered count is shown next to it so the figure cannot flatter by omission. Adding partial credit later means adding a field to `Question` first.

---

## 2026-08-11 — Resolve `.env` from the package root, and make write scripts refuse an unintended database

**Decision**: `config/env.ts` resolves `backend/.env` from its own directory (`path.resolve(__dirname, '..', '..', '.env')`) rather than calling a bare `dotenv.config()`. Separately, every script that writes to the database calls `assertConfiguredForWrites()` (`lib/envGuard.ts`) as its first statement, which prints the target database and exits non-zero rather than writing to a local one without an explicit `--local`.

**Reason**: a seed run reported "Published: 208" while writing to a local database, leaving production empty. `dotenv.config()` searches `process.cwd()`, so running the script from `backend/scripts/` instead of `backend/` found no `.env`, loaded **zero** variables, and every setting fell back to its default — including `MONGO_URI`, which defaults to `mongodb://localhost:27017/...`. The script then behaved perfectly, for the wrong database, and said nothing. The root cause is that sensible defaults, which make `npm test` and first-run local development pleasant, also make a misconfigured script silently successful.

**Alternatives considered**:
- *(a) Remove the `MONGO_URI` default so it must always be set.* Rejected: it would break the zero-configuration local start that `dev:local` and the test suite depend on, and it addresses only this one variable — `JWT_SECRET` and the SMTP group have the same shape of problem.
- *(b) Only fix the path resolution.* Rejected as insufficient. It fixes the reported case but not a mistyped URI, a genuinely absent `.env`, or a deliberate override pointing somewhere unintended. The guard is cheap and covers all of them.
- *(c) Require an interactive "type the database name to confirm" prompt.* Rejected: these scripts need to be runnable non-interactively, and a prompt that is always answered the same way stops being read.
- *(d) Make the guard a warning rather than a hard stop.* Rejected — the original failure was precisely a warning nobody noticed (`injected env (0)` was right there in the output, as were `JWT_SECRET is not set` and `SMTP is not configured`). A warning in a wall of log lines is not a control.

**Consequences**: `__dirname` is used rather than `import.meta.url`, because this package compiles to CommonJS where `import.meta` is a syntax error — `tsx` tolerates both, so that mistake would have surfaced only at `npm run compile`, i.e. on the Vercel build. Scripts now print `Target database` and `Loaded .env` before doing anything, which is the line to read first when a run goes wrong. Local development against a local database now needs `--local` on the write scripts, which is mild friction accepted deliberately in exchange for the production case being safe by default. `config/env.ts` also exports `envFileLoaded`, the first thing outside `config/` to depend on *how* configuration was obtained rather than just its values.

---

## 2026-08-12 — Mock tests are a third collection, not a variant of practice or of the official exam

**Decision**: Milestone 7 introduced `MockTest` (the paper an author assembles) and `MockTestAttempt` (one student's sitting of it). `PracticeSession` is untouched, and `ExamAttempt` / `Result` remain reserved for the official Olympiad.

**Reason**: three genuinely different things. Practice is unlimited, self-selected by subject and topic, untimed, and must never influence a ranking. A mock test is authored — the *staff* choose the questions, the marks, the clock and the window — sat a fixed number of times, and identical for everyone who sits it. The official Olympiad is one national sitting that produces a published result, a rank and a certificate. Expressing a mock test as a practice session would mean `filters` describing a choice the student never made, and `PracticeSession` acquiring `expiresAt`, `attemptNumber` and a disclosure policy that mean nothing for practice; expressing it as an `ExamAttempt` would put unofficial marks in the collection the result portal and the dashboard's official panel read.

**Alternatives considered**: (a) One attempt collection with a `kind` discriminator — rejected for the reason the Milestone 6 ADR gives about practice: correctness would depend on every future query remembering a filter, and the first one that forgot would show a mock score as an Olympiad result. (b) A `timed: boolean` plus a nullable `test` reference on `PracticeSession` — rejected: half its fields would then be meaningful in only one mode, which is the shape that invites a reader to use the wrong one.

**Consequences**: three collections with a family resemblance. What is deliberately **not** duplicated is the part where duplication would be dangerous: the served-question shape lives once in `models/attemptAnswer.ts` and the marking rules once in `services/grading.ts`, both shared by practice and mock tests, so there is exactly one definition of what counts as correct. `PracticeQuestionEntry` is now an alias of the shared `AttemptAnswerEntry`, and `practiceService.ts` re-exports `gradeEntry` / `isAnswered` so its own callers and tests were unchanged.

---

## 2026-08-12 — The attempt deadline is computed and stored by the server, and clamped to the closing time

**Decision**: `MockTestAttempt.expiresAt` is written once, when the attempt is created, as `startedAt + durationMinutes`, lowered to `availableTo` when the window shuts first. Every later decision — whether an answer may be saved, when the paper is graded, what time is recorded — reads that stored value against the server's own clock. No request body anywhere in the mock-test API carries a time, and an attempt cannot be started with under 60 seconds of window left.

**Reason**: "never trust the frontend timer" only means something if there is a server-side deadline to compare against. Storing it rather than recomputing it per request also protects the student: an author may lengthen or shorten `durationMinutes` while somebody is mid-paper, and recomputing would move the finishing line of an attempt already under way, in either direction. Clamping to the closing time is what stops a paper started five minutes before the window shuts from running an hour past the end of it; the 60-second floor exists because the alternative is handing a late arrival a 20-second attempt that also consumes their only try.

**Alternatives considered**: (a) Recompute `startedAt + duration` on every request — rejected for the mid-paper-edit problem above. (b) Accept a client-reported elapsed time and validate it loosely — rejected: that is the defect being avoided, and a loose bound is still a bound the client chooses. (c) Let a clamped attempt run its full duration past the closing time — rejected: the window is the point of a window.

**Consequences**: the client is *told* `secondsRemaining` and counts down from it, which is a display only — it re-syncs from every answer-save response, and derives its deadline as *now + secondsRemaining* rather than from the absolute `expiresAt`, so a wrong system clock still shows the right remaining time. When the countdown reaches zero the page submits, purely so the student sees their result without reloading; the server would grade the paper at its deadline regardless. A late answer is refused with 409 and **not stored** — not stored late, not stored and ignored at grading.

---

## 2026-08-12 — An expired attempt is finalised lazily, on the next touch, not by a scheduler

**Decision**: an attempt whose deadline has passed is graded the next time anything looks at it — the student returning to it, the student listing their attempts, or an administrator opening the results table, which sweeps that test's attempts before it aggregates. There is no background job.

**Reason**: the deployment target is Vercel's free tier, where there is no always-on process and no cron within the ₹0 constraint. Laziness costs nothing that matters **because grading uses `expiresAt`, not the moment of discovery**: an attempt finalised a week late is marked exactly as it would have been the second the clock ran out, with the same `submittedAt` and the same `timeTakenSeconds`. What had to be avoided is an expired attempt staying unmarked until somebody presses something, and sweeping on read achieves that for both audiences who could notice.

**Alternatives considered**: (a) A Vercel cron job — rejected: anything frequent needs a paid plan, and the free tier's daily schedule would leave a student's result unavailable for up to a day. (b) A sweep on server start-up — rejected: the serverless entry has no reliable start-up hook, which is the same reason `ensureDb` exists. (c) Grading at the moment of discovery rather than at the deadline — rejected: it would record a time taken longer than the test allowed.

**Consequences**: an attempt abandoned by a student who never returns stays `in_progress` in the database until somebody reads it. Nothing user-facing is wrong while it sits there — the student sees "unfinished" and staff see "in progress", both true — but a count of submitted attempts is only accurate after a read, which is why `testResults()` sweeps first rather than last.

---

## 2026-08-12 — Exactly one submission per attempt, enforced by a conditional write

**Decision**: `finalizeAttempt()` grades in memory and then closes the attempt with an update conditional on `status: 'in_progress'`, returning whether that write won (`graded`). A second submission — a double-clicked button, a retry, the countdown firing at the same moment as the button — receives the stored result with `alreadySubmitted: true`. Separately, a unique index on `{test, student, attemptNumber}` stops two requests racing to *start* an attempt from both creating one.

**Reason**: a read-then-write check ("is it still in progress? then grade it") is two round trips with a gap, and on a serverless platform the two halves can be in different invocations. Making the guard part of the write removes the gap. Reporting which call won is what lets the route award XP and write an audit entry only for the submission that actually did something — otherwise a retry would pay twice.

**Alternatives considered**: (a) A `submitted` boolean checked in the handler — rejected: that is the gap above. (b) A MongoDB transaction — rejected as heavier than needed; a single-document conditional update is atomic on its own, and transactions need a replica set that the local development database does not have. (c) Answering the loser with a 409 — rejected: from the student's point of view their paper *is* submitted, and an error would invite them to press again.

**Consequences**: submitting twice is idempotent rather than an error, so the client needs no guard of its own beyond a disabled button. The in-memory grades computed by the losing call are discarded and the stored document is re-read, because the copy in hand was produced by a call that did not win. Two tests cover this: sequential submissions, and genuinely concurrent ones through `Promise.all`, asserting one lot of XP.

---

## 2026-08-12 — When a student sees a score and when they see the answers are separate settings

**Decision**: `MockTest` carries `resultDisplay` (`immediate` / `after_close` / `hidden`) and `reviewPolicy` (`immediate` / `after_close` / `never`) independently. `disclosureFor()` is the only place either is interpreted, and `attemptReviewView()` — the only function that reveals a correct answer — refuses unless it says so. Both are read at request time and deliberately **not** snapshotted onto the attempt.

**Reason**: showing a mark and showing the answer key are different sizes of disclosure, and a real assessment commonly wants the first at once and the second only once nobody can still be sitting the paper — releasing the key while the window is open lets the first student to finish hand the answers to everyone who has not. Reading the policy live rather than snapshotting it is what lets an administrator release results after the window closes, or withdraw a review released too early; a snapshot would freeze that decision at the moment of submission, which is the one moment the author is not present for.

**Alternatives considered**: (a) A single `showResults` enum covering both — rejected: it cannot express "your mark now, the answers later", which is the most common real configuration. (b) Snapshotting the policy for auditability — rejected for the reason above; the audit trail records the author's changes instead. (c) Defaulting `reviewPolicy` to `after_close` because it is the safer policy — rejected as a *default* only: it requires a closing time to be relative to, so an otherwise complete request would fail on a field the author never sent. The default is `immediate`, and the form's help text recommends `after_close`.

**Consequences**: three shapes exist for a finished attempt — full review, score without answers, and submitted-with-nothing-released — so the API returns whichever the policy allows and the frontend has a three-member discriminated union. A withheld score is `null` in the history view too, not merely hidden by the page rendering it. Staff always see real marks on the admin results page: `resultDisplay` governs what a *student* is told, not whether the person who set the test may read their own cohort's results.

---

## 2026-08-12 — A paper and its clock freeze once anybody has sat it

**Decision**: `updateMockTest()` refuses a change to the question list, to any question's marks, or to `durationMinutes` once the test has attempts. Everything else — title, description, instructions, availability window, attempt limit, both disclosure settings — stays editable for the life of the test.

**Reason**: existing attempts snapshot their own paper, so their *marks* would stay correct — but the test's `totalMarks` and the meaning of "this test" would change underneath results already recorded against it, and two students' scores would stop being comparable while still sitting in the same results table and the same ranking. The editable half is exactly the set an administrator legitimately needs after publishing: extend a window, release results, fix a typo in the instructions.

**Alternatives considered**: (a) Allow the edit and re-grade existing attempts against the new paper — rejected: it would mark students on questions they were never shown. (b) Allow the edit and leave old attempts alone — rejected: that is the silent incomparability above. (c) Freeze everything once published — rejected: it would make releasing results after the fact impossible, which is a setting the product deliberately offers.

**Consequences**: changing a live paper means publishing a new test, which is the honest answer and leaves the old results intact. The admin detail endpoint reports `attemptsCount` so the editor can disable the frozen fields and explain why, rather than letting an author rearrange a paper and discover at Save that it was never going to be accepted. Unpublishing is deliberately *not* blocked, and does not disturb an attempt already under way — a student half-way through a paper an administrator pulls still finishes and is marked.

---

## 2026-08-12 — Mock-test XP is 50, once per competition day

**Decision**: submitting a graded mock test with at least one answered question earns `mock_test_completed`, worth 50 XP, at most once per IST calendar day.

**Reason**: the same anti-farming reasoning as `practice_completed` (25 XP, once per day), and worth more because it is a harder thing to do — a timed paper the student did not choose the questions for. Paying per attempt would reward starting papers rather than doing them, and most tests allow only one attempt anyway, so a per-attempt award would also make XP depend on how many tests staff happened to publish that week.

**Alternatives considered**: (a) XP proportional to the score — rejected for now: it is the right idea, and it is what the *official* exam should do, but doing it here would make a mock test worth more XP than the Olympiad it rehearses. (b) Once per test rather than once per day — rejected: it grows with the number of published tests, which is a staff decision rather than a student achievement.

**Consequences**: known bug #16 ("XP measures consistency more than ability") is narrowed again but not closed — a student who scores 40/40 earns the same 50 XP as one who scores 4/40. Official exam scoring is still what will measure ability properly. Extra mock tests on the same day are recorded in full as attempts; they simply do not multiply XP.

---

## 2026-08-12 — `npm run dev:local` sends no email and requires no verification

**Decision**: `scripts/dev-local.ts` now also points SMTP at a dead local port (`127.0.0.1:1025`) and sets `REQUIRE_EMAIL_VERIFICATION=false`, both with `??` so either can be overridden for a run that genuinely wants to exercise delivery.

**Reason**: the same reason the script already overrides `MONGO_URI` — the safe local default should not depend on anyone remembering. `backend/.env` holds **working** SMTP credentials and `dotenv` will not overwrite a variable that is already set, so registering a made-up address against the local database sent a real message through the owner's real provider, to whoever owns the address that was typed. `lib/email.ts` logs and swallows delivery failures by design, so a refused connection leaves registration working while nothing leaves the machine. Verification then has to be off, because with no email arriving there is no link to click and no way to sign in to a fresh local database.

**Alternatives considered**: (a) Document it and rely on the developer setting the variables — that *was* the state, and it is what produced the risk. (b) Make `SMTP_HOST` absent so the log transport prints the link instead — not achievable: the value comes from `.env`, and there is no way to make a variable *absent* from the environment before dotenv reads the file. (c) Add a local mail-catcher dependency — rejected against the ₹0 and no-new-dependency constraints; `npm run verify:email` already exists for testing delivery deliberately.

**Consequences**: a local registration is now a single step, which is what made the Milestone 7 browser verification possible without emailing a stranger. The trade-off is that delivery cannot be observed through `dev:local` at all — that is what `npm run verify:email` is for, and the start-up banner now says so in as many words.

---

## 2026-08-12 — A day's challenge is pinned to a document, not recomputed on every request

**Decision**: `DailyChallenge` is a real collection with one document per `{day, classLevel}`. A day nobody scheduled is **materialised on first request** — the deterministic pick is computed once, written, and served from then on. Every later read, and every attempt, refers to that document.

**Reason**: the previous implementation took `hash(day) % countOfPublishedQuestions` and `skip`ped that far into the bank on every request. That is stable only while the bank is, and the bank is not: **publishing a single question changed which question "today" was, mid-day, for every student in the class.** It also made a past day unrecoverable — "what was Tuesday's challenge?" could only be answered by re-running the hash against a bank that had since moved, which is to say it could not be answered. Once students can *answer* the challenge, both problems stop being cosmetic: an attempt has to refer to something fixed.

**Alternatives considered**: (a) Keep it computed and store only the question id on each attempt — fixes the attempt but not the "today changed under me" case, and still cannot say what a day was for a student who did not answer. (b) Require staff to schedule every day — rejected: the realistic outcome is a day nobody remembered, and a challenge feature that silently has no challenge on a Sunday. (c) Materialise a year ahead by cron — no scheduler on the free tier, and it would freeze the bank's future picks against today's contents.

**Consequences**: two students arriving in the same instant both compute the same question and both try to insert it, so the unique index on `{day, classLevel}` arbitrates and the loser re-reads the winner's row — which is *why* the automatic pick has to stay deterministic even though it is now persisted. The collection grows by one document per class per day (a few hundred rows a year) and never expires, because an attempt points at it. `source` records whether a day was chosen by staff or filled in, so the admin list can tell the two apart honestly.

---

## 2026-08-12 — The daily reward is guarded twice, by two different unique indexes

**Decision**: a student may hold at most one `DailyChallengeAttempt` per `{student, day}` (unique index), and `recordActivity()` independently caps `daily_challenge_completed` at once per competition day (the partial unique index on `StudentActivity`). A second submission returns the stored attempt with `alreadyAnswered: true` and **200, not 409**.

**Reason**: this is the one feature in the product whose entire purpose is a repeatable daily reward, so "claim it twice" is the obvious thing to try and must be impossible rather than discouraged. The two guards are independent — different collections, different keys, written at different moments — so a bug in either one is not a paid exploit. The 200 is deliberate: from the student's point of view they *have* answered today, and an error would read as "try again".

**Alternatives considered**: (a) The unique index alone, with the XP awarded unconditionally after it — one mechanism, and the XP path is the one that pays. (b) A read-then-write check ("has this student answered today?") — on the serverless path two concurrent requests can both pass it. (c) Answering the duplicate with 409 — rejected as above; the *effect* is what matters, and it is already correct.

**Consequences**: the response's top-level `xpAwarded` is what **this request** awarded and is 0 on a repeat, while the attempt's own `xpAwarded` stays as the record of what the first submission earned. That distinction was not academic: returning the attempt's figure let the UI show "+15 XP" every time the button was pressed, which is the half of a double claim a student would actually notice, and it is now covered by a test.

---

## 2026-08-12 — The daily challenge reveals immediately, and pays for answering rather than for being right

**Decision**: submitting reveals the correct answer and the author's explanation at once — there is no disclosure policy, unlike a mock test. The reward is `daily_challenge_completed`, 15 XP, once per competition day, awarded for a **graded submission regardless of correctness**. A blank submission is refused rather than stored. Negative marking is forced to 0 whatever the question carries.

**Reason**: the challenge is a teaching mechanic, not an assessment — one question a day, worth explaining while the student still remembers thinking about it. Withholding the explanation until some later window would defeat the only thing it is for. Paying for correctness on a single question would reward looking the answer up rather than working it out, and would make a student who thought hard and got it wrong worse off than one who did not try; measuring ability is the official exam's job (see the Milestone 6 and 7 ADRs). Refusing a blank keeps that honest without a special case in the reward path: there is no way to claim the day by pressing Submit on nothing.

**Alternatives considered**: (a) A second activity type for a correct answer, worth a bonus — workable and unfarmable, but it puts two rows in the feed for one event and starts making XP a partial measure of ability, which the exam should own. (b) XP proportional to the marks — breaks the invariant that `lib/xp.ts` is the only place an event's worth is stated. (c) Revealing only at end of day, like a newspaper puzzle — rejected: it would mean a student cannot learn from the question on the day they engaged with it, and the answer is already in their hands the moment they submit.

**Consequences**: correctness is recorded on the attempt, shown immediately, aggregated for staff, and counted by the challenge achievements — it simply is not what the XP is for. A wrong answer scores 0 rather than a negative, so the result screen never punishes taking part.

---

## 2026-08-12 — Challenges reach XP and achievements only through service seams

**Decision**: `dailyChallengeService` never writes a `StudentActivity` row and never states what an event is worth — the route calls `recordActivity()`. The achievement catalogue never reads the database — it declares two facts (`challengesCompleted`, `longestChallengeStreak`) on `ProgressFacts`, and `getChallengeFacts()` supplies them.

**Reason**: this is the same rule the codebase already applies to XP (`activityService` is the only writer, `lib/xp.ts` the only pricer) extended to a second direction. Without the seam, the natural implementation is a challenge service that inserts its own activity row with its own number and a catalogue that queries attempts directly — at which point "what is a challenge worth?" has two answers and the achievement rules can no longer be reviewed by reading one file.

**Alternatives considered**: (a) Let the challenge service award its own XP — one fewer indirection, and the exact drift `activityService` exists to prevent. (b) Let `lib/achievements.ts` query the attempt collection — it would turn a pure, synchronously testable rule set into an async one with a database dependency, and every achievement test would need a database.

**Consequences**: adding a challenge-based achievement means adding a fact to `ProgressFacts` and supplying it at the two call sites that build it — mildly repetitive, and the repetition is what keeps the catalogue pure. `NO_CHALLENGE_FACTS` exists for the callers that cannot read the history (no class, no database), so an achievement row shows an honest `0 / 1` rather than vanishing.

---

## 2026-08-13 — One reward engine: `grantReward()` is the only way anything earns XP

**Decision**: `services/rewardService.ts` is the single public entry point for granting a reward. Routes call it and nothing else; `recordActivity()` becomes the layer beneath it (still the only writer of a `StudentActivity` row) and is called by the engine and the backfill script only. Eligibility rules — "practice pays only if something was answered" — move out of the routes into a table in the engine. Callers supply *facts* about what happened (`context: { answeredCount }`), not decisions.

**Reason**: by Milestone 8 the pieces were right and the shape was wrong. Pricing was already centralised in `lib/xp.ts` and writing in `activityService`, but **five routes each decided for themselves whether an event deserved paying for**, with the rule inline next to the HTTP handling. Nothing was broken; a sixth surface would have written a sixth rule, and the answer to "when does practice pay?" would have lived in a route. The milestone brief said it plainly — do not calculate XP independently across controllers — and the honest reading of that is not just "don't compute amounts" but "don't decide entitlement either".

**Alternatives considered**: (a) Leave the eligibility `if`s in the routes and only centralise pricing — that was the status quo, and it is what a sixth surface would have copied. (b) Have the engine infer eligibility by reading the attempt collections itself — rejected: it would couple the reward engine to three attempt schemas, and the route already has the document in hand. (c) Pass a boolean `eligible` from the route — rejected as centralisation theatre: the decision would still be the route's, just spelled differently.

**Consequences**: `recordActivity` gained an optional `xpOverride`, passed only by the engine, which is the one loophole through which a caller could invent a number — so the rule is stated in the parameter's own doc comment rather than assumed. `touchDailyVisit()` moved to `grantDailyVisit()`. Twelve call sites changed and the full suite passed unchanged, which is the useful evidence that the refactor was behaviour-preserving. Idempotency deliberately stayed *below* the engine, in the partial unique index: a check inside `grantReward` would be a read-then-write across two serverless invocations, which is exactly the race the index exists to lose safely.

---

## 2026-08-13 — Badges are tiered families; achievements are one-off goals

**Decision**: badges become a distinct concept from achievements. A **badge** is a family held at a tier (bronze / silver / gold) that keeps levelling as the student does more of the same thing; an **achievement** is a one-off goal that is earned once and stops changing. Five badge families, ten achievements, both derived from the same facts.

**Reason**: `FEATURE_STATUS.md` recorded badges as "delivered as Achievements", which was honest but meant the product listed one idea under two names. Milestone 9 asked for both, and two names for one list is not two features. Making them genuinely different gives each a job: achievements answer *what have I done*, badges answer *how far along am I*. A student with ten practice sessions has one achievement and a silver Practitioner badge — those say different things, and the second keeps saying something new at 50.

**Alternatives considered**: (a) Keep one list and rename half of it — rejected; the split has to be real or it is a relabelling exercise. (b) Make badges awardable by staff — rejected: everything else in this product's progress system is derived from recorded events precisely so it cannot be granted by a bug or a favour, and a hand-awarded badge would be the one figure on the page nobody could explain. (c) Store held tiers on the student — rejected for the same reason XP is not stored: a counter that can disagree with the events behind it eventually does.

**Consequences**: a third catalogue, so `ProgressFacts` moved to `lib/rewardFacts.ts` as `RewardFacts` and is now shared by achievements, badges and the journey. All three stay pure functions of it, testable without a database — the boundary cases (a value *equal* to a threshold holds that tier; a value past gold does not overfill the bar) are unit tests over a plain object. Two new facts were needed, `practiceSessionsCompleted` and `mockTestsCompleted`, and adding a fact remains a deliberate two-step act.

---

## 2026-08-13 — The journey map is ordered, gated in presentation, and measured on cumulative facts

**Decision**: nine stages in a fixed order, exactly one marked `current` (the first incomplete one), each a pure predicate over `RewardFacts`. Stages measure **cumulative** facts — `longestStreak`, not `currentStreak`.

**Reason**: achievements and badges both answer questions about the past. Neither answers the one a new student actually has — *what should I do next?* — and that question has a right answer, because the product has an intended order: verify, practise where nothing is at stake, meet the daily habit, then sit a timed paper. Ordering the stages and highlighting exactly one is what turns a list into a route.

The cumulative-facts rule is the one real trap here and is worth stating: measuring "three days running" on the *current* streak would un-complete the stage the day a student missed. The map would walk backwards, which is not what a journey does and would read as the site taking something away.

**Alternatives considered**: (a) Hide stages ahead of the current one — rejected: seeing what is coming is most of the value, and the sequence is not a secret. (b) Hard-gate later stages so they cannot complete early — rejected: a student who sits a mock test before their first practice has genuinely done it, and telling them otherwise would be a lie in service of a diagram.

**Consequences**: `currentStageId` is null for a student who has finished the path, and the page says so rather than highlighting nothing. The stage list is code, so extending the journey when the official exam lands is a diff rather than a migration.

---

## 2026-08-13 — XP amounts are administrator-tunable; the rules are not

**Decision**: a single-document `RewardSettings` collection holds per-event XP overrides, editable at `/admin/reward-settings` under a new `rewards:write` permission, bounded to 0–500 per event. Which events exist, how often each may be earned, what makes one eligible and where the level thresholds fall all stay in code.

**Reason**: this is safe **only because of a decision made at Milestone 5** — `StudentActivity.xpAwarded` is a snapshot written at grant time, and a student's total is the sum of those recorded values. Re-pricing therefore cannot restate what anybody has already earned; it changes what the next event pays and nothing else. That property is what turns "let staff tune XP" from a way to silently rewrite history into an ordinary setting. It has its own test, and the admin page states it in a panel rather than a footnote, because an administrator who does not know it will either avoid the feature or misuse it.

The amounts/rules split is the other half. An amount is a balancing decision somebody might reasonably want to make on a Tuesday afternoon; a rule is something that should be reviewed in a diff. Making cardinality or eligibility configurable would put "can this be farmed?" behind a form.

**Alternatives considered**: (a) Configure the level thresholds too — rejected: they interact with every badge and achievement target, so a slider there silently moves a dozen other things. (b) Store the whole award table rather than overrides — rejected: adding a new activity type would then require editing the document before the event could ever pay, and forgetting would look like a bug in the new feature. (c) Cache the settings in-process — rejected: grants are rare, the read is one indexed document, and on serverless a per-container cache would buy nothing while making "why is it still paying the old amount?" a real question.

**Consequences**: one extra document read per grant, accepted deliberately. A settings read that fails falls back to the code table and logs, because a configuration outage must not stop a student being paid for work they did. An override is removed by clearing the box — the endpoint takes the whole set, so an absent key means "use the default", and there is no separate reset action to forget about.

---

## 2026-08-13 — Leaderboards stay derived; scope and period are filters, not variants

**Decision**: leaderboards remain an aggregation over `StudentActivity` with no stored standing, and the new scopes (overall / per class) and periods (all time / 30 / 7 / 1 competition days) are `$match` stages on that one pipeline. `services/leaderboardService.ts` is the only place a rank is decided; the ranking code moved out of `progressService.ts`.

**Reason**: this extends the Milestone 5 ADR ("no progress or leaderboard collection") rather than revisiting it. The temptation with class and period boards is to materialise them — five classes times four periods is twenty boards, and each looks like a candidate for a cached document. But a stored standing is a number that can disagree with the events behind it, and the whole requirement of this product is that no displayed figure is invented. Because a board *is* the sum of the same rows XP is derived from, a leaderboard cannot drift from the XP totals it claims to rank.

Putting it in its own service matters for a second reason: by Milestone 10 four surfaces show a standing (landing page, dashboard, the leaderboard page, the Hall of Fame's XP board). Two ranking implementations would eventually disagree, and a rank that disagrees with itself on two pages is worse than no rank at all — so the Hall of Fame's XP board calls `getLeaderboardPage()` rather than writing its own aggregation.

**Alternatives considered**: (a) A materialised `Leaderboard` collection refreshed on a schedule — rejected: the free tier has no scheduler (the same constraint that made mock-test expiry lazy), and a stale board is a wrong board. (b) Rolling time windows measured from `createdAt` — rejected in favour of competition days, so every student's "week" starts at the same instant and a window is a `$gte` on the day key an activity row already carries, with no timezone in the query. (c) Leaving ranking in `progressService.ts` — rejected: it had grown there as a corner of "the dashboard's figures", and scope, period and pagination are a subject of their own.

**Consequences**: the all-time overall board groups the whole activity collection on every request — correct at the scale this product is designed for (a few hundred students; photo storage caps it near 250) and isolated in one function, which is where a cache goes if a cohort ever outgrows it. Period boards are cheaper, because the new `{occurredOn: -1}` index narrows them before grouping. A page costs three aggregations.

---

## 2026-08-13 — Equal XP shares a rank; the order within a tie is deterministic

**Decision**: standard competition ranking — two students on the same XP hold the **same** rank, so a board reads 1, 2, 2, 4. The *order* in which tied students are listed is a total order: XP descending, then whoever reached that total first (`$max` of the counted rows' `createdAt`, ascending), then the account id ascending.

**Reason**: sharing a rank is the honest answer. They earned the same amount, and picking a winner between them would be exactly the kind of fabricated distinction this product does not ship — the same instinct that deleted the invented dashboard tiles in Milestone 5. `getStanding()` has computed rank as "one plus the number strictly ahead" since Milestone 5; this states it as the rule rather than leaving it as an implementation detail, and applies it to the listing too.

But a list still has an order, and "deterministic" is not optional. The second key is the only tie-break with a defensible meaning: of two students on 300 XP, the one who got there yesterday did it first. Sorting by name would advantage the alphabet; leaving it to Mongo's natural order would mean the same board reordered itself between two page loads. The third key exists because the second can itself tie — and without a final *unique* key, pagination can show a row on two pages or on none, which is a data-integrity bug that only appears once the cohort is big enough to page.

**Alternatives considered**: (a) A strict total order with no shared ranks (1, 2, 3, 4) — rejected: it would tell one of two equal students they came second, which is not true. (b) Dense ranking (1, 2, 2, 3) — rejected: it hides how many people are ahead of you, which is the number a rank is for. (c) `$setWindowFields` with `$rank` — it computes exactly this, but was rejected so the correctness of a student's rank does not depend on the MongoDB server version underneath it; the count-ahead approach is two extra `$count`s and works anywhere.

**Consequences**: a page's ranks are computed from one count-ahead plus a walk over the page, because the first row is the only one whose rank cannot be derived locally — a tie may straddle the page boundary. That case has its own test. A board can legitimately show six students at rank 6 and nothing at all at rank 7 through 11.

---

## 2026-08-13 — A signed-out visitor sees the top of the board, not all of it

**Decision**: `GET /leaderboard` stays public, and pagination is capped for an anonymous caller at the first 100 rows (403 beyond it). A signed-in student may page the whole board. Implemented with `attachUserIfPresent`, a middleware that attaches session claims when present and never rejects.

**Reason**: the leaderboard has been public since Milestone 5 by the owner's explicit decision, protected by three things: masked names, no contact details, and a 50-row cap that meant the endpoint returned *a leaderboard* rather than the roll. Pagination silently removes the third — fifty rows at a time, repeatedly, is the whole list. The entrants are children and the page is indexable, so the property had to be restored deliberately rather than lost as a side effect of a feature.

The asymmetry is the point. A signed-in student is already part of this list, and the one thing they most need is to find themselves in it, which requires paging to wherever they are. An anonymous visitor needs to see that the competition is real, which the top hundred shows.

**Alternatives considered**: (a) Require sign-in for the whole leaderboard — rejected: it would hide the competition from exactly the people it is meant to attract, and the landing page's champions section would have to go. (b) Cap page size instead of depth — that is what already existed, and it does not survive pagination. (c) A second, authenticated ranking endpoint — rejected: two ranking surfaces that could disagree, to express one difference in visibility.

**Consequences**: `attachUserIfPresent` is a new kind of middleware in this codebase and is easy to misuse. It grants nothing and must never be used as a gate: anything decided on the strength of `req.user` there is a *presentation* decision, and a capability decision still goes through `requirePermission`, which rejects and re-reads the role from the database. Its docblock says so.

---

## 2026-08-13 — The Hall of Fame measures achievement, not more XP

**Decision**: five boards in `services/hallOfFameService.ts` — XP champions, best mock-test paper (by percentage), longest streak, most correct daily challenges, most practice sessions submitted. A board with no data is returned empty with a reason. There is no official-exam board.

**Reason**: XP measures participation more than ability — a student who scores 40/40 on a mock test earns exactly what one who scores 4/40 earns (known bugs #16, #23, #29). A hall of fame that only re-ranked XP would therefore be the leaderboard with a nicer heading and would honour turning up rather than doing well. Three of the five boards measure performance instead, and each is a real, dated feat.

Several details follow from the same instinct. Papers rank by **percentage**, because 40/40 on a quiz and 40/80 on a final are not the same achievement. Only papers above zero appear, because negative marking makes 0% reachable and "0% of the paper" is not an honour. Streaks use `longest` and never `current`, so a broken run cannot withdraw something a student really did — the same reasoning the journey map's cumulative facts use. Challenges count **correct** answers, because the XP is paid for answering (right for a daily habit) and would otherwise be a third participation count. Practice counts **submitted** sessions, so the board cannot be filled by opening papers and walking away.

The absent exam board is the important omission. `ExamAttempt` and `Result` are read by the product and written by nothing, so a "national champions" board would be permanently empty at best and fabricated at worst. It belongs to the milestone that makes an official sitting exist.

**Alternatives considered**: (a) One board with a category filter — rejected: five things measured in five units read as one ranking, and a visitor would compare a percentage against a day count. (b) Storing a `HallOfFame` document per season — rejected for the same reason as the leaderboard, and there are no seasons yet. (c) Padding an empty board with the nearest thing available — rejected outright; that is the class of invention Milestone 5 spent a follow-up pass removing.

**Consequences**: the streak board loads one array of day keys per active student and computes runs in this process, using the same `summariseStreak()` the dashboard uses so the honoured number and the student's own page cannot disagree. Bounded by the cohort, and carrying the same scale note as the leaderboard. A brand-new deployment shows five empty boards and a panel saying every board is still open, which is true and is the intended first impression.

---

## 2026-08-13 — The super administrator gets a database account (reversing Milestone 3)

**Decision**: the root administrator is now a real `Student` document with `role: 'superadmin'`, auto-provisioned from `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` the first time it signs in. It holds a rotating refresh token, a `tokenVersion`, a `studentId` and a row in the account listing, exactly like every other account. `ADMIN_TOKEN_TTL` is removed. The `root: true` token claim is gone, and `resolveCurrentRole()` no longer has an exemption — **every** caller's role is now re-read from the database on a privileged request.

This directly reverses the Milestone 3 decision that the environment-configured account "remains the bootstrap root with no database document".

**Reason**: the document-less design kept the bootstrap trivially simple, and paid for it everywhere else. With no document there was no refresh token, so the session could not rotate, could not be revoked, and simply died after eight hours with nothing to renew it — which is what the owner reported as "my superadmin privileges are not working". There was no `tokenVersion`, so a leaked root token was valid until expiry and could not be withdrawn without editing an environment variable and redeploying. There was no `actor` id on its audit entries, so "everything the super admin ever did" was a string match on an email rather than a query. It could not appear in `/admin/users`, so the most privileged identity in the product was the only one nobody could see. And it had no password of its own, so rotating the credential meant a redeploy.

Every one of those is a consequence of the same missing row.

**Alternatives considered**: (a) Keep it document-less and give it a refresh token anyway — rejected: a refresh-token family is anchored to a student `_id`, so this means inventing a second, parallel session mechanism for one account. (b) A separate `Staff` collection — rejected for the same reason the Milestone 3 ADR rejected it: promoted admins are already `Student` documents, and splitting staff across two collections means every account query becomes two. (c) Provision it with a migration script instead of on sign-in — rejected as the *default* because it makes deployment a two-step operation with a lockout in the gap; auto-provisioning means the environment credentials keep working and the change needs no operator action.

**Consequences**, and the one that matters most: **`superadmin` is storable but still not assignable.** `ASSIGNABLE_ROLES` omits it, so no API call can mint a second one, and the only writer is the bootstrap. The escalation this opens up had to be closed explicitly in two places: `resolveRootSuperadmin()` adopts an existing document **only** if it already holds `superadmin` (never upgrading a student who happens to hold the address), and registration refuses `ADMIN_EMAIL` outright. Without both, anyone who learned the configured address could register it before the first administrative sign-in and then authenticate with their own password.

Three smaller consequences. `POST /auth/admin/login` now needs a database connection, where it used to answer from the environment alone — acceptable, because every privileged route already needs one to authorize, so a session created without a database could do nothing anyway. The super admin earns **no XP**: `grantReward()` refuses it, because XP is derived from `StudentActivity` and every leaderboard aggregates that same log, so a single daily-visit row would place a staff account on a public board above the children who competed. And `getAdminStats()` excludes it from student counts, since it never registered for anything.

---

## 2026-08-13 — An admin is strictly weaker than a super admin, structurally

**Decision**: `SUPERADMIN_PERMISSIONS` is defined as `[...ADMIN_PERMISSIONS, ...SUPERADMIN_ONLY_PERMISSIONS]`, and the super-admin-only list holds exactly two entries: `users:role:write` and `users:delete`. Admins gain `users:password:reset` and `users:sessions:revoke` alongside their existing capabilities. A data-level guard, `refuseIfProtected()`, additionally confines an admin to acting on plain `student` accounts and refuses everybody on a `superadmin`.

**Reason**: "an admin can do everything a super admin can, except…" is a property that decays. Written as two independent lists it stays true only for as long as everyone remembers to add each new permission to both, and the first divergence is silent. Defining the super admin as a *superset* makes the property structural: there is no second place to add a permission, so it cannot drift. A test asserts the subset relation by reading the table rather than a copied list.

The line itself is drawn at **reversibility**. Everything an admin may do can be undone — a suspension lifted, a status restored, a password reset again. The two withheld capabilities cannot: a role assignment can mint another administrator, and a deletion is final. Confining privilege escalation to the super admin is what stops a compromised admin session widening itself; confining deletion is what stops it erasing the evidence.

`refuseIfProtected()` exists because a permission gate answers "may you do this action", not "may you do it to *this account*". Without it, an admin holding `users:password:reset` could issue themselves a working credential for a peer administrator — a lateral move against the very people who could stop them.

**Alternatives considered**: (a) A numeric privilege level per role — rejected: it implies a total order that does not exist (a student is not "one below" an admin at everything) and it re-introduces role comparisons in handlers, which `lib/permissions.ts` exists to eliminate. (b) Letting admins delete unverified accounts too — rejected: deletion is the one act with no undo, and an abandoned registration is not urgent enough to widen who can destroy data. (c) Emailing a reset link instead of a temporary password — considered seriously and rejected by the owner: the entrants are schoolchildren who often cannot reach the address they registered with, which is exactly when they need help most.

**Consequences**: the temporary password is returned **once**, in the reset response, and never stored in readable form or written to the audit trail — the trail records that a reset happened and who did it. `mustChangePassword` then holds the account on a forced-change screen, and clears in exactly one place (the change-password route), so it cannot be dismissed by anything except actually changing the password. That screen is a *user-interface* gate, not a security boundary: the API remains reachable with the temporary password, as it is with any working credential. What it guarantees is that the ordinary way through the product ends in a password only the student knows.

---

## 2026-08-13 — Results and certificates stay unbuilt until an official exam exists

**Decision**: Milestone 12 completes twelve of the fourteen requested admin areas and deliberately **excludes results and certificates**. No admin console is built over `Result` or `ExamAttempt`, and `getPlatformAnalytics()` does not read either collection. The assessment figures on the analytics page come from `MockTestAttempt`, `PracticeSession` and `DailyChallengeAttempt` instead, and the page states in plain words why there are no official results on it.

**Reason**: both collections are **read by the product and written by nothing**. They belong to the official sitting, which has never been built. An administrative results console over them would be permanently empty at best, and at worst would invite exactly the failure this repository has already paid for once: the Milestone 5 follow-up pass existed to delete a result portal that hashed a typed student ID into a score, and a certificate page that printed "For outstanding participation and achievement" for anybody signed in, dated today. Nobody had earned anything.

Building a *second* surface over the same empty collections would re-create the conditions for that, with an administrator's authority behind it. The owner chose this explicitly when asked.

**Alternatives considered**: (a) Issue certificates against mock-test performance — genuinely real and available today, and the strongest of the three; rejected by the owner in favour of waiting for the official exam, so that a certificate means the thing its wording claims. (b) Let staff issue certificates manually with a free-text reason — real, but it makes a certificate an administrative artefact rather than an earned one, with no criteria to check it against. (c) Build the console now and let it render empty — rejected: an empty console is indistinguishable from a broken one, and it creates pressure to fill it.

**Consequences**: two of the fourteen areas remain openly unbuilt, and `FEATURE_STATUS.md` records them as such rather than as done. When the official exam lands, results and certificates are its natural first consumers, and `platformAnalyticsService.ts` carries a marked note where they belong. Until then the honest answer to "where are the results?" is that no exam has been sat.

---

## 2026-08-13 — A notification is one document with an audience rule, not a fan-out

**Decision**: `Notification` stores an audience *rule* (`all`, or a single `classLevel`) and is never expanded into per-recipient rows. A student's inbox is that rule evaluated at read time by `inboxFilter()`. Read state lives in a separate `NotificationRead` collection with a unique index on `{student, notification}`. Delivery is **in-app only** — nothing is emailed.

**Reason**: fanning out at publish time writes one document per student for a single announcement, and then silently misses everybody who registers afterwards — a notice board only the people already in the room can read. Evaluating the rule on read costs one indexed query and means a new student sees the announcement written yesterday, which is what a notice board does. Changing a student's class correctly changes what they see.

Read state cannot then live on the notification, because there is no per-recipient row to mark, and an array would be worse: an announcement to the whole roll would grow an unbounded `readBy` inside one 16 MB document, and marking one read would rewrite the entire thing. A row per pair is bounded, indexable, and exists only for notifications somebody actually opened. The unique index is what makes "mark as read" idempotent against a double-tapped button or two open tabs.

**Alternatives considered**: (a) Fan out to per-recipient rows at publish — rejected above. (b) `readBy: [ObjectId]` on the notification — rejected above. (c) Email as well as in-app — rejected by the owner: broadcasting to the whole roll is a deliverability and provider-limit problem on a free tier, and the addresses often belong to parents rather than the entrant. If email is added later it belongs *behind* this model, not as a second way of saying the same thing.

**Consequences**: "unread" is an **anti-join** (`_id: { $nin: readIds }`), not a filter, which is why `listInbox()` and `unreadCount()` share `inboxFilter()` — two definitions of unread would eventually disagree with the number on the bell. Deleting an announcement also deletes its receipts, because a receipt pointing at nothing would skew that anti-join for everybody who had read it.

---

## 2026-08-13 — The gallery stores image bytes in MongoDB, with a stated ceiling

**Decision**: `GalleryItem` holds the image as a `Buffer` in MongoDB, capped at **1 MB** per photo and validated by magic bytes through the shared `imageDataUrl()` validator. `data` is `select: false`, and one dedicated route serves bytes. Archiving stops the bytes being served, not merely the listing.

**Reason**: there is no object store, and adding one means a paid service against a ₹0 budget. `StudentPhoto` already established the pattern, so this is consistency rather than a new bet.

The ceiling is written down because it is real and countable rather than theoretical. Atlas's free tier is **512 MB in total**; registration photos are the biggest tenant at up to 2 MB each, which caps the roll near 250 students. Gallery images are bounded by nothing except staff enthusiasm, so at 1 MB each a hundred photos is ~100 MB — a fifth of the entire tier spent on decoration. `PROJECT_STATE.md` now records the gallery as the **second** thing that will force a paid tier or an image CDN.

**Alternatives considered**: (a) External image URLs pasted by staff — zero storage cost, rejected by the owner: it depends on links elsewhere staying alive, and a broken gallery looks worse than none. (b) A curated toppers wall built from leaderboard data with no uploads — real and free, but a different feature, not a gallery. (c) 2 MB to match registration photos — rejected: photos have a natural bound (one per entrant) and gallery images do not.

**Consequences**: `imageDataUrl()` was extracted from `authSchemas.ts` so registration and the gallery share one signature check. That mattered more than the deduplication: a second copy is how one of them ends up trusting the declared MIME type, which is exactly the hole magic-byte checking exists to close. The gallery image route sets `Cache-Control: public`, unlike a student photo's `private` — this content has no authorization behind it, so a shared cache is safe and wanted.

---

## 2026-08-13 — The official exam is its own collection, and `ExamAttempt`/`Result` were rewritten

**Decision**: the official Olympiad is a new `Exam` collection with a **mandatory** announced window, plus rewritten `ExamAttempt` and `Result`. It is not a `MockTest` with `maxAttempts: 1`. One attempt per student is enforced by a **unique index** on `{exam, student}`. Submitting grades the paper and shows no score; releasing results is a separate administrative act that computes ranks and mints certificates in one operation.

**Reason**: Milestone 12 recorded that `ExamAttempt` and `Result` were read by the product and written by nothing, and that certificates therefore could not be built. This milestone builds the exam so that they can be.

Expressing the sitting as a mock test would have been a lie in a field. Every mock test would then be one settings change away from minting certificates, and CLAUDE.md's rule that a mock is not the exam would live only in a comment. The separation is what makes "a certificate can only come from an official exam" true in the schema rather than intended by a handler.

The two rewrites were unavoidable rather than chosen. `ExamAttempt` predated Milestone 4: `studentId` was a plain string, `answers` was `{ questionId, selectedOption }`, and there was **no answer-key snapshot at all** — a shape the current grader cannot mark and that cannot survive a question being edited after the paper was served. `Result` referenced an `examId` string for a collection that did not exist. Neither had ever been written, so there were no documents to migrate.

**Alternatives considered**: (a) A flag on `MockTest` — rejected above. (b) Counting attempts in the handler instead of a unique index — rejected: on a serverless platform a read and its write can land in different invocations, so "count, then insert" has a race a unique index does not. (c) Showing the score on submission, as a mock test does — rejected: ranks are a cohort fact and cannot exist until the window closes, and a mark released before the organisers announce results is a leak.

**Consequences**: the window is **required** here where `MockTest.availableFrom`/`availableTo` are nullable — an exam with no announced timeline is not an exam. `deadlineFor()` takes the sooner of the duration and the window close, so starting five minutes before the close gives five minutes, not the full duration. Publication **sweeps expired attempts first**, so an abandoned paper is graded and ranked rather than silently excluded, which would otherwise flatter everybody else's rank. Equal scores **share** a rank (1, 2, 2, 4), the same rule the leaderboard uses. The paper is frozen once anybody has sat it: questions, duration and class become uneditable, while the window and thresholds stay editable, because releasing late or re-deciding a grade boundary do not rewrite what anyone sat. `snapshotOf()` moved to `services/attemptSnapshot.ts` so mock tests and the exam share one answer-key snapshot — two copies is how one of them ends up missing a key field, and a missing key field is a wrong mark on a student's report.

---

## 2026-08-13 — A certificate is a frozen snapshot, verified by a code that is not its serial

**Decision**: `Certificate` duplicates the name, class, school, exam, score, rank and thresholds that also live on `Student`, `Exam` and `Result`. Every printable field is **snapshotted at issuance** and the PDF is rendered from the snapshot alone. Certificates carry **two** identifiers: a readable serial (`AMIT-CERT-2026-000123`) and a separate 16-symbol `crypto` verification code, and public verification keys on the **code**. There is **no issuance route** — certificates are minted only by publishing an exam's results. Revocation never deletes. Tiers are participation / merit / distinction from **per-exam** thresholds.

**Reason**: a certificate is a statement about a moment — *this person, this paper, this score, this date*. Rendered by joining live documents, correcting a spelling in a student's name would silently reissue every certificate they hold with different text, and re-tuning an exam's merit threshold would change what a two-year-old certificate claims the holder achieved. Worse, verification would then confirm a document that no longer matches the one in somebody's hand.

The two identifiers exist because keying verification on the serial would be an **enumeration oracle**: anybody who noticed certificates are numbered sequentially could walk them and harvest the name, school and rank of every entrant. The serial is a reference, not a secret; the code is ~80 bits and is not walkable. Its alphabet omits `0`/`O` and `1`/`I`/`L`, because it is read off paper and typed by hand, and a misread code makes a genuine certificate look forged.

No issuance route is what answers the brief's "do not allow the frontend to manufacture certificate eligibility": the frontend cannot, because it is never asked. Neither can an administrator — there is no endpoint anywhere that takes a recipient.

**Alternatives considered**: (a) Render from live joins — rejected above. (b) One identifier for both purposes — rejected above. (c) Delete a bad certificate — rejected: a printed copy exists in the world regardless, and telling its holder "no such certificate" reads as a system fault rather than as a decision somebody made, so revoked reports as *revoked* with a mandatory reason. (d) Global merit thresholds — rejected: papers differ in difficulty, and 60% on one is not 60% on another. (e) Merit-only eligibility — rejected by the owner: a student who sat a national olympiad and did badly still sat it.

**Consequences**: `pdf-lib` is a new dependency, chosen because it is pure JavaScript with no native binary and no headless browser, so it works inside a Vercel serverless function on the free tier — the ₹0 constraint rules out both a rendering service and Puppeteer's ~300 MB Chromium. The **seal is drawn from primitives** rather than embedded, so there is no image asset to lose and it stays crisp at any scale; the **gold signature** is Times italic in `#D4AF37` rather than an embedded script font, avoiding another licensed binary in the repository. Issuance is idempotent through the unique index on `{student, exam}`, so republishing results cannot produce a second certificate for the same sitting. A revoked certificate cannot be downloaded again — continuing to hand out fresh copies would undermine the revocation entirely.

---

## 2026-08-13 — Email is queued in an outbox, never sent inside a request

**Decision**: every outbound email is written to a new `EmailOutbox` collection **before** anything attempts delivery. `enqueueEmail()` does one indexed insert and returns; `deliverEmail()` (which replaces `sendEmail()` and **throws** on failure) may be called only by `services/emailOutbox.ts`. Delivery is driven by an opportunistic, deliberately un-awaited kick at enqueue time plus a lazy sweep on later requests, and is also exposed to staff as an explicit "send now". A row is claimed by a **conditional write that pushes `nextAttemptAt` forward** — a visibility timeout — rather than by moving it to a `sending` status. Retries back off 1 min → 5 min → 30 min → 2 h and then fail terminally, keeping the row and the provider's error text.

**Reason**: the code this replaces awaited SMTP inline in registration and forgot-password and swallowed the failure. Two real defects followed. A registering student waited on a third-party handshake. And when that handshake failed the verification link was **destroyed** — no record, no retry, one log line — which, because login requires verification, means an account that can never be used and nobody able to find out why. A queue whose worker cannot detect failure is not a queue, which is why `deliverEmail()` had to start throwing before any of this could work.

There is no `sending` status because it becomes a lie on a serverless platform: a container frozen or recycled mid-send leaves the row in `sending` with nothing to move it, and the message never arrives. A visibility timeout degrades correctly — a crashed attempt simply becomes due again. The claim is a single conditional write for the same reason exam submission is: a read followed by a write has a window between them, and on serverless those halves can land in different invocations.

This also closed a live **timing oracle**. `forgot-password` returns an identical message for a known and an unknown address so it cannot be used to enumerate accounts — but it awaited a real SMTP round trip only when the account existed, leaking the exact fact the identical wording was there to hide.

**Alternatives considered**: (a) Keep sending inline but stop swallowing errors — rejected: it turns a mail-provider outage into a failed registration, which is worse than a delayed email. (b) Fire-and-forget with no persistence (`void sendEmail(...)`) — rejected: it fixes the blocking half and makes the losing half *harder* to see, because there is then no row and no error text either. (c) A real job queue (BullMQ + Redis) — rejected on the ₹0 constraint; there is no free Redis in this stack, and the outbox is ~200 lines. (d) A Vercel cron to drain — rejected for now: cron needs a paid plan. The gap is recorded as known bug #41, with a free external uptime pinger as the intended fix.

**Consequences**: delivery is **at-least-once**. If a container dies after the provider accepted a message but before the row was marked `sent`, it is sent twice; no local bookkeeping can close that without provider-side idempotency, and a duplicate notice is a far smaller harm than a lost one. On an idle site the queue has **no deadline**, which is why the manual drain exists and is not hidden. `EmailOutbox` has deliberately **no TTL** — like `AuditLog`, a delivery record is the evidence for "we did tell them". Under test the drain is awaited inline so the suite is deterministic; the non-blocking property lives in `enqueueEmail()` returning after one insert, which is identical either way.

---

## 2026-08-13 — In-app is the notification channel; email is an escalation (superseding "in-app only")

**Decision**: this **supersedes** the Milestone 12 decision that notifications are in-app only. Every notification is still written to `Notification` exactly as before. Email is an *additional* copy of some of them, never an alternative: a student who never opens their email and one who never opens the app both still have one complete record. A staff broadcast is emailed only when staff tick it per announcement (unchecked by default, reset after each send, capped at 500 recipients with the cap reported). Per-student system notices about results are emailed automatically. The two class-wide broadcasts — exam published, mock test published — are **never** auto-emailed.

**Reason**: Milestone 12's reasoning was that emailing the whole roll from a free tier is a deliverability and provider-limit problem, and that entrants are schoolchildren whose addresses are often their parents'. All of that is still true, so email was not simply switched on. What changed is the owner's requirement for "email notifications where appropriate", and the resolution is that *appropriate* is a real distinction: a released result is news a family would regret missing, and a newly published practice paper is not.

Keeping in-app as the channel is what makes preferences safe. Because the record is always written, a preference can suppress email without suppressing information — so "I turned that off" never means "I was not told".

**Alternatives considered**: (a) Email every notification — rejected: it is the free-tier deliverability problem Milestone 12 identified, and it trains recipients to ignore the sender. (b) Email nothing, as before — rejected: it leaves a student's *result* dependent on them thinking to log in and look. (c) Let preferences suppress in-app rows too — rejected: read state would become meaningless, because "unread" and "never delivered" would be indistinguishable, and a notice board a student can empty is not a record.

**Consequences**: a broadcast is the one genuine fan-out in the system — of *email rows*, not notifications, because SMTP has no broadcast. It is capped rather than unbounded, and the cap is reported instead of being discovered as a provider suspension. Suppressed recipients are counted and shown to staff, because "0 queued" with no explanation reads as a bug and invites a resend.

---

## 2026-08-13 — Security and transactional email are not preferences

**Decision**: there are exactly **two** switchable email streams, `announcements` and `results`. `transactional` (verification and password-reset links) and `security` (password changed, account status changed, role changed) always send. The switchable ones live in an embedded `Student.notificationPrefs`; the non-switchable ones are **absent from the update schema** rather than ignored by the handler, and the API returns them with their reasons so the UI can state them. Inside `emailAllowedFor()`, the category check runs **before** the account-status check.

**Reason**: "you may switch off the warning that your password was changed" is a setting that only ever helps an attacker — that email is the standard way somebody notices a stolen session and recovers the account. Transactional mail is not a notification *about* anything; without it the account cannot be used at all. Offering either as a toggle would be offering a footgun, and offering one that silently refused to take effect would be worse.

The rule ordering is load-bearing rather than incidental: a **suspension notice** is the one message a suspended account absolutely must still receive, and checking status first would swallow exactly that.

**Alternatives considered**: (a) A switch for every category — rejected above. (b) Four categories including `certificates` — rejected: certificates can only be issued by releasing results, so that stream is folded into the results message and a preference for it would control nothing. A setting that does nothing is worse than a shorter list. (c) Its own `NotificationPreference` collection — rejected: two booleans, 1:1 with the account, always wanted alongside it. A 25th model for that is the sprawl `DECISIONS.md` already warns about.

**Consequences**: the settings panel is short, and states plainly what it does not control — which is more honest than two toggles that leave the reader wondering whether password emails are covered. A missing `notificationPrefs` object reads as **all-on**, because a student who registered before this existed was already receiving everything and defaulting to off would silently take something away. Staff cannot see an individual's preferences (known bug #44), only the aggregate suppressed count on a broadcast.

---

## 2026-08-13 — A per-student audience that staff cannot address

**Decision**: `Notification` gains `audience: 'student'` with a `student` reference, used only by `postSystemNotification()`. The staff composer's schemas accept `STAFF_AUDIENCES` (`all`, `class`) only, so `student` is unreachable from any API a human drives. `inboxFilter()` gains the matching clause, and `isVisibleTo()` composes it so the inbox, the unread count and the mark-as-read check share one definition. System rows also carry `source`, `event`, `link` and a partial-unique `dedupeKey`, and **cannot be edited** (409) though they can be deleted.

**Reason**: a system notification is usually about one person — "your results are out", "your password was changed". Broadcasting that to a class is a disclosure bug, not a display bug, because the body carries a score, a rank and a certificate tier. Making the audience unreachable from the composer means staff cannot create that situation by mistake, and putting it in the *schema* rather than the handler follows the same discipline the leaderboard uses for ranked values.

Editing is refused because a system notification is a record of something that happened; changing its text turns it into a claim about something that did not — and it would then disagree with the email already delivered from it. Deletion stays, because housekeeping is not falsification.

**Alternatives considered**: (a) A separate `PersonalNotification` collection — rejected: it would need a second inbox query, a second read-state join and a second unread count, which is precisely how the bell comes to disagree with the list. (b) Let staff address one student too — rejected: there is no product need, and it would put a free-text private message next to a per-student notice that the student would reasonably read as official. (c) No dedupe key, relying on administrators not clicking twice — rejected: releasing results is explicitly idempotent, so the notification had to be as well, and an index is what makes that true rather than intended.

**Consequences**: the admin announcement list now **defaults to `source: 'staff'`**, because one national exam release writes a system row per candidate and would otherwise bury the handful of announcements the page exists to manage; `?source=all` gives the combined view. Finding the shared-filter seam also fixed a latent bug: the mark-as-read route hand-wrote its audience comparison, which was correct for two audiences and would have silently refused every per-student notification this milestone added.

---

## 2026-08-13 — Analytics are derived on read; `StudentAnalytics` is deleted rather than filled in

**Decision**: performance analytics have **no collection**. `services/analyticsService.ts` computes them on every read from the four attempt collections. The `StudentAnalytics` model is removed, along with `generateAIInsights()`.

**Reason**: filling it in was the obvious move and the wrong one, for three reasons. It **predated Milestone 4 and was the wrong shape** — `studentId` was a plain `String` and `topicMetrics[].topicName` was free text with no `Topic` reference, so a topic rename would have orphaned a student's history and two subjects with a same-named topic were indistinguishable. A **stored breakdown drifts** from the answers behind it, which is exactly the argument that already keeps XP, levels, streaks and the leaderboard derived — and it would have been worse here, needing invalidation on every submission from four different services. And its `aiInsights` field was a **live bug**: `generateAIInsights()` mutated it on every read and never saved, harmless only because the branch was unreachable.

Deleting it also lets the "AI insights" fiction go. Strengths and weaknesses are now derived facts with a stated minimum sample, not generated prose, and nothing in the product claims to be AI.

**Alternatives considered**: (a) Write `StudentAnalytics` as a materialised cache — rejected above; it is a counter that can disagree with the events behind it, and this codebase has consistently refused those. (b) Keep the collection and rewrite its schema — rejected: nothing had ever written it, so there was no data to preserve and a rewrite would have been a new collection wearing an old name. (c) Cache the derived result with a TTL — rejected for now: eight indexed operations bounded by one student's own history is cheap, and a stale accuracy is worse than a slightly slower page. The place to add one is stated in the service header, alongside the same note the leaderboard carries.

**Consequences**: the response shape of `GET /analytics/:studentId` changed (`data`/`reason` became `analytics`), so the Analytics and Report pages were rewritten and one dashboard test updated. Analytics cost eight database operations per page load rather than one document read — all narrowed by `student`, all parallel, and all bounded by one student's own activity. `StudentAnalytics` was the **last** collection keyed on a string `studentId`; every collection now references `Student` by `ObjectId`.

---

## 2026-08-13 — Grading reads the snapshot; analytics joins the live taxonomy

**Decision**: `services/grading.ts` reads the answer-key snapshot stored on the attempt and never the live `Question` — absolutely, as before. The analytics aggregations do the **opposite** and `$lookup` the **current** `topic`, `subject` and `difficulty`.

**Reason**: they are answering different questions. A mark is a **historical fact about one paper**: what the student was shown, and what it was worth at the time. Re-reading a live question to grade it would let an author's edit rewrite a mark already awarded, which is the whole reason the snapshot exists.

"How am I doing in Trigonometry?" is a question about the taxonomy **as it stands now**. If a question is recategorised from Algebra to Trigonometry because it was filed wrongly, the student's history should follow it — otherwise their topic breakdown describes a filing system nobody uses any more. Snapshotting the taxonomy onto every answer would additionally freeze a typo in a subject name into thousands of rows, with no way to correct it.

**Alternatives considered**: (a) Snapshot topic/subject/difficulty onto each answer alongside the answer key — rejected above; it makes the breakdown unfixable and grows every attempt document for a fact that is already stored once on the question. (b) Join the live taxonomy but keep a snapshot for comparison — rejected as complexity with no consumer: nothing in the product asks "which topic was this filed under at the time?".

**Consequences**, both stated in the service header and surfaced to the user rather than hidden: recategorising questions **moves historical breakdowns**, and a **deleted** question drops out of them entirely — the `$lookup` is followed by a non-preserving `$unwind`, because a question that no longer exists cannot be attributed to a topic and an "Unknown" bucket would be a fabricated category. `overall.servedIncludingDeletedQuestions` is counted separately from the attempts themselves, so the gap is visible, and the page says plainly that some answered questions have since been removed.

---

## 2026-08-13 — A weak area needs a minimum sample, and a percentage is never averaged

**Decision**: an area (topic, subject or difficulty) needs **at least five answered questions** before it may appear in the strong or weak lists. `MIN_AREA_SAMPLE` is returned to the client. Separately, every aggregation returns **raw counts only** — `served / answered / correct / marksAwarded / marksAvailable` — and percentages are computed once at the end from summed counts.

**Reason**: both rules exist to stop a *real* number becoming a *false* conclusion.

One wrong answer in a topic is a genuine 0%, and calling it a weakness is a fabricated diagnosis drawn from real data — which is the same failure as a fabricated statistic, dressed better. The floor is reported rather than hidden so the page can say why a list is empty instead of showing an unexplained blank.

Averaging percentages is the other. A student who answered 1 of 1 correctly in practice and 1 of 9 on a mock test has answered 2 of 10 — **20%**. Averaging the two percentages gives 55.6%, which would tell a struggling student they are better than half right. Summing raw counts makes that arithmetic unwritable rather than merely discouraged, and there is a test that pins the 20%.

**Alternatives considered**: (a) Show every area regardless of sample, with a confidence marker — rejected: the marker is the first thing a reader ignores, and the top of a "weak areas" list is read as a verdict. (b) A statistical confidence interval instead of a flat floor — rejected as unjustifiable precision for a cohort this size; a stated integer everyone can check is more honest than a formula nobody will. (c) Let each surface report its own percentage and average them for the total — rejected above.

**Consequences**: a student with little history sees empty strength and weakness lists with an explanation, which is the correct answer rather than a limitation. The same discipline governs `null` versus `0` throughout: an accuracy with no answers behind it is `null`, because "has answered nothing" and "gets everything wrong" are different facts, and the frontend renders the two differently — never `0%` for the first.

---

## 2026-08-15 — Recommendations are derived behind a swappable engine, and nothing is stored

**Decision**: performance recommendations are produced by an engine resolved at request time from a registry (`services/recommendationService.ts`), selected by `RECOMMENDATION_ENGINE`, against a contract in `lib/recommendationTypes.ts`. The default is `statistical-v1`. There is **no `Recommendation` collection**: a set is derived on read and never persisted. An engine receives a `RecommendationFacts` object and **cannot query a database**. The service — not the engine — stamps `engine`, `generatedAt` and `hasData` onto the result.

**Reason**: three separate arguments landing on the same design.

*Nothing is stored*, for the reason `StudentAnalytics` was deleted in Milestone 15: a stored recommendation is a claim that outlives the evidence behind it. A student who fixes their weakest topic on Tuesday must not be told on Wednesday that it is still their weakest topic, and no cache invalidation across four attempt collections is more trustworthy than simply asking the data.

*An engine cannot query*, for the reason the three gamification catalogues cannot: an engine that could read the database could invent a figure no collection can produce, and could make a page slow in a way the caller never budgeted for. The wall is what makes "every recommendation cites real counts" enforceable rather than aspirational, and adding an input stays a deliberate two-step act — declare it on `RecommendationFacts`, supply it in the service.

*The service stamps provenance*, because the alternative is an engine that describes itself. `RecommendationDraft` has no `engine` field and no `hasData` field at all, so an engine cannot claim to be a model, cannot backdate its output, and cannot report data a student does not have. A test smuggles all three onto a draft and asserts they are ignored.

**Alternatives considered**: (a) Fold recommendations into `GET /analytics/:studentId` — rejected: the seam exists so a model-backed engine can be dropped in, and a model has latency the arithmetic does not; a separate request means a slow engine costs one panel rather than the whole page. (b) A single hardcoded implementation with no seam — rejected: the requirement was explicitly that ML/LLM be able to replace or augment this, and retrofitting a seam after a page depends on a concrete shape is materially harder. (c) A stored nightly rollup — rejected as above, and premature: the derivation is bounded by one student's own history.

**Consequences**: a recommendations request costs the analytics derivation (eight indexed operations) plus three more — the published bank for the class and a mock-test count — all parallel, all narrowed by `student` or `classLevel`. Uncached, deliberately, the same note the leaderboard and `buildRewardFacts()` carry. An engine that throws is caught and the statistical engine answers instead, so a failing model degrades the advice rather than the page.

---

## 2026-08-15 — A recommendation is asserted on a confidence interval, not on a percentage

**Decision**: the statistical engine reasons over the **95% Wilson score interval** around each accuracy, and always from the conservative end — a weakness is asserted on the interval's **upper** bound ("even read optimistically, still below par"), a strength on its **lower** bound. `MIN_AREA_SAMPLE` from `analyticsService.ts` is reused unchanged as the hard floor beneath that.

**This does not reverse the Milestone 15 decision**, which rejected an interval *as a replacement for the flat sample floor* when deciding which areas to **display**. That floor is still there, still five, still shared — a topic below it is not measured here either. The interval does a different and stronger job: deciding whether to **recommend**, which is a claim about what a child should do rather than a row in a table.

**Reason**: on this product's data, ranking by percentage is actively misleading. A practice session is ten questions, so a topic's whole sample is often five or six answers, and **2 of 5 (40%) would outrank 30 of 80 (37.5%)** — the first is one bad session, the second is the finding. Wilson rather than the textbook normal interval because the normal one is badly wrong at small `n` and at proportions near 0 or 1, which is exactly where this data lives.

The Milestone 15 objection — "a stated integer everyone can check is more honest than a formula nobody will" — is answered by **showing** the interval rather than only ranking on it: every card expands to `Likely range 12.4% – 43.5%`, labelled as 95% confidence given how many were answered. The formula is not hidden behind a verdict; it is quoted in the verdict, in numbers the reader can check.

**Alternatives considered**: (a) Rank on raw accuracy above the flat floor — rejected above, with a test that pins the 2-of-5 versus 30-of-80 case directly. (b) Raise the flat floor to 20 answers instead — rejected: it would silence real findings for every student who has not practised heavily, and would still treat 5 of 20 and 50 of 200 as equally certain. (c) A Bayesian posterior with a prior drawn from the cohort — rejected as unexplainable to a student and dependent on cohort data that barely exists yet.

**Consequences**: a perfect five is **not** reported as a strength, and five wrong answers are **not** reported as a weakness — both are asserted by tests, and both will look like under-reporting to anyone expecting a percentage ranking. That is the intended behaviour: it is what stops one lucky or unlucky session becoming a diagnosis. Confidence is derived from sample size alone (10 and 20 answers are the thresholds) and never from how dramatic the effect looks.

---

## 2026-08-15 — No AI provider is integrated, and the statistical engine is not called AI

**Decision**: Milestone 16 ships **no** LLM or ML integration, adds **no** AI dependency and **no** API key. Google Gemini was evaluated for this task and deliberately not wired up. The default engine declares `kind: 'statistical'` and the page prints "No AI is involved" verbatim. The seam is built and documented so a model can be added later without touching the route, the response shape or the page.

**Reason**: four, in order of weight.

1. **It is not required.** All five requested capabilities — weak topics, strong topics, difficulty guidance, practice suggestions and insights — are questions about counts, not about language. Arithmetic answers them exactly, deterministically and instantly, and a language model asked the same question would paraphrase the arithmetic while being able to get it wrong.
2. **The data is children's performance records.** Sending a named minor's accuracy, weakest topics and progress to a third-party API is a privacy decision belonging to the project owner, not a technical one — and free tiers commonly reserve the right to train on submitted data. That is not a trade to make silently inside a milestone.
3. **The MVP must work without paid AI services**, and a free tier that later meters is a paid service with a delay. The ₹0 constraint is a standing rule here.
4. **This product has already deleted a fake AI feature.** `generateAIInsights()` was rule-based string assembly that had never been near a model; Milestone 15 removed it and the "AI Performance Analytics" page with it. Re-introducing the label over real arithmetic would be worse than the original, because the numbers underneath are now good enough to be believed.

**Alternatives considered**: (a) Wire Gemini in behind a disabled-by-default flag — rejected: it adds a dependency and an unexercised code path for a capability nobody has asked to turn on, and the privacy question above stays unanswered either way. (b) Use a language model to *phrase* findings the arithmetic produces — genuinely attractive, and the seam accommodates it exactly (an engine may return the same findings with different `detail` text), but it is a cost and privacy decision to be taken deliberately rather than a default. (c) Train a small local model — rejected: no training data exists, a cohort of a few hundred cannot produce any, and it would be a fabricated model rather than a fabricated statistic.

**Consequences**: the product's advice is exactly as good as its arithmetic, which is checkable line by line and covered by tests that assert exact sentences. If a model is added later, `kind: 'model'` is the honest signal and the UI already renders it differently. The two questions that must be answered first are recorded above, and neither can be answered from a development sandbox — see the owner instructions in [`PROJECT_STATE.md`](PROJECT_STATE.md).

---

## 2026-08-15 — A language model may draft questions, and that is not a reversal of the Milestone 16 decision

**Decision**: the admin question generator can be backed by Google Gemini (`GEMINI_API_KEY`). The default with no key configured is unchanged — blank templates — and the model is selected by `QUESTION_GENERATOR=auto` resolving to it only when a key exists.

**This does not contradict the Milestone 16 ADR** ("No AI provider is integrated, and the statistical engine is not called AI"), and a future session should not read it as drift. That ADR gave four reasons, and **three of them do not apply to question drafting**:

- *"It is not required — the task is arithmetic."* Recommendations are questions about counts, and a model could only paraphrase the arithmetic while being able to get it wrong. **Drafting a question is writing.** There is no correct answer to compute, and the alternative is a human typing it from scratch.
- *"The data is children's performance records."* **No student data is sent here at all** — the payload is a subject name, a topic name, a class level, a difficulty and an instruction the examiner typed. A test asserts the request body contains no student fields. This is the reason the two cases genuinely differ, rather than the same trade being made twice with different enthusiasm.
- *"The MVP must run with no paid service."* It still does, and *identically*: with no key the button behaves exactly as before. AI is an enhancement to a complete feature, not the feature.

The fourth reason — *"this product already deleted a fake AI feature"* — still governs completely, and is why the naming discipline is tightened rather than relaxed: `GeneratorDescriptor.kind` is `'template'` or `'model'`, the page prints which one ran, and the **audit trail records it per batch**. "Was this question written by a machine?" must stay answerable years later.

**Reason for the design, beyond the choice to do it at all**: a model writing exam questions is safe only because of what happens to its output. Four properties, all in `services/questionGeneratorService.ts` so a second caller cannot skip them: the **taxonomy comes from the request** (a `GeneratedCandidate` has no subject/topic/class/difficulty field to carry, so it cannot file itself anywhere); every candidate passes **`createQuestionSchema`**, the same schema and the same `validateMathContent()` a hand-authored question passes; a failure is **rejected and reported, never repaired**; and everything written is a **draft**, because `createQuestion()` has no other mode.

**Alternatives considered**: (a) A separate, looser validator for model output — rejected outright: two validators eventually disagree and the model-facing one would be the weaker, which is the exact shape of the "two graders" argument that keeps `services/grading.ts` singular. (b) Auto-correcting a near-miss candidate (dropping a duplicate option, fixing a marks range) — rejected: a repaired answer key that looks right is worse than a missing question, because a reviewer skims what looks finished. (c) The `@google/genai` SDK — rejected in favour of `fetch` against the REST endpoint: it saves about twenty lines at the cost of a dependency, a supply-chain surface and a version to chase, and the retries it would bring are actively unwanted against a metered free tier. (d) Publishing generated questions directly, or into a separate review queue — rejected: `draft` already *is* the review queue, and a second one would be a second workflow to keep correct.

**Consequences**: the free tier is a real ceiling, and hitting it is normal rather than exceptional — a spent quota falls back to templates and reports the provider's own words, because "it failed" cannot be acted on while "quota exceeded" can. Model output is unreliable by nature, so a partial batch (eight usable from ten) is the expected case and the page shows the discards with their reasons rather than quietly returning eight. The key is sent as an `x-goog-api-key` header rather than `?key=`, because a URL is the thing most likely to reach a log line. And there is now exactly one place in the product where `kind: 'model'` is the truthful answer — if a second appears, it needs its own entry here.

---

## 2026-08-15 — Generated questions are never saved until a human approves them

**Decision**: `POST /admin/generate-questions` returns candidates and **writes no question**. Candidates live in the reviewer's browser. `POST /admin/generate-questions/approve` is the only path that writes, and it **re-validates everything from scratch**. The blank-template generator was deleted, along with the fallback to it.

**Reason**: Milestone 17 saved generated questions immediately as drafts. That was defensible — a draft is not student-visible — but it was the wrong default in practice: the bank filled with machine output nobody had read, and the reviewer's job became "delete the bad ones" rather than "keep the good ones". Those are not the same job, and the first one gets skipped.

Re-validating on approval is not belt-and-braces. The review screen is a *client*: it can send anything, and the approval route is an ordinary authenticated endpoint. Trusting the second call because the first one validated would mean the schema was never really enforced — a test posts a candidate broken by the "edit" and asserts it is refused.

The template generator went because a blank placeholder is only useful as something to type into, and an examiner who wants that can create a question by hand. Keeping it as a *fallback* was worse than useless: it meant a spent quota silently produced filler where the examiner expected questions.

**Alternatives considered**: (a) A `pending` collection or a `proposed` question status — rejected: it is a third editorial state next to `draft`/`in_review`, needs its own cleanup policy for abandoned batches, and re-creates the problem (unread machine output accumulating in the database) that this decision exists to remove. (b) Keeping drafts and adding a "generated" flag to filter on — rejected for the same reason; the filter is the thing nobody applies. (c) Trusting the first validation and skipping it on approval — rejected above.

**Consequences**: closing the tab loses the batch, and the page says so plainly. That is the honest cost of storing nothing, and it is bounded — regenerating costs one more model call. The approval route carries the full question payload rather than an id, which makes it a larger request body than a normal write; it is capped at 20 questions. `GenerationLog` records what was asked and what came back, so a bad prompt is diagnosable even though the candidates themselves are never persisted.

---

## 2026-08-15 — Fill-in-the-blank is added; short answer is deliberately not

**Decision**: a fifth question type, `fill_blank`, marked by normalised string comparison against an author-listed `acceptedAnswers`. **Short answer is not added.**

**Reason**: everything in this product is auto-graded by one grader, and that is load-bearing — practice, mock tests, the daily challenge and the official exam all submit to `services/grading.ts`, and a result appears immediately. Fill-in-the-blank fits: the author lists every spelling that counts, so what will be marked correct is *data a human can read and correct* before anyone sits the paper.

Short answer does not fit, and the two ways to make it fit were both rejected. **Human marking** means a marking queue, a partially-graded attempt state, and results that cannot be released until every script is read — a large feature that changes what a "submitted" attempt means everywhere. **Model marking** means sending a child's written answer to a third party, which reverses the privacy line drawn in Milestones 16 and 17 (the drafting call sends no student data at all, and that is exactly why it was acceptable).

Normalisation forgives what is never the point of a maths question — capitalisation, extra spaces, a trailing full stop — and nothing else. It does **not** do spelling correction or synonyms: a grader that guesses can silently mark a wrong answer right, and an author who wants "twelve" to count writes it in the list where a reviewer can see it. `normalizeAnswerText` is exported and used by the validation layer too, so the collision warning an author sees is produced by the same rule the marking will apply.

**Alternatives considered**: (a) Fuzzy matching with an edit-distance threshold — rejected: it makes correctness depend on a tuning constant nobody can explain to a student who was marked wrong. (b) Regex answers — rejected: it puts a language nobody on the team writes into a field examiners edit. (c) Numeric-with-unit as a separate type — unnecessary; `fill_blank` with `["12 cm", "12cm"]` covers it.

**Consequences**: adding a type touched the model, the validation, the grader, the shared attempt subdocument, three snapshot builders, four answer-application paths and every review view — which is the honest cost of a fifth answer shape and the reason short answer was not waved through on top of it. The compiler found all of them because `acceptedAnswers` is non-optional on `AttemptAnswerEntry`; an optional field would have been missed in two of the three snapshot builders and produced wrong marks. That near-miss is recorded as a follow-up to consolidate them.

---

## 2026-08-16 — Razorpay Standard Checkout, verified server-side, with no SDK

**Decision**: integrate **Razorpay** for the Olympiad entry fee, over the REST API with `fetch` and `node:crypto`. No SDK, no new dependency. The checkout modal runs in the browser; every state change that means "money arrived" is decided by an HMAC signature this server computes with a secret the bundle has never seen.

**Reason**: the owner picked the provider. Razorpay is the common India-market choice, supports UPI / cards / net banking / wallets from one integration, and has a test mode that costs nothing to develop against. The **no-SDK** half follows the Milestone 17 precedent set for Gemini: the API is Basic auth over HTTPS and the signature is one HMAC, so an SDK would add a dependency and a version to chase to save about thirty lines — and its automatic retries are actively *unwanted* on an endpoint that creates orders.

**This knowingly breaks the ₹0 cost target**, which no previous decision has done. Razorpay charges per transaction. That was the owner's call, it is what the entry fee funds, and everything else in the product still runs on free tiers. Recorded explicitly so a future session does not "fix" it back.

**Alternatives considered**: (a) Cashfree — comparable, not chosen, no technical objection. (b) Razorpay's Node SDK — rejected above. (c) A payment link emailed per student — rejected: it cannot be reconciled against an account automatically, which is the whole basis of the entitlement.

**Consequences**: the raw request body must be preserved in `app.ts`, because Razorpay signs the exact bytes it sent and verifying against a re-serialised object fails for legitimate webhooks — the predictable "fix" for which is to stop verifying. Three new environment variables, all optional, so the product still boots without them and says so rather than half-working. `checkout.js` is loaded on demand rather than from `index.html`, so a third-party script is not fetched on every page load of the whole site for a page almost nobody visits.

---

## 2026-08-16 — The entitlement is derived from a captured payment, never stored on the student

**Decision**: "may this student use the platform?" is answered by `Payment.exists({ student, purpose: 'olympiad_entry', status: 'captured' })`. There is **no `hasPaid` flag on `Student`**, and no field anywhere that records entitlement as a boolean.

**Reason**: the same argument that keeps XP, levels, streaks, the leaderboard and analytics derived, applied to the one subject where being wrong is worst. A stored boolean is a second source of truth about money. When it drifts — a failed write after a successful capture, a restore from a stale backup, a refund that updated one place and not the other — either somebody who paid is refused, or somebody who did not is admitted. The payment row is the fact; anything else is a cache of it.

**Alternatives considered**: (a) A `hasPaid` boolean updated on capture — rejected above. (b) An `entitlements` array on `Student` — same objection, with more ways to drift. (c) Recomputing into a cache on read — rejected: the query is a single indexed existence check, so there is nothing to save.

**Consequences**: every gated request costs one indexed `exists()` plus the settings read, and the entitlement rides on every auth response, which adds the same two reads there. Cheap, and it means a refund or a correction takes effect immediately with no reconciliation step. The index `{student, purpose, status}` exists precisely for this query.

---

## 2026-08-16 — One mounted `requireEntry` middleware, answering 402, ahead of the lookup

**Decision**: the paywall is a **middleware mounted on gated routes**, not a call inside each handler and not an entry in the permission table. It answers **402**. It runs **after** the auth gate and `ensureDb`, and **before** the handler.

**Reason**: three separate arguments landed in the same place.

**Why not a permission**: `requirePermission()` answers "what may this *role* do?" from a static table, and the value of that table is that it can be checked by reading it. Payment is a different axis — two students with identical roles differ by whether money arrived, which is a fact about a collection. An `entry:paid` permission would make the table no longer derivable from the role.

**Why mounted rather than called**: the same reason there is one grader and one reward engine. A surface that has to remember to ask will eventually forget, and a forgotten paywall is indistinguishable from a working one until somebody notices the revenue. A mounted middleware is visible in the route definition, where a reviewer can see whether it is there.

**Why 402 and not 403**: they mean different things to the page receiving them. 403 is "you may not, and nothing you do will change that" — the `Unauthorized` screen. 402 is "not yet, and here is what to do about it" — a pay button. The frontend branches on the status, so a 403 would strand a paying customer on a dead end.

**Why before the lookup**: the exam's original check sat inside `startExamAttempt()`, *after* the route's 404. That made the paywall report on what exists behind it — an unpaid caller could distinguish a real exam id from an invented one by the status code. The service check stays as defence in depth for any future caller; the middleware is what makes the refusal uniform. There is a regression test asserting 402 rather than 404 for an absent id.

**Alternatives considered**: (a) Checking in each service — rejected: that is where the exam's leak came from. (b) A single global gate with a route allow-list of *free* routes — rejected: that fails open, so a new public route silently becomes paid, or worse, a new paid route silently becomes free. Naming the gated routes fails closed in the direction that matters less.

**Consequences**: adding a gated surface is one line at the route, and forgetting it is visible in review rather than invisible in production. Staff are **not exempt** — a promoted admin is an ordinary student account, and a role exemption inside a payment gate is exactly the kind of thing that silently admits people. An administrator who wants to click through practice must pay or switch the fee off, which is recorded in [`PROJECT_STATE.md`](PROJECT_STATE.md) so it is not discovered as a bug.

---

## 2026-08-16 — Reconciliation replaces the webhook

**Decision**: with no `RAZORPAY_WEBHOOK_SECRET` configured, `POST /payments/reconcile` asks Razorpay directly what happened to the student's outstanding order and captures on the same idempotent path. It runs on payment-page load and whenever the checkout modal closes without success. The webhook route remains, fully implemented, and works the moment a secret is set.

**Reason**: the owner chose not to configure a webhook. That leaves the browser's return journey as the only confirmation — and a browser can be closed, refreshed, or killed by a dropped mobile connection in the second between the money moving and the verify call landing. Every one of those leaves Razorpay holding a captured payment this database knows nothing about: the student has paid and received nothing, which is the worst failure this feature has.

Pulling is in one way **strictly more trustworthy** than being pushed: the answer comes from an authenticated call we initiated, rather than from an unauthenticated request claiming to be Razorpay. The trade is latency — it settles when something asks, rather than within seconds automatically.

Only `captured` counts. `authorized` means the money is held but not taken, and treating it as paid would entitle a student against money that can still evaporate.

**Alternatives considered**: (a) Requiring the webhook — rejected: it is the owner's environment to configure, and a feature that only works with an optional secret set is a feature that will be deployed broken. (b) Polling every pending order on a timer — rejected: the free tier has no scheduler, and it would spend API calls on abandoned checkouts, which are the majority.

**Consequences**: a student who pays and never returns to the site is not settled until something asks. Mitigated because the payment page reconciles on load and the dismiss handler reconciles immediately, so the realistic path — pay, tab dies, come back — is covered. Configuring a webhook secret later makes settlement automatic with no code change.

---

## 2026-08-16 — The entry fee is charged by default, and it gates the whole platform

> **Partly superseded on 2026-08-17 by "The entry fee buys the Olympiad, not the platform" below.** The *default* half stands: `entryFeeEnabled` still defaults to `true`. The *scope* half was reversed by the owner after one day — practice, mock tests and the daily challenge are free again.
>
> **The amount is also out of date: the owner raised the fee to ₹199 on 2026-08-28.** The ₹100 below is a record of what was decided then. Everything this entry says about *where* the price lives — an administrator-editable settings document, never an environment variable — is unchanged, and is exactly why re-pricing needed no code decision.

**Decision**: `entryFeeEnabled` defaults to **`true`**, and the fee entitles a student to **practice, mock tests, the daily challenge and the official Olympiad** — not the exam alone. The fee is **₹100**, stored in an administrator-editable settings document rather than an environment variable.

**Reason**: two owner decisions on the same day, and one of them reverses a default set hours earlier.

The **scope** widened because the owner described the product's flow as: register, pay, then use the site. The narrower version — free practice, paid exam — was a reasonable first shape but was not what the product is.

The **default** flipped from `false` for a reason that only became true once the scope widened. `false` was correct while the fee bought the exam alone and nobody had paid: switching a gate on by deploy would have refused entry to students who could enter yesterday. Once the fee is the entry condition for the platform, a paywall that defaults to off is not a paywall, and every deployment would have to remember to switch it on. The reversal is recorded here rather than silently applied, because the original argument was a good one and a future session will meet it in the model's comments.

The **switch is kept**, and matters more now than it did. It is the only answer to two situations: a provider outage during an exam window, which needs a response that is not "nobody can enter", and a decision to run a cohort free. It stays **explicit** rather than inferred from the credentials being absent, because "we chose to run this free" and "the keys are missing" are different situations that must never look the same — with the keys missing and the fee on, students are correctly told payment is unavailable rather than quietly admitted.

The **fee is not an environment variable** because it is business configuration, not a credential. In `.env` it would be a redeploy to change, unchangeable by the person who actually decides it, and would leave no record of who changed it or when. `RewardSettings` already established this pattern for the XP table.

**Alternatives considered**: (a) Keeping the fee exam-only and adding a second paid tier for practice — rejected: two products where the owner described one. (b) Gating the dashboard as well — rejected after asking the owner: a student must be able to see what they are buying, and a hard wall at sign-in reads as a broken account. (c) Deriving "charging" from whether Razorpay is configured — rejected above.

**Consequences**: every suite that exercises a gated surface needs an entitled student, so `registerVerifyLogin()` grants one by default and takes `{ paid: false }` for the cases where not having paid is the point. That default is deliberate: a test student who cannot practise is asserting behaviour no real student reaches. `createAdminSession()` is unpaid, because staff are not entrants and an administrator with an entry-fee payment against their name would appear in the console's collected total. Changing the price never re-prices a captured payment — `Payment.amount` is a snapshot, the rule `StudentActivity.xpAwarded` already follows.


---

## 2026-08-17 — The entry fee buys the Olympiad, not the platform

**Decision**: the ₹100 fee entitles a student to sit the **official Olympiad**. Practice, mock tests, the daily challenge and analytics are **free**, gated nowhere. `requireEntry` is mounted on the exam attempt route only. Paying is offered on `/payment`, as a dashboard banner, and as a card on `/profile`, because **paying later is the normal path** rather than the exception.

**Reason**: the owner's, and it reverses the scope set the previous day. The product is a competition with preparation attached, not a subscription: a student should be able to practise, rehearse and measure themselves for nothing, and pay at the point they decide to compete. Gating preparation also inverts the funnel — it asks for money before the student has any evidence the material is worth paying for, which is exactly backwards for a first cohort with no reputation yet.

It also removes a support problem that the wider gate created and nothing else solved: with preparation paid, a student whose payment failed could do *nothing at all*, so every payment problem became a total outage for that person. Now a failed or postponed payment costs them the competition entry and nothing else, and they keep using the site while it is sorted out.

**Alternatives considered**: (a) Keeping the wide gate — rejected by the owner. (b) A free trial period on the preparation surfaces — rejected: it needs a per-student clock, a second notion of expiry, and a decision about what happens mid-practice-session when it lapses, all to approximate "free" less honestly than free does. (c) Free practice but paid mock tests — rejected as an arbitrary line: a mock test is preparation by definition, and the split would need explaining on every page.

**Consequences**: the entitlement, the derivation, the 402, the ordering ahead of the resource lookup and the admin console are all unchanged — only the set of routes carrying the middleware moved. The tests now assert the free surfaces are **not** gated as well as that the exam is, in both directions, because a paywall that silently widens would start charging for things the owner said were free and nothing else in the codebase would notice. The dashboard banner and the profile card render nothing once the fee is paid or when it is switched off, so a settled matter never nags.

---

## 2026-08-18 — Adopt the official `@google/genai` SDK, and keep the retries our own

**Decision**: call Gemini through the official **`@google/genai`** SDK rather than `fetch` against the REST endpoint. **This supersedes item (c) of the 2026-08-15 Milestone 17 ADR**, which rejected exactly this. The `QuestionGenerator` seam, the trust boundary, the validation, the review screen and the approval path are all unchanged — they speak `GeneratedCandidate`, which is provider-agnostic by construction.

**Reason**: the owner instructed it. The two objections the earlier ADR recorded were a dependency and version to chase, and automatic retries that are unwanted against a metered free tier. The first is the owner's call to make and they made it; the package is free, official, and the only new runtime dependency since the Milestone 1 foundation. The second is **answered rather than accepted**: retrying is this codebase's own logic in `attemptGenerate()`, not the SDK's, and it is deliberately narrow — only 429, 5xx and timeouts, bounded by `GEMINI_MAX_RETRIES` (default 1, max 3). A rejected key, a blocked prompt and a retired model name are **not** retried, because repeating them spends quota to receive the same refusal.

There is also a genuine gain that the earlier ADR did not weigh, because it was thinking about transport rather than capability: **`responseSchema`**. Asking for JSON in prose is a request; handing the model a machine-readable schema is closer to a guarantee, and it is what turns "the model wrote prose today" from a failure mode into a non-event.

**Consequences**: `require()` rather than `import`, behind a `typeof import(...)` cast and one lint suppression. The package declares `"type": "module"` and ships a single declaration file for both builds, so TypeScript resolves the `require` condition to the real `dist/node/index.cjs` — which Node loads perfectly — and then refuses the import because the *declaration* file is nominally ESM (TS1479). `await import()` would make every call site async for no behavioural gain; converting this package to ESM is far larger than one dependency justifies. The compiled output was loaded to confirm the require path works in production, not just under `tsx`.

**Alternatives considered**: (a) staying on `fetch` — rejected: the owner asked, and the schema support is worth having. (b) Vertex AI instead of the Gemini API — not considered seriously: it needs a Google Cloud project with billing, which breaks the ₹0 posture for a feature that currently needs a free key. (c) Letting the SDK retry — rejected as above; its policy cannot know that a 403 here is permanent.

---

## 2026-08-18 — One structured-output schema per question type, and `marks` is not in it

**Decision**: build the Gemini `responseSchema` **per requested question type** rather than as one schema covering all five. A numeric request's schema has no `options` property at all; a `fill_blank` request's has no `booleanAnswer`. `marks` and `negativeMarks` are absent from every variant.

**Reason**: Gemini's schema dialect has no real union, so a schema listing every answer field would *invite* the model to fill in the ones that do not belong — which `refineQuestionAnswers` then rejects, spending a request to receive a candidate we throw away. What is not in the schema cannot come back, so the answer shape is right by construction rather than by validation, and `toCandidate()` fills the unused fields with the nulls the validator expects. `minItems`/`maxItems` pin the batch size and the option count for the same reason: "it returned four when I asked for three" stops being a case to handle.

`marks` is excluded because it is the **paper's price**, set by the examiner, and the model has no opinion about it worth reading. It is overwritten server-side even if it arrives, which is the same rule that keeps the taxonomy out of `GeneratedCandidate`.

**Consequences**: five schema shapes to keep in step with `refineQuestionAnswers`. That is a real duplication, and it is bounded by a test that asserts the schema for a numeric request contains exactly the expected property names — so adding a sixth question type fails loudly here as well as in the five places `CLAUDE.md` already lists.

**Alternatives considered**: (a) one permissive schema plus validation — rejected above. (b) No schema, prose only (the Milestone 17 behaviour) — rejected: it worked most of the time, and "most of the time" against a metered API is a cost as well as a defect. (c) Function calling / tool use instead of structured output — rejected: it is the same guarantee expressed less directly for a single-shot generation.

---

## 2026-08-18 — Advisory quality warnings that annotate and never reject

**Decision**: add `lib/questionQuality.ts` — a pure function of the candidates producing `{ code, message }` findings shown beside each question and beneath the batch. It **never** rejects, never blocks approval, and is explicitly documented as **not** verifying that a question is mathematically correct.

**Reason**: there is a real band of defects that are decidable from the text alone and that a reviewer's eye slides past — a question referring to a diagram it cannot have, a solution that never states the stored answer, a numeric tolerance loose enough to mark a wrong answer right, rounding left unstated, two options that are the same value written two ways, a correct option conspicuously longer than the distractors, and the correct answer sitting in position (a) all the way down a batch. Every one of those is a genuine defect and cheap string arithmetic.

They are warnings rather than rules because each is a strong *hint* that is sometimes wrong, and a rule that is sometimes wrong must not throw a question away. `createQuestionSchema` holds the rules — the things that are always defects — and it rejects. Keeping the gate singular is the same argument that keeps one grader and one ranking service.

The naming discipline matters as much as the code. This is the same honesty rule that deleted `generateAIInsights()` and that keeps `EngineDescriptor.kind` factual: **do not claim mathematical correctness that has not been programmatically verified.** Checking that $3$ really is the larger root requires solving the question, which is the reviewer's job. The first live generation run of the new code returned a plausible, well-formatted question whose answer key was **wrong** — the best possible argument for saying nothing we cannot support.

**Consequences**: a reviewer sees more amber on the page. The mitigation is that warnings look advisory (warning-toned, never error-toned; the one genuinely-refused state is the only thing allowed to look like a refusal), and a clean batch shows none at all — asserted by a test, because a checker that always finds something teaches people to ignore it.

**Alternatives considered**: (a) rejecting on these — rejected: a legitimate question would eventually be thrown away silently. (b) A CAS or symbolic solver to actually check the mathematics — rejected for now: it is a large dependency that can only handle a narrow slice of olympiad questions, and a checker that verifies 20% while implying it verified everything is worse than none. (c) Asking a second model to review the first — rejected: it doubles the cost and the privacy surface to obtain an opinion that is no more trustworthy than the first one.

---

## 2026-08-18 — Provenance on the question, recovered from our own log, and no second review lifecycle

**Decision**: add a `provenance` subdocument to `Question` recording the source (`human` / `ai_assisted`), the generator, the **exact model**, the `GenerationLog` row, whether the reviewer edited it, and who approved it. Populate it **only** in `approveQuestions()`, reading the generator facts back from the server's own log row via the `logId` the client was issued — never from the request body. Do **not** add a `DRAFT / PENDING_REVIEW / APPROVED / REJECTED` lifecycle.

**Reason**: `GenerationLog` records that a *batch* was requested and `AuditLog` records that an approval happened, but neither answers the question somebody will eventually ask about a specific row — *"was this one written by a model, which model, and who signed it off?"* Answering that by joining a log against a timestamp is guesswork, and it is not a hypothetical question about machine-written exam content.

It is read from our own log rather than accepted from the request because provenance is a **claim worth checking**. The field worth lying about is `source`: a client that could set it would be able to file machine-written questions as hand-written ones, which is precisely the record this exists to keep.

And it is **displayed** — the admin question view serves it, the bank prints a badge, `?source=ai_assisted` filters on it. A stored field nothing reads is exactly the shape of thing Milestone 15 deleted when it removed `StudentAnalytics`, and the discipline that kept that from recurring is that a new field has to have a reader.

**No second lifecycle** because `status` (`draft` → `in_review` → `published` → `archived`) already *is* the editorial workflow, an approved AI draft is an ordinary question-bank row, and "rejected" has no row to live on — nothing is stored until approval, so a rejected candidate is a count on a log, not a document with a state.

**Consequences**: `editedByReviewer` is the review screen's own report about itself and cannot be verified server-side, because nothing was stored to compare against. That is a consequence of "nothing is saved until approval" rather than an oversight; it is documented as such, it grants nothing, and a client that lied about it would gain nothing.

**Alternatives considered**: (a) accepting the whole provenance block from the client — rejected above. (b) Storing the prompt on the question — rejected: it is a draft artefact, not a fact about the row, and `GenerationLog.hadInstructions` already records that there was one without storing what a staff member typed. (c) A separate `QuestionProvenance` collection — rejected: it is one-to-one with a question, always read with it, and never queried alone.
