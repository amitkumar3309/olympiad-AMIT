# Legal pages — what the owner must review before launch

The brief (§7.5, §10) asks for five pages and says to **ask, not guess**, on anything involving money
or legal text. Phase 3 wrote them as **drafts** from what the code actually does, each marked
`TODO(legal-review)` in its source file. They make no promise the product does not keep, and they
invent no business term. The questions below are what only the owner (ideally with a lawyer) can
answer. Nothing here is legal advice.

The users are minors. India's Digital Personal Data Protection Act, 2023 requires **verifiable
parental consent** for anyone under 18; what is built is a minimum, not a legal guarantee.

| Page | Route | Source |
|---|---|---|
| Daily Quiz & Rewards Rules | `/rewards/rules` | `frontend/src/pages/Legal/RewardsRules.tsx` |
| Privacy Policy | `/privacy` | `frontend/src/pages/Legal/Privacy.tsx` |
| Terms of Use | `/terms` | `frontend/src/pages/Legal/Terms.tsx` |
| Refund & Cancellation | `/refunds` | `frontend/src/pages/Legal/Refunds.tsx` |
| Contact us | `/contact` | `frontend/src/pages/Legal/Contact.tsx` |

## Questions for the owner

### Everywhere

1. **Who is the organiser, legally?** A registered company, a trust, a person? Its name and postal
   address are printed nowhere yet — none has been supplied, and a made-up one would be worse than none.
2. **Governing law and jurisdiction** — which city's courts? (Terms of Use names none.)
3. Should the pages carry a **grievance officer** (name, email) — commonly expected for Indian
   websites handling personal data?

### Refund & Cancellation (money — not guessed)

4. Is the Olympiad entry fee **refundable** at all? If so, until when (e.g. before the exam window
   opens), and for what reasons?
5. How long does a refund take to reach the student once approved?
6. If a sitting is **cancelled or moved**, what happens to the fee — refund, or carried to the new date?
   (The draft only promises that every paying student will be told by email.)

### Privacy Policy

7. **How long is data kept** after a student stops using the site, or after the Olympiad? The draft
   says data can be deleted on request, with issued results and certificates kept as a record.
8. **Parental consent at registration.** The brief (§10) asks for a required checkbox ("I am the
   parent/guardian, or I have my parent/guardian's permission…") and a parent/guardian phone or email
   at registration. Not built yet — planned for Phase 6. Confirm the wording you want.

### Daily Quiz & Rewards Rules

9. **Prize delivery**: the rules say prizes go to the parent or guardian after verification. How —
   bank transfer/UPI for the cash, courier for the gift? Any deadline for a winner to respond?
10. **Taxes**: the rules say tax is handled "as the law requires". If cash prizes could ever exceed
    the threshold for tax deduction at source on winnings, decide how that is handled and say so.
11. The rules state **three class groups a day** (3–5, 6–8, 9–12), as you decided (PLAN.md Q3). If a
    day is ever scheduled as one quiz for all classes, this sentence should change.

## What the drafts deliberately do not say

- No refund window, refund timeline or cancellation remedy (questions 4–6).
- No organiser name, address, registration number or jurisdiction (questions 1–3).
- No claim that the site is DPDP-compliant.
- The prize, the winner rule and the number of winners on the rules page are **fetched from the
  owner's settings** (Admin → Daily Quiz → Settings), never typed into the page — change the
  settings and the page follows.
