import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../src/app';
import {
  AuditLog,
  Payment,
  Referral,
  ReferralSettings,
  Student,
  DEFAULT_ENTRY_FEE_PAISE,
} from '../src/models';
import { capturePayment } from '../src/services/paymentService';
import { attributeReferral } from '../src/services/referralService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  clearTestInbox,
  cookieHeader,
  createAdminSession,
  loginRootAdmin,
  registerVerifyLogin,
  validStudent,
} from './helpers/auth';

/**
 * Milestone 22, Phase E — Refer & Earn.
 *
 * The organising idea: **a referral programme is a way to pay money out, so most of this
 * file is about the ways it must refuse to.** Self-referral, a code that does not resolve,
 * a second attribution for the same registration, a reward accruing before the money
 * arrives, the same reward accruing twice from a duplicate webhook, a reward paid twice,
 * and an amount changing after it was earned.
 *
 * The second theme is that **no reward rule was invented**. Several tests assert that with
 * nothing configured a converted referral accrues *zero* and is reported as `no_reward` —
 * distinct from both "not converted" and "owed money" — because inventing a plausible
 * default would have started accruing real liabilities on the day it shipped.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);

afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

let mobileSeed = 9500000000;

/** A distinct student each time, so nothing collides on the unique mobile/email. */
function nextStudent(overrides: Partial<typeof validStudent> = {}): Partial<typeof validStudent> {
  mobileSeed += 1;
  return {
    email: `ref-${mobileSeed}@example.com`,
    mobile: String(mobileSeed),
    ...overrides,
  };
}

/** Registers a student and returns their session plus their referral code. */
async function referrer(overrides: Partial<typeof validStudent> = {}) {
  const session = await registerVerifyLogin(app, nextStudent(overrides), { paid: false });
  const res = await request(app)
    .get(`${API}/me/referrals`)
    .set('Cookie', cookieHeader(session.cookies))
    .expect(200);
  return { ...session, code: res.body.referral.code as string, summary: res.body.referral };
}

/** Registers a new student *with* a referral code. Returns the raw response. */
function registerWithCode(code: string, overrides: Partial<typeof validStudent> = {}): request.Test {
  return request(app)
    .post(`${API}/auth/register`)
    .send({ ...validStudent, ...nextStudent(overrides), referralCode: code });
}

/** Captures an entry payment for a student, through the real capture path. */
async function payFor(studentId: string): Promise<void> {
  const account = await Student.findOne({ studentId }).select('_id');
  if (!account) throw new Error(`No account ${studentId}`);

  const orderId = `order_ref_${randomUUID()}`;
  await Payment.create({
    student: account._id,
    purpose: 'olympiad_entry',
    amount: DEFAULT_ENTRY_FEE_PAISE,
    currency: 'INR',
    razorpayOrderId: orderId,
    status: 'created',
  });

  // Through `capturePayment()` rather than by writing `status: 'captured'` directly,
  // because the referral hook lives inside it — a test that set the field by hand would
  // pass against a build where the hook had been deleted.
  await capturePayment({ razorpayOrderId: orderId, razorpayPaymentId: `pay_${randomUUID()}`, source: 'webhook' });
}

async function enableReward(paise: number): Promise<void> {
  await ReferralSettings.findOneAndUpdate(
    { key: 'default' },
    { $set: { rewardEnabled: true, rewardAmount: paise } },
    { upsert: true, setDefaultsOnInsert: true },
  );
}

interface SummaryBody {
  referral: {
    code: string
    link: string
    settings: { rewardEnabled: boolean; rewardAmount: number; terms: string | null }
    counts: { total: number; pendingConversion: number; converted: number; rejected: number }
    rewards: { accruedPaise: number; approvedPaise: number; paidPaise: number }
    referrals: Array<{ id: string; name: string; rewardStatus: string; rewardAmount: number; converted: boolean }>
  }
}

async function summaryFor(cookies: Record<string, string>): Promise<SummaryBody['referral']> {
  const res = await request(app).get(`${API}/me/referrals`).set('Cookie', cookieHeader(cookies)).expect(200);
  return (res.body as SummaryBody).referral;
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

describe('referral codes', () => {
  it('gives a student a stable code in the documented shape', async () => {
    const student = await referrer();

    expect(student.code).toMatch(/^AMIT[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);

    // Asked for twice, the same code — it is generated once and then read.
    const again = await summaryFor(student.cookies);
    expect(again.code).toBe(student.code);
  });

  it('gives two students two different codes', async () => {
    const first = await referrer();
    const second = await referrer();

    expect(first.code).not.toBe(second.code);
  });

  it('is not the student id, which is only ten thousand walkable values', async () => {
    const student = await referrer();

    expect(student.code).not.toContain(student.studentId);
    expect(student.code).not.toMatch(/_\d{4}$/);
  });

  it('builds the share link from the configured app URL rather than a hardcoded domain', async () => {
    const student = await referrer();
    const summary = await summaryFor(student.cookies);

    expect(summary.link).toContain(`/register?ref=${student.code}`);
    expect(summary.link).not.toContain('amitolympiad.com');
  });
});

describe('GET /referrals/validate — the public check', () => {
  it('confirms a real code and publishes only a masked name', async () => {
    const student = await referrer({ firstName: 'Rahul', lastName: 'Sharma' });

    const res = await request(app).get(`${API}/referrals/validate?code=${student.code}`).expect(200);

    expect(res.body.valid).toBe(true);
    // The same masking the public leaderboard uses. A full legal name here would make this
    // an endpoint that turns codes into children's names.
    expect(res.body.referrerName).toBe('Rahul S.');
    expect(JSON.stringify(res.body)).not.toContain('Sharma');
  });

  it('answers "no" with a 200 for a code nobody holds', async () => {
    const res = await request(app).get(`${API}/referrals/validate?code=AMITZZZZZZ`).expect(200);

    expect(res.body.valid).toBe(false);
    expect(res.body.referrerName).toBeNull();
  });

  it('refuses a malformed code rather than searching for it', async () => {
    const res = await request(app).get(`${API}/referrals/validate?code=hello`);

    expect(res.status).toBe(400);
  });

  it('stops resolving once the referrer is suspended', async () => {
    const student = await referrer();
    await Student.updateOne({ studentId: student.studentId }, { $set: { status: 'suspended' } });

    const res = await request(app).get(`${API}/referrals/validate?code=${student.code}`).expect(200);

    // A code is a live invitation. An account that has lost standing should not keep
    // recruiting — though the referrals it already made are untouched.
    expect(res.body.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

describe('attribution at registration', () => {
  it('records who introduced a new student', async () => {
    const inviter = await referrer();

    const res = await registerWithCode(inviter.code).expect(201);
    const referredId = res.body.student.studentId as string;

    const referral = await Referral.findOne({ code: inviter.code });
    expect(referral).not.toBeNull();
    expect(referral?.rewardStatus).toBe('pending_conversion');
    expect(referral?.rewardAmount).toBe(0);

    const referredAccount = await Student.findOne({ studentId: referredId }).select('_id');
    expect(String(referral?.referred)).toBe(String(referredAccount?._id));
  });

  it('refuses a registration whose code does not resolve, and leaves no account behind', async () => {
    const before = await Student.countDocuments({});

    const res = await registerWithCode('AMITZZZZZZ');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('AMITZZZZZZ');
    // The half-registered account is rolled back — the same treatment a failed photo write
    // gets. A student refused for a bad code must be able to submit the form again.
    expect(await Student.countDocuments({})).toBe(before);
    expect(await Referral.countDocuments({})).toBe(0);
  });

  it('refuses a malformed code at the schema, before any account is created', async () => {
    const before = await Student.countDocuments({});

    const res = await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, ...nextStudent(), referralCode: 'not-a-code' });

    expect(res.status).toBe(400);
    expect(await Student.countDocuments({})).toBe(before);
  });

  it('registers normally when no code is given', async () => {
    const res = await request(app).post(`${API}/auth/register`).send({ ...validStudent, ...nextStudent() });

    expect(res.status).toBe(201);
    expect(await Referral.countDocuments({})).toBe(0);
  });

  it('accepts a code in the wrong case, so a shared link is not case-sensitive', async () => {
    const inviter = await referrer();

    const res = await registerWithCode(inviter.code.toLowerCase());

    expect(res.status).toBe(201);
    expect(await Referral.countDocuments({ code: inviter.code })).toBe(1);
  });

  it('cannot attribute one registration to two referrers', async () => {
    const inviter = await referrer();
    const other = await referrer();

    const res = await registerWithCode(inviter.code).expect(201);
    const referredAccount = await Student.findOne({ studentId: res.body.student.studentId }).select('_id');

    // A second row for the same referred account is refused by the unique index, not by a
    // handler check — which is what makes it safe against a race.
    await expect(
      Referral.create({
        referrer: (await Student.findOne({ studentId: other.studentId }).select('_id'))!._id,
        referred: referredAccount!._id,
        code: other.code,
        registeredAt: new Date(),
      }),
    ).rejects.toThrow();

    expect(await Referral.countDocuments({ referred: referredAccount!._id })).toBe(1);
  });

  it('refuses a self-referral', async () => {
    const student = await referrer();
    const account = await Student.findOne({ studentId: student.studentId }).select('_id');

    await expect(
      attributeReferral({ code: student.code, referred: account!._id as never }),
    ).rejects.toThrow(/refer yourself/i);

    expect(await Referral.countDocuments({})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Conversion — the money half
// ---------------------------------------------------------------------------

describe('a referral converts on captured money, not on a registration', () => {
  it('stays pending until the referred student actually pays', async () => {
    const inviter = await referrer();
    await registerWithCode(inviter.code).expect(201);

    const summary = await summaryFor(inviter.cookies);

    expect(summary.counts.total).toBe(1);
    expect(summary.counts.pendingConversion).toBe(1);
    expect(summary.counts.converted).toBe(0);
    expect(summary.rewards.accruedPaise).toBe(0);
  });

  it('converts and accrues the configured amount when the payment is captured', async () => {
    await enableReward(5_000);
    const inviter = await referrer();
    const res = await registerWithCode(inviter.code).expect(201);

    await payFor(res.body.student.studentId as string);

    const summary = await summaryFor(inviter.cookies);
    expect(summary.counts.converted).toBe(1);
    expect(summary.counts.pendingConversion).toBe(0);
    expect(summary.rewards.accruedPaise).toBe(5_000);
    expect(summary.referrals[0]?.rewardStatus).toBe('accrued');
  });

  it('converts to `no_reward` — not to a debt — when nothing is configured', async () => {
    const inviter = await referrer();
    const res = await registerWithCode(inviter.code).expect(201);

    await payFor(res.body.student.studentId as string);

    const summary = await summaryFor(inviter.cookies);
    // The introduction converted and is counted. Nothing is owed, and the state says so
    // rather than showing a pending reward of zero.
    expect(summary.counts.converted).toBe(1);
    expect(summary.referrals[0]?.rewardStatus).toBe('no_reward');
    expect(summary.referrals[0]?.rewardAmount).toBe(0);
    expect(summary.rewards.accruedPaise).toBe(0);
    expect(summary.settings.rewardEnabled).toBe(false);
  });

  it('does not accrue twice when the payment is captured twice', async () => {
    await enableReward(5_000);
    const inviter = await referrer();
    const res = await registerWithCode(inviter.code).expect(201);
    const referredId = res.body.student.studentId as string;

    await payFor(referredId);

    // A duplicate webhook against the same order: `capturePayment()` reports `changed:
    // false` and the referral update is conditional on `pending_conversion`, so neither
    // path can accrue a second time.
    const account = await Student.findOne({ studentId: referredId }).select('_id');
    const payment = await Payment.findOne({ student: account!._id });
    await capturePayment({
      razorpayOrderId: payment!.razorpayOrderId,
      razorpayPaymentId: 'pay_duplicate',
      source: 'webhook',
    });

    const summary = await summaryFor(inviter.cookies);
    expect(summary.counts.total).toBe(1);
    expect(summary.rewards.accruedPaise).toBe(5_000);
    expect(await Referral.countDocuments({})).toBe(1);
  });

  it('does not re-price a reward that has already accrued', async () => {
    await enableReward(5_000);
    const inviter = await referrer();
    const res = await registerWithCode(inviter.code).expect(201);
    await payFor(res.body.student.studentId as string);

    // The owner doubles the reward afterwards. The snapshot must not move — the same rule
    // `Payment.amount` and `StudentActivity.xpAwarded` follow.
    await enableReward(10_000);

    const summary = await summaryFor(inviter.cookies);
    expect(summary.rewards.accruedPaise).toBe(5_000);
  });

  it('heals a referral that missed its hook, by reading the payment on the next look', async () => {
    await enableReward(5_000);
    const inviter = await referrer();
    const res = await registerWithCode(inviter.code).expect(201);
    const referredId = res.body.student.studentId as string;
    const account = await Student.findOne({ studentId: referredId }).select('_id');

    // A capture that the hook never saw — a process that died between the two writes, or a
    // referral created after the fact by support.
    await Payment.create({
      student: account!._id,
      purpose: 'olympiad_entry',
      amount: DEFAULT_ENTRY_FEE_PAISE,
      currency: 'INR',
      razorpayOrderId: `order_missed_${randomUUID()}`,
      status: 'captured',
      capturedAt: new Date(),
    });

    const summary = await summaryFor(inviter.cookies);

    // Read-time reconciliation, the same answer `reconcileOrder()` gives for payments.
    expect(summary.counts.converted).toBe(1);
    expect(summary.rewards.accruedPaise).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// The student's own dashboard
// ---------------------------------------------------------------------------

describe('GET /me/referrals', () => {
  it('masks the names of the students it lists', async () => {
    const inviter = await referrer();
    await registerWithCode(inviter.code, { firstName: 'Meera', lastName: 'Iyer' }).expect(201);

    const summary = await summaryFor(inviter.cookies);

    // A referral list is a list of children, and the student reading it is not staff.
    expect(summary.referrals[0]?.name).toBe('Meera I.');
    expect(JSON.stringify(summary)).not.toContain('Iyer');
  });

  it('shows nothing but zeros for a student who has referred nobody', async () => {
    const student = await referrer();

    const summary = await summaryFor(student.cookies);

    expect(summary.counts.total).toBe(0);
    expect(summary.rewards).toEqual({ accruedPaise: 0, approvedPaise: 0, paidPaise: 0 });
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(app).get(`${API}/me/referrals`);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// The administrative console
// ---------------------------------------------------------------------------

describe('the referral console', () => {
  it('lists both parties and derives whether the referred student has paid', async () => {
    await enableReward(5_000);
    const admin = await createAdminSession(app, nextStudent());
    const inviter = await referrer();
    const res = await registerWithCode(inviter.code).expect(201);
    await payFor(res.body.student.studentId as string);

    const list = await request(app)
      .get(`${API}/admin/referrals`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    const row = list.body.referrals[0];
    expect(row.referrer.studentId).toBe(inviter.studentId);
    expect(row.referred.studentId).toBe(res.body.student.studentId);
    // Derived from the payment record at read time, never trusted from the referral row.
    expect(row.referredHasPaid).toBe(true);
    expect(row.rewardStatus).toBe('accrued');
    expect(list.body.totals.accruedDisplay).toBe('₹50.00');
  });

  it('refuses a plain student, on both URL prefixes', async () => {
    const student = await registerVerifyLogin(app, nextStudent());

    const versioned = await request(app)
      .get(`${API}/admin/referrals`)
      .set('Cookie', cookieHeader(student.cookies));
    const alias = await request(app)
      .get('/api/admin/referrals')
      .set('Cookie', cookieHeader(student.cookies));

    expect(versioned.status).toBe(403);
    expect(alias.status).toBe(403);
  });
});

describe('moving a reward along its path', () => {
  async function accruedReferral() {
    await enableReward(5_000);
    const admin = await createAdminSession(app, nextStudent());
    const inviter = await referrer();
    const res = await registerWithCode(inviter.code).expect(201);
    await payFor(res.body.student.studentId as string);

    const list = await request(app)
      .get(`${API}/admin/referrals`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    return { admin, inviter, id: list.body.referrals[0].id as string };
  }

  it('approves, then pays, and records both against the trail', async () => {
    const { admin, id } = await accruedReferral();

    await request(app)
      .post(`${API}/admin/referrals/${id}/approve`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    await request(app)
      .post(`${API}/admin/referrals/${id}/mark-paid`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ payoutReference: 'UPI 402931' })
      .expect(200);

    const referral = await Referral.findById(id);
    expect(referral?.rewardStatus).toBe('paid');
    expect(referral?.payoutReference).toBe('UPI 402931');
    expect(referral?.approvedBy).toBeTruthy();

    const entries = await AuditLog.find({ action: 'referral.reward.changed' }).sort({ createdAt: 1 });
    expect(entries).toHaveLength(2);
    expect(entries[0]?.metadata?.action).toBe('approved');
    expect(entries[1]?.metadata?.action).toBe('paid');
    // The amount is on the entry, because it is the fact somebody will be checking.
    expect(entries[1]?.metadata?.amountPaise).toBe(5_000);
  });

  it('will not pay a reward twice', async () => {
    const { admin, id } = await accruedReferral();

    await request(app)
      .post(`${API}/admin/referrals/${id}/approve`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);
    await request(app)
      .post(`${API}/admin/referrals/${id}/mark-paid`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ payoutReference: 'UPI 402931' })
      .expect(200);

    const second = await request(app)
      .post(`${API}/admin/referrals/${id}/mark-paid`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ payoutReference: 'UPI 999999' });

    // A conditional write, so two administrators pressing this at once produce one payout.
    expect(second.status).toBe(409);
    const referral = await Referral.findById(id);
    expect(referral?.payoutReference).toBe('UPI 402931');
  });

  it('will not pay a reward that was never approved', async () => {
    const { admin, id } = await accruedReferral();

    const res = await request(app)
      .post(`${API}/admin/referrals/${id}/mark-paid`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ payoutReference: 'UPI 402931' });

    // Approving and paying are two decisions; collapsing them removes the only checkpoint
    // between "this looks payable" and "money has left".
    expect(res.status).toBe(409);
    expect((await Referral.findById(id))?.rewardStatus).toBe('accrued');
  });

  it('will not approve a referral that has not converted', async () => {
    const admin = await createAdminSession(app, nextStudent());
    const inviter = await referrer();
    await registerWithCode(inviter.code).expect(201);

    const list = await request(app)
      .get(`${API}/admin/referrals`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    const res = await request(app)
      .post(`${API}/admin/referrals/${list.body.referrals[0].id}/approve`)
      .set('Cookie', cookieHeader(admin.cookies));

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('pending conversion');
  });

  it('requires a payout reference and a rejection reason', async () => {
    const { admin, id } = await accruedReferral();

    await request(app)
      .post(`${API}/admin/referrals/${id}/approve`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    const noReference = await request(app)
      .post(`${API}/admin/referrals/${id}/mark-paid`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({});
    const noReason = await request(app)
      .post(`${API}/admin/referrals/${id}/reject`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({});

    expect(noReference.status).toBe(400);
    expect(noReason.status).toBe(400);
  });

  it('cannot reject a reward that has already been paid', async () => {
    const { admin, id } = await accruedReferral();

    await request(app)
      .post(`${API}/admin/referrals/${id}/approve`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);
    await request(app)
      .post(`${API}/admin/referrals/${id}/mark-paid`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ payoutReference: 'UPI 1' })
      .expect(200);

    const res = await request(app)
      .post(`${API}/admin/referrals/${id}/reject`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ reason: 'Changed my mind' });

    expect(res.status).toBe(409);
  });

  it('accepts no amount from the request — the snapshot is the authority', async () => {
    const { admin, id } = await accruedReferral();

    await request(app)
      .post(`${API}/admin/referrals/${id}/approve`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ rewardAmount: 999_999 })
      .expect(200);

    // The same rule that keeps XP, ranks and the entry fee out of request bodies.
    expect((await Referral.findById(id))?.rewardAmount).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

describe('referral authorization', () => {
  it('lets an administrator read the console but keeps payouts behind their own permission', async () => {
    const admin = await createAdminSession(app, nextStudent());

    // `students:read` covers the console; `referrals:write` covers the money. Both sit
    // with `admin`, so this asserts the routes are wired to the right ones rather than
    // that the roles differ.
    const read = await request(app).get(`${API}/admin/referrals`).set('Cookie', cookieHeader(admin.cookies));
    const settings = await request(app)
      .get(`${API}/admin/referral-settings`)
      .set('Cookie', cookieHeader(admin.cookies));

    expect(read.status).toBe(200);
    expect(settings.status).toBe(200);
  });

  it('refuses a plain student every administrative route', async () => {
    const student = await registerVerifyLogin(app, nextStudent());
    const cookie = cookieHeader(student.cookies);

    const list = await request(app).get(`${API}/admin/referrals`).set('Cookie', cookie);
    const settings = await request(app).get(`${API}/admin/referral-settings`).set('Cookie', cookie);
    const save = await request(app)
      .put(`${API}/admin/referral-settings`)
      .set('Cookie', cookie)
      .send({ rewardEnabled: true, rewardAmount: 100_000 });

    expect(list.status).toBe(403);
    expect(settings.status).toBe(403);
    expect(save.status).toBe(403);
  });
});

describe('the reward settings', () => {
  it('default to off and worth nothing, because no rule was ever specified', async () => {
    const admin = await createAdminSession(app, nextStudent());

    const res = await request(app)
      .get(`${API}/admin/referral-settings`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    expect(res.body.rewardEnabled).toBe(false);
    expect(res.body.rewardAmount).toBe(0);
    expect(res.body.terms).toBeNull();
  });

  it('records both sides of a change in the audit trail', async () => {
    const root = await loginRootAdmin(app);

    await request(app)
      .put(`${API}/admin/referral-settings`)
      .set('Cookie', cookieHeader(root))
      .send({ rewardEnabled: true, rewardAmount: 5_000, terms: '₹50 when your friend pays the entry fee.' })
      .expect(200);

    const entry = await AuditLog.findOne({ action: 'referral.settings.updated' });
    expect(entry?.metadata?.fromPaise).toBe(0);
    expect(entry?.metadata?.toPaise).toBe(5_000);
    expect(entry?.metadata?.fromEnabled).toBe(false);
    expect(entry?.metadata?.toEnabled).toBe(true);
  });

  it('refuses an implausibly large amount rather than accruing it', async () => {
    const root = await loginRootAdmin(app);

    const res = await request(app)
      .put(`${API}/admin/referral-settings`)
      .set('Cookie', cookieHeader(root))
      .send({ rewardEnabled: true, rewardAmount: 999_999_999 });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The student directory learns about referrals
// ---------------------------------------------------------------------------

describe('the admin student directory', () => {
  it('shows a student’s own code and who introduced them', async () => {
    const admin = await createAdminSession(app, nextStudent());
    const inviter = await referrer({ firstName: 'Inviting', lastName: 'Student' });
    const res = await registerWithCode(inviter.code).expect(201);

    const list = await request(app)
      .get(`${API}/admin/students?limit=100`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    const referredRow = list.body.students.find(
      (row: { studentId: string }) => row.studentId === res.body.student.studentId,
    );
    const inviterRow = list.body.students.find(
      (row: { studentId: string }) => row.studentId === inviter.studentId,
    );

    expect(referredRow.referredBy.studentId).toBe(inviter.studentId);
    expect(referredRow.referredBy.code).toBe(inviter.code);
    expect(inviterRow.referralCode).toBe(inviter.code);
    // Nobody introduced the inviter.
    expect(inviterRow.referredBy).toBeNull();
  });
});
