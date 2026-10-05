import { ACTIVITY_LABELS, type ActivityEntry } from '../api/types'

/**
 * How one recorded event reads in a feed (Milestone 30, Phase 4) — shared by the
 * dashboard's "Recent activity" card and `/activity`, so the two cannot word it
 * differently.
 */

/** The event's label, and its detail when that adds something — some details repeat the label. */
export function activityTitle(entry: ActivityEntry): string {
  const label = ACTIVITY_LABELS[entry.type]?.label ?? entry.type
  const detail = entry.detail?.trim()
  if (!detail || detail.toLowerCase() === label.trim().toLowerCase()) return label
  return `${label} — ${detail}`
}

/** The event's Phosphor glyph (from the catalogue in `api/types.ts`). */
export function activityIcon(entry: ActivityEntry): string {
  return ACTIVITY_LABELS[entry.type]?.icon ?? 'ph-dot'
}
