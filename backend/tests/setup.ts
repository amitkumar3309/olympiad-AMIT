import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

// This foundation test suite never connects to a real database (see
// DECISIONS.md). Disabling command buffering means any test that
// accidentally exercises a DB-touching route fails fast with a clear
// "not connected" error instead of hanging until a timeout.
mongoose.set('bufferCommands', false);

/**
 * Root-administrator credentials for the RBAC suite.
 *
 * Set here rather than committed as a fixture so no password hash — even a
 * throwaway one — ever lands in the repository. This runs before any test file
 * imports `src/config`, which reads `process.env` once at module load.
 * `NODE_ENV=test` means the real `.env` is never loaded, so this cannot collide
 * with a developer's actual admin credentials.
 */
process.env.ADMIN_EMAIL = 'root-admin@amit.test';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('RootAdminPass9', 4);
