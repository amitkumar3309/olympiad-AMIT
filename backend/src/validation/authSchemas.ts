import { z } from 'zod';

export const registerSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required'),
  mobile: z.string().trim().min(1, 'Mobile number is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  mobile: z.string().trim().min(1, 'Mobile number is required'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const adminLoginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
