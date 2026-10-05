import { z } from 'zod';
import { CLASS_LEVELS } from '../lib/classLevels';
import { dateOfBirth, email, mobile, optionalName, password, photo, requiredName } from './authSchemas';

/** `''` → `null`, so clearing a field stores nothing rather than an empty string. Absent stays absent. */
function emptyToNull<T>(value: T | '' | null | undefined): T | null | undefined {
  if (value === undefined) return undefined;
  return value === '' || value === null ? null : value;
}

/** Optional free text: absent leaves it, empty clears it, otherwise trimmed and bounded. */
function optionalText(label: string, min: number, max: number) {
  return z
    .union([
      z.literal(''),
      z.null(),
      z.string().trim().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be at most ${max} characters`),
    ])
    .optional()
    .transform(emptyToNull);
}

/**
 * Self-service profile editing.
 *
 * Every field here reuses the exact rule registration uses, imported rather than
 * restated: two definitions of "a valid name" would drift, and the looser one would
 * become the real policy the moment a student edited the field. See
 * `authSchemas.ts`, which is where those rules live.
 *
 * What is **deliberately absent** is as important as what is present:
 *
 *  - `email` — it is the login identifier and the anchor of email verification, so
 *    changing it needs a confirm-at-the-new-address flow (send a link to the new
 *    address, only switch when it is clicked) or it becomes an account-takeover
 *    primitive: set the address, then use "forgot password". That is its own piece
 *    of work, not a field on this form.
 *  - `mobile` — the other unique login identifier, same argument.
 *  - `studentId`, `role`, `status`, `isEmailVerified`, `tokenVersion` — a student
 *    must never be able to set any of these. They are not omitted by a filter in
 *    the handler but absent from the schema, and `validate` replaces the body with
 *    the parse result, so an extra key in the request cannot reach the update.
 */
export const updateProfileSchema = z.object({
  firstName: requiredName('First name'),
  middleName: optionalName('Middle name'),
  lastName: requiredName('Last name'),
  fatherName: requiredName("Father's name"),
  motherName: requiredName("Mother's name"),
  dateOfBirth,
  classLevel: z.enum(CLASS_LEVELS, { message: 'Select a class' }),
  schoolName: z
    .string({ error: 'Current school name is required' })
    .trim()
    .min(2, 'Current school name is required')
    .max(150),
  address: z.string({ error: 'Full address is required' }).trim().min(10, 'Enter the full address').max(500),

  /**
   * What a Daily Quiz winner needs on file (Milestone 30, brief §6.6): the city a prize is
   * delivered to and a parent or guardian to arrange it with — the winner is a child.
   *
   * **Optional keys**, unlike everything above: absent means "leave as it is", and an empty
   * string or `null` clears it. That is a deliberate exception to the full-replacement rule
   * for one reason — a page loaded before these fields existed submits without them, and a
   * required key would turn every such save into a validation error.
   */
  city: optionalText('City', 2, 80),
  guardianPhone: z.union([z.literal(''), z.null(), mobile]).optional().transform(emptyToNull),
  guardianEmail: z.union([z.literal(''), z.null(), email]).optional().transform(emptyToNull),
  /** Shown on public boards as "A Class 9 student" instead of a name and place. */
  hideFromPublicLists: z.boolean().optional(),
  /**
   * A parent or guardian's consent, for an account made before registration asked for it
   * (Milestone 30, Phase 6). Only `true` is accepted and only the first time counts — the
   * server records when. Withdrawing consent is a question for the legal review
   * (docs/launch/LEGAL_REVIEW.md), so there is no way to send `false`.
   */
  guardianConsent: z.literal(true).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Replacing the profile photo. Same 2 MB / magic-byte rule as registration. */
export const updatePhotoSchema = z.object({ photo });
export type UpdatePhotoInput = z.infer<typeof updatePhotoSchema>;

/**
 * Changing a password from account settings.
 *
 * The current password is required even though the caller already holds a valid
 * session: it is what stops a borrowed or stolen session from locking the real owner
 * out of their own account. `currentPassword` is checked for presence only — the
 * policy applies to the value being *set*, and rejecting the existing one for
 * failing today's rules would be a confusing way to say "wrong password".
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'The new password must be different from your current one',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const listActivityQuerySchema = z.object({ ...pagination });
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;

/**
 * The leaderboard query moved to `validation/leaderboardSchemas.ts` in Milestone 10,
 * when it gained a scope, a period and a page and stopped being "how many rows does the
 * landing page want".
 */
