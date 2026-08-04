import bcrypt from 'bcryptjs';
import { config } from '../config';

/**
 * bcrypt embeds its cost factor in the hash, so raising `bcryptRounds` does not
 * invalidate existing hashes — `compare` keeps working with older ones and they
 * are upgraded naturally the next time the password is set.
 */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.auth.bcryptRounds);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
