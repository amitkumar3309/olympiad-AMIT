import { z } from 'zod';
import { RESET_SCOPES } from '../services/contentResetService';

/**
 * The content reset (Milestone 22).
 *
 * The scope is an enum from the service's own list, so a path segment can never become
 * anything but one of four known words — this route empties collections, and it is the
 * last place a loosely-typed parameter belongs.
 */
export const resetScopeParamSchema = z.object({
  scope: z.enum(RESET_SCOPES),
});
export type ResetScopeParam = z.infer<typeof resetScopeParamSchema>;

/**
 * The typed confirmation.
 *
 * Required and non-empty here; the **exact phrase** is compared in the route against
 * `CONFIRM_PHRASES[scope]`, because the correct value depends on the scope and a schema
 * cannot see the path parameter. Two layers, and they are guarding different things: this
 * one refuses a request with no confirmation at all — including a bare `POST` from a
 * script or a stray `fetch` — and the route refuses a confirmation meant for a different
 * area.
 *
 * Note what this is **not**: authorization. That is `content:reset`, which only the super
 * admin holds. A typed phrase stops the wrong click, never the wrong person.
 */
export const resetConfirmSchema = z.object({
  confirm: z
    .string({ error: 'Type the confirmation phrase to continue' })
    .trim()
    .min(1, 'Type the confirmation phrase to continue')
    .max(100),
});
export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;
