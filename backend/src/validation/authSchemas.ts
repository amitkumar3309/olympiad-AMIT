import { z } from 'zod';
import { CLASS_LEVELS } from '../lib/classLevels';
import { MAX_PHOTO_BYTES } from '../models/StudentPhoto';
import { imageDataUrl } from './imageSchemas';
import { referralCode } from './referralSchemas';

/** Indian-style 10-digit mobile, tolerant of spaces/dashes which we strip. */
const mobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{10,15}$/, 'Mobile number must be 10–15 digits'));

const email = z.string().trim().toLowerCase().pipe(z.string().email('Enter a valid email address'));

/**
 * The password policy, and the **one** definition of it on the server: registration,
 * the reset-link flow and the account-settings change all import this, so a password
 * that can be set one way can be set every way.
 *
 * ## Composition rules are the owner's decision (2026-09-02)
 *
 * This was deliberately length-first until then, on the standard argument that length
 * is what resists guessing while class rules push people toward `Password1!`. The owner
 * asked for the familiar set instead, and that is a legitimate call — it is what most
 * entrants and their parents expect to be asked for, and an unexpectedly permissive
 * form reads as an insecure one. The length floor is kept, because the classes are an
 * addition to it rather than a replacement.
 *
 * Each rule is a separate `refine` on purpose: zod reports them all in one pass, so the
 * form can tell a reader everything their password is missing at once instead of
 * revealing the next problem after each attempt.
 *
 * `frontend/src/lib/passwordPolicy.ts` mirrors these rules for the live checklist under
 * the field. **This file is the authority**; that one exists so the reader is not told
 * about a problem only after submitting. If you change a rule here, change it there.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Anything that is not a letter or a digit. Spaces count, and are not trimmed away. */
const SPECIAL_CHARACTER = /[^A-Za-z0-9]/;

export const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200, 'Password must be at most 200 characters')
  .refine((v) => /[a-z]/.test(v), 'Password must contain at least one lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Password must contain at least one uppercase letter')
  .refine((v) => /\d/.test(v), 'Password must contain at least one number')
  .refine((v) => SPECIAL_CHARACTER.test(v), 'Password must contain at least one special character, such as ! ? @ or #');

/**
 * A person's name as typed on a form. `\p{L}` rather than `A-Za-z` so a name in
 * any Indian script is accepted — this is a national competition, and a
 * Latin-only rule would reject real students. `\p{M}` matters just as much:
 * Indic vowel signs (the `ि` in `अमित`) are combining *marks*, not letters, so
 * omitting it rejects most Devanagari names. An empty string passes here so the
 * optional variant can map it to `null` afterwards.
 */
const NAME_PATTERN = /^[\p{L}][\p{L}\p{M}\s.'-]*$/u;

function nameShape(label: string) {
  return z
    // The message is set on the type itself, not only on `.min()`, so an
    // *absent* field says "Last name is required" rather than zod's default
    // "expected string, received undefined".
    .string({ error: `${label} is required` })
    .trim()
    .max(60, `${label} must be at most 60 characters`)
    .refine(
      (v) => v === '' || NAME_PATTERN.test(v),
      `${label} may only contain letters, spaces, apostrophes, hyphens and full stops`,
    );
}

export function requiredName(label: string) {
  return nameShape(label).refine((v) => v.length >= 2, `${label} is required`);
}

/**
 * Absent, `null`, empty or whitespace all normalise to `null`, so the column has
 * exactly one representation of "no value".
 *
 * `nullish` rather than `optional`: a form omits a field it has no value for, but a
 * JSON client *clearing* one sends an explicit `null`, and both mean the same thing
 * here. Accepting only `undefined` made "remove my middle name" a 400 on the profile
 * edit endpoint.
 */
export function optionalName(label: string) {
  return nameShape(label)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null));
}

/**
 * Date of birth arrives as `YYYY-MM-DD` from the form's native date input. The
 * bounds are deliberately loose — wide enough never to reject a real entrant for
 * classes 5–12, tight enough to catch a typo'd century or a future date.
 */
export const dateOfBirth = z
  .string({ error: 'Date of birth is required' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date of birth as YYYY-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Enter a valid date of birth')
  .refine((d) => d.getTime() < Date.now(), 'Date of birth cannot be in the future')
  .refine((d) => {
    const years = (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    return years >= 5 && years <= 40;
  }, 'Date of birth must correspond to an age between 5 and 40');

/**
 * The registration photo: a base64 data URL, ≤ 2 MB, validated by magic bytes.
 *
 * The implementation moved to `imageSchemas.ts` in Milestone 12, when the event
 * gallery became a second upload surface. Two copies of a signature check is how
 * one of them ends up trusting a declared MIME type — see that file.
 */
export const photo = imageDataUrl(MAX_PHOTO_BYTES, 'photo');

export const registerSchema = z.object({
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
  mobile,
  email,
  password,
  photo,
  /**
   * The referral code from `?ref=` on the link they followed (Milestone 22, Phase E).
   *
   * Optional — most registrations have none — but **validated when present**, and the
   * handler refuses the registration if it does not resolve. Silently dropping it would
   * mean the referrer never gets credit and nobody ever finds out why; the register page
   * checks the code from the link before the form is submitted, so in practice a student
   * meets that refusal only if they typed one in by hand.
   */
  referralCode: referralCode.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Login accepts either the mobile number or the email address in one field
 * (owner's choice — see DECISIONS.md), so we validate only that something was
 * supplied and classify it in the handler.
 */
export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your mobile number or email'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const adminLoginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(1, 'Verification token is required'),
});

export const resendVerificationSchema = z.object({ email });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Reset token is required'),
  password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
