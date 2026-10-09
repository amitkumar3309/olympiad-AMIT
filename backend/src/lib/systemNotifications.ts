import type { EmailCategory } from '../models/EmailOutbox';
import type { NotificationKind } from '../models/Notification';
import { PRODUCT_NAME } from './brand';

/**
 * THE catalogue of things the platform tells a student about on its own.
 *
 * Pure data and pure functions — no database, no imports from a service. This is the
 * same discipline `lib/achievements.ts`, `lib/badges.ts` and `lib/journey.ts` follow,
 * and it is here for the same reason: the copy for an event, the category that
 * decides whether it may be emailed, and the rule about whether a student may switch
 * it off all belong in one readable table rather than spread across the six routes
 * that happen to fire them.
 *
 * Adding an event means adding a row here and one call at the place the event really
 * happens. It deliberately does **not** mean writing any notification or email logic
 * at the call site — that friction is what stops the seventh caller inventing a
 * seventh set of rules, exactly as the reward engine does for XP.
 */

export const SYSTEM_EVENTS = [
  'exam.published',
  'exam.results_published',
  'mocktest.published',
  'account.status_changed',
  'account.role_changed',
  'account.password_changed',
  'dailyquiz.winner_published',
] as const;

export type SystemEvent = (typeof SYSTEM_EVENTS)[number];

export interface SystemEventDefinition {
  event: SystemEvent;
  kind: NotificationKind;
  /**
   * Which email stream this belongs to, or `null` for in-app only.
   *
   * The two broadcasts are `null` on purpose. "A mock test has been published" going
   * to every student in a class by email is the exact free-tier deliverability
   * problem Milestone 12 declined to create, and it is low-stakes news that the
   * inbox and the bell already carry. Email is reserved for what a student would
   * genuinely regret missing.
   */
  emailCategory: EmailCategory | null;
  /** Where the notification and its email point. Relative app path. */
  link: string | null;
  actionLabel?: string;
}

export const SYSTEM_EVENT_DEFINITIONS: Record<SystemEvent, SystemEventDefinition> = {
  'exam.published': {
    event: 'exam.published',
    kind: 'announcement',
    emailCategory: null,
    link: '/exam',
    actionLabel: 'View the exam',
  },
  'exam.results_published': {
    event: 'exam.results_published',
    kind: 'alert',
    // The one piece of news the whole product exists to deliver.
    emailCategory: 'results',
    link: '/result',
    actionLabel: 'See my result',
  },
  'mocktest.published': {
    event: 'mocktest.published',
    kind: 'announcement',
    emailCategory: null,
    link: '/mock-tests',
    actionLabel: 'Open mock tests',
  },
  'account.status_changed': {
    event: 'account.status_changed',
    kind: 'alert',
    emailCategory: 'security',
    link: '/profile',
  },
  'account.role_changed': {
    event: 'account.role_changed',
    kind: 'alert',
    emailCategory: 'security',
    link: '/profile',
  },
  'account.password_changed': {
    event: 'account.password_changed',
    kind: 'alert',
    emailCategory: 'security',
    link: '/profile',
  },
  /**
   * A Daily Quiz winner, once an administrator has published them (Milestone 30) — a month's
   * winner in a class band since 2026-10-09. The `results` stream: news a student and their
   * parent would genuinely regret missing, and switchable like the exam result it resembles.
   */
  'dailyquiz.winner_published': {
    event: 'dailyquiz.winner_published',
    kind: 'alert',
    emailCategory: 'results',
    link: '/daily-quiz',
    actionLabel: 'See the Daily Quiz',
  },
};

/**
 * The streams a student may switch off — each one has a switch in
 * `Student.notificationPrefs`, and `emailAllowedFor()` maps it to that switch. `reminders`
 * (the Daily Quiz reminder, Milestone 30 Phase 7b) is the third, and the only one that is
 * off until the student turns it on.
 */
export const OPTIONAL_EMAIL_CATEGORIES = ['announcement', 'results', 'reminders'] as const satisfies readonly EmailCategory[];
export type OptionalEmailCategory = (typeof OPTIONAL_EMAIL_CATEGORIES)[number];

/**
 * True when a student may switch this stream off.
 *
 * `security` cannot be switched off, and that is a deliberate asymmetry rather than
 * an oversight: "your password was changed" and "your account was suspended" are the
 * messages that let somebody notice a compromise or an administrative mistake, so an
 * option to silence them would be a feature for an attacker. `transactional` is not
 * optional either, for the simpler reason that without it the account cannot be used
 * at all.
 *
 * A type guard, so the code after it knows which switch to read.
 */
export function isOptionalCategory(category: EmailCategory): category is OptionalEmailCategory {
  return (OPTIONAL_EMAIL_CATEGORIES as readonly EmailCategory[]).includes(category);
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export interface NotificationCopy {
  title: string;
  body: string;
}

/**
 * The one wording for each event, used by **both** the in-app row and the email.
 *
 * Shared on purpose. Two wordings of one event is how a student ends up believing
 * they are two events — and it is also how the email and the inbox come to disagree
 * about what happened, which is the same class of bug as two graders or two
 * leaderboards.
 */
export function examPublishedCopy(input: {
  title: string;
  opensAt: Date;
  closesAt: Date;
  durationMinutes: number;
}): NotificationCopy {
  return {
    title: `Official exam announced: ${input.title}`,
    body:
      `The official ${PRODUCT_NAME} paper "${input.title}" has been scheduled.\n\n` +
      `Opens: ${formatIst(input.opensAt)}\n` +
      `Closes: ${formatIst(input.closesAt)}\n` +
      `Duration: ${input.durationMinutes} minutes\n\n` +
      `You get one attempt only, and the timer is kept by the server — so start it when you are ready to sit the whole paper.`,
  };
}

export function resultsPublishedCopy(input: {
  examTitle: string;
  score: number;
  maxMarks: number;
  percentage: number;
  rank: number;
  totalCandidates: number;
  certificateTier: string | null;
}): NotificationCopy {
  const certificateLine = input.certificateTier
    ? `\n\nYour ${input.certificateTier} certificate has been issued and is ready to download from My certificates.`
    : '';

  return {
    title: `Your result for ${input.examTitle} is out`,
    body:
      `Results for "${input.examTitle}" have been released.\n\n` +
      `Score: ${input.score} / ${input.maxMarks} (${input.percentage}%)\n` +
      `Rank: ${input.rank} of ${input.totalCandidates}` +
      certificateLine,
  };
}

export function mockTestPublishedCopy(input: {
  title: string;
  questionCount: number;
  durationMinutes: number;
}): NotificationCopy {
  return {
    title: `New mock test: ${input.title}`,
    body:
      `A new mock test has been published for your class.\n\n` +
      `"${input.title}" — ${input.questionCount} question${input.questionCount === 1 ? '' : 's'}, ${input.durationMinutes} minutes.\n\n` +
      `A mock test is practice for the official paper. Your score here does not affect the Olympiad.`,
  };
}

export function statusChangedCopy(input: { status: string; byLabel: string | null }): NotificationCopy {
  const explanation: Record<string, string> = {
    active: 'Your account is active again. You can sign in and carry on as normal.',
    suspended: 'Your account has been suspended, so you cannot sign in for now.',
    blocked: 'Your account has been blocked, so you cannot sign in.',
    deactivated: 'Your account has been deactivated.',
  };

  return {
    title: `Your account status changed to ${input.status}`,
    body:
      `${explanation[input.status] ?? `Your account status is now "${input.status}".`}\n\n` +
      `If you were not expecting this, reply to this message or contact the ${PRODUCT_NAME} organisers.`,
  };
}

export function roleChangedCopy(input: { role: string }): NotificationCopy {
  return {
    title: `Your account role changed to ${input.role}`,
    body:
      `An administrator has changed your role on ${PRODUCT_NAME} to "${input.role}".\n\n` +
      `For your security every existing sign-in was ended, so you will need to sign in again.\n\n` +
      `If you were not expecting this, contact the organisers straight away.`,
  };
}

/**
 * The Daily Quiz winner's message. The prize is named as the settings named it when the
 * winner was confirmed — "Surprise gift + cash prize", or with a figure only if the owner
 * set one — and delivery is promised through a parent or guardian, which is how it works.
 */
export function dailyQuizWinnerCopy(input: { day: string; prizeText: string | null; cashAmount: number | null }): NotificationCopy {
  const prize = input.prizeText ?? 'a surprise gift and a cash prize';
  const cash = input.cashAmount !== null && input.cashAmount > 0 ? ` (₹${input.cashAmount.toLocaleString('en-IN')} cash)` : '';
  return {
    title: `You won the Daily Quiz for ${input.day}!`,
    body:
      `Congratulations — yours was the winning answer in the Daily Quiz on ${input.day}.\n\n` +
      `Your prize: ${prize}${cash}.\n\n` +
      `The ${PRODUCT_NAME} organisers will contact your parent or guardian on the number in your profile to arrange delivery. ` +
      `If that number is missing or out of date, update it in My Profile.`,
  };
}

/**
 * A monthly winner's message (since 2026-10-09 — PLAN.md Q24): the month and the class band
 * they won, and the prize as it was snapshotted when they were confirmed.
 */
export function dailyQuizMonthlyWinnerCopy(input: {
  month: string;
  band: string;
  prizeText: string | null;
  cashAmount: number | null;
}): NotificationCopy {
  const prize = input.prizeText ?? 'a surprise gift and a cash prize';
  const cash = input.cashAmount !== null && input.cashAmount > 0 ? ` (₹${input.cashAmount.toLocaleString('en-IN')} cash)` : '';
  return {
    title: `You won the Daily Quiz for ${input.month}!`,
    body:
      `Congratulations — you answered the most Daily Quizzes correctly in ${input.band} in ${input.month}.\n\n` +
      `Your prize: ${prize}${cash}.\n\n` +
      `The ${PRODUCT_NAME} organisers will contact your parent or guardian on the number in your profile to arrange delivery. ` +
      `If that number is missing or out of date, update it in My Profile.`,
  };
}

export function passwordChangedCopy(): NotificationCopy {
  return {
    title: `Your ${PRODUCT_NAME} password was changed`,
    body:
      `The password on your account has just been changed, and every other signed-in device was signed out.\n\n` +
      `If that was you, there is nothing to do.\n\n` +
      `If it was not, use "Forgot password" to regain control of the account immediately, and contact the organisers.`,
  };
}

/**
 * A human-readable IST timestamp for notification copy.
 *
 * IST rather than UTC because the whole product measures a competition day in IST
 * (`lib/competitionDay.ts`), the entrants are in India, and telling a child their
 * exam opens at "03:30" when their clock will say "09:00" is the kind of detail that
 * makes somebody miss a one-attempt paper.
 */
function formatIst(date: Date): string {
  return `${new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date)} IST`;
}
