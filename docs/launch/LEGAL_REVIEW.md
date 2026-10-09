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
8. **Parental consent at registration — built in Phase 6; please review.** Registration now
   requires the brief's box, word for word ("I am the parent/guardian, or I have my parent/guardian's
   permission, and I agree to the Terms and Privacy Policy" — never pre-ticked, the two policies linked)
   and a parent or guardian's phone **or** email; the server records the date and time they agreed.
   Accounts made earlier are asked under My Profile → Prize details, and cannot win a prize until they
   agree. The Privacy Policy's "What we collect" was updated to say so (6 October) — **that addition is
   draft wording too.** Questions:
   - **a. Is a ticked box enough?** The DPDP Act asks for *verifiable* parental consent. What is built
     records that consent was given; it does not prove a parent gave it (no message is sent to the
     parent's phone or email to confirm). Do you want a confirmation sent to the parent before an
     account can be used, or before a prize is paid?
   - **b. Withdrawing consent.** Not possible on the site: a parent would write to the support address.
     What should happen then — the account deactivated, deleted, or kept without public listing?
   - **c. Keeping the parent's details.** How long after a student leaves (part of question 7)?

### Daily Quiz & Rewards Rules

9. **Prize delivery**: the rules say prizes go to the parent or guardian after verification. How —
   bank transfer/UPI for the cash, courier for the gift? Any deadline for a winner to respond?
10. **Taxes**: the rules say tax is handled "as the law requires". If cash prizes could ever exceed
    the threshold for tax deduction at source on winnings, decide how that is handled and say so.
11. The rules state **three class groups a day** (3–5, 6–8, 9–12), as you decided (PLAN.md Q3). If a
    day is ever scheduled as one quiz for all classes, this sentence should change.
12. **The prize is monthly** (your decision of 2026-10-09, PLAN.md Q24), and the rules page changed with
    it (dated 9 October 2026): each month one winner in each class band — 3–5, 6–8, 9–10 and 11–12 —
    the student with the most correct answers that month, the lower total solve time breaking a tie;
    November counted from the 8th; winners checked and announced early the following month. Please have
    the reviewer read sections 3–6 again. One point for them to settle: today a student who completes
    their profile **after** the month has ended can still win it, because eligibility is checked when
    the organisers work the candidates out. Should the profile have to be complete by the month's end?
    (A deadline for a winner to respond is question 9.)

### Daily Quiz reminder emails (built 2026-10-09, Phase 7b — PLAN.md Q20)

13. **The Privacy Policy does not mention reminder emails yet, and has not been changed.** Since Phase 7b
    a student can ask for an email at 7:00 AM India time on days their class has a Daily Quiz they have
    not started — **off unless they turn it on** (My Profile → Notification preferences, or one tap on the
    Daily Quiz). It goes to the account's own email address, names the classes, the topic and that the
    quiz is open until 11:59 PM, and says how to turn it off; it is sent through the same email service
    the policy already mentions, and a record of it is kept for 14 days. The policy's list of emails ("to
    send emails you need — verifying your address, resetting a password, results and prize news") does not
    include it (nor staff announcements, which a student can also switch off). Questions for the reviewer:
    - **a.** Should the policy list the optional emails — the Daily Quiz reminder and announcements — with
      how to turn them off?
    - **b.** For a minor, is the student's own tap enough to turn a daily email on, or should a parent or
      guardian be told (or agree) — given that the address is often the parent's?
    - **c.** Should the 14-day record of reminders be stated alongside the retention answer in question 7?

## What the drafts deliberately do not say

- No refund window, refund timeline or cancellation remedy (questions 4–6).
- No organiser name, address, registration number or jurisdiction (questions 1–3).
- No claim that the site is DPDP-compliant — the consent record (question 8) is a minimum.
- Nothing about the optional Daily Quiz reminder email (question 13) — the legal text was left for you.
- The prize on the rules page is **fetched from the owner's settings** (Admin → Daily Quiz →
  Settings), and the winner rule and the class bands from the server's own rule (monthly since
  2026-10-09, fixed in code) — never typed into the page, so it follows a change to either.
