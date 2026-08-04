# DECISIONS.md

Lightweight Architecture Decision Records. Add a new entry (don't edit old ones except to add a "Superseded by" note) whenever a significant technology/architecture choice is made, so future sessions don't silently reverse it.

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

**Decision (implicit, by omission)**: Ship the registration flow with a static QR code image and a self-reported "I've paid" button, with no real payment verification, pending a real decision.
**Reason**: MVP needs to demonstrate the registration UX before committing to a specific payment provider (which likely has fees, KYC requirements, or isn't free-tier-friendly).
**Alternatives considered**: Not yet evaluated — needs owner input (Razorpay, Cashfree, etc. are common India-market options with free/low-cost test modes, but this has **not been decided** and must go through the owner per [`CLAUDE.md`](CLAUDE.md)'s cost-constraint rule before any SDK is added).
**Consequences**: Currently zero real payment collection is happening — registrations are effectively free regardless of the UI implying payment. Must be resolved before any real-money launch.

---

## Audit note

This is the first `DECISIONS.md` for the project (created during the 2026-08-04 Phase 0 audit). Entries dated 2026-08-04 above are **retroactive documentation of decisions already embedded in the existing code/git history**, not new decisions made during the audit itself. No new architectural decisions were made in this audit session.
