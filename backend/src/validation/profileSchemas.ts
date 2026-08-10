import { z } from 'zod';
import { CLASS_LEVELS } from '../lib/classLevels';
import { dateOfBirth, optionalName, password, photo, requiredName } from './authSchemas';

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

/** Public leaderboard sizing. Capped so the endpoint cannot be used to dump the roll. */
export const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
