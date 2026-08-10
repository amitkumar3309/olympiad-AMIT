import { z } from 'zod';
import { CLASS_LEVELS } from '../lib/classLevels';
import { MAX_PHOTO_BYTES, PHOTO_CONTENT_TYPES, type PhotoContentType } from '../models/StudentPhoto';

/** Indian-style 10-digit mobile, tolerant of spaces/dashes which we strip. */
const mobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{10,15}$/, 'Mobile number must be 10–15 digits'));

const email = z.string().trim().toLowerCase().pipe(z.string().email('Enter a valid email address'));

/**
 * Password policy. Deliberately length-first rather than a thicket of character
 * classes: length is what actually resists guessing, and over-strict class rules
 * push people toward predictable substitutions.
 */
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password must be at most 200 characters')
  .refine((v) => /[a-zA-Z]/.test(v), 'Password must contain at least one letter')
  .refine((v) => /\d/.test(v), 'Password must contain at least one number');

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
 * The leading bytes every accepted format starts with. A browser (or a script
 * posting directly) controls the MIME type in the data URL, so it is checked
 * against the actual file signature rather than trusted — otherwise
 * `data:image/png;base64,<anything at all>` would be stored and later served
 * back with an image content type.
 */
const MAGIC_BYTES: Record<PhotoContentType, (buf: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

const MAX_PHOTO_KB = Math.round(MAX_PHOTO_BYTES / 1024);

/**
 * The photo is carried as a base64 data URL inside the JSON body rather than as
 * a multipart upload: it keeps registration a single atomic request, needs no
 * new dependency, and works with the existing `validate` middleware and the
 * `{ success, ... }` envelope. See the Milestone 4 ADR in DECISIONS.md.
 */
export const photo = z
  .string({ error: 'A photo is required' })
  .min(1, 'A photo is required')
  .superRefine((value, ctx) => {
    const match = /^data:([a-z]+\/[a-z0-9+.-]+);base64,(.+)$/i.exec(value);
    if (!match?.[1] || !match[2]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The photo must be a base64-encoded image' });
      return;
    }

    const [, declaredType, encoded] = match;
    if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(declaredType.toLowerCase())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The photo must be a JPEG, PNG or WebP image' });
      return;
    }

    const data = Buffer.from(encoded, 'base64');
    if (data.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The photo could not be read. Please choose the file again.' });
      return;
    }
    if (data.length > MAX_PHOTO_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The photo must be ${MAX_PHOTO_KB} KB or smaller` });
      return;
    }
    if (!MAGIC_BYTES[declaredType.toLowerCase() as PhotoContentType](data)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That file is not a valid JPEG, PNG or WebP image' });
    }
  })
  .transform((value) => {
    // Safe to assert: superRefine above has already rejected anything else.
    const match = /^data:([a-z]+\/[a-z0-9+.-]+);base64,(.+)$/i.exec(value)!;
    return {
      contentType: match[1]!.toLowerCase() as PhotoContentType,
      data: Buffer.from(match[2]!, 'base64'),
    };
  });

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
