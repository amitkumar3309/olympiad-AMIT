import { z } from 'zod';

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
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password must be at most 200 characters')
  .refine((v) => /[a-zA-Z]/.test(v), 'Password must contain at least one letter')
  .refine((v) => /\d/.test(v), 'Password must contain at least one number');

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  mobile,
  email,
  password,
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
