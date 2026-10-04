import type { ComponentType } from 'react'
import {
  BookOpen,
  ClipboardList,
  Flame,
  Gift,
  GraduationCap,
  Library,
  Lightbulb,
  MailCheck,
  Medal,
  Mountain,
  Pi,
  Send,
  Sprout,
  Target,
  TrendingUp,
  Trophy,
  UserPlus,
  Zap,
  type LucideProps,
} from 'lucide-react'

/**
 * The illustration registry — every name `Illustration` accepts, its display size, and
 * the line icon its placeholder shows until the real art is dropped into
 * `src/assets/illustrations/`. A plain module (not the component file) so the list can
 * be imported by the design-system page without breaking Fast Refresh.
 */

type IconComponent = ComponentType<LucideProps>

export interface IllustrationEntry {
  width: number
  height: number
  icon: IconComponent
}

export const ILLUSTRATIONS = {
  'hero-student': { width: 520, height: 520, icon: GraduationCap },
  'book-stack': { width: 360, height: 220, icon: BookOpen },
  trophy: { width: 220, height: 220, icon: Trophy },
  'gift-box': { width: 200, height: 200, icon: Gift },
  // The nine journey milestones (Milestone 30 Phase 3; PLAN.md Q7 — the owner chose the
  // platform's own milestones over the mockup's six themed months). Named after the stage
  // ids in `backend/src/lib/journey.ts`.
  'journey-enrolled': { width: 120, height: 104, icon: UserPlus },
  'journey-verified': { width: 120, height: 104, icon: MailCheck },
  'journey-first-practice': { width: 120, height: 104, icon: Target },
  'journey-first-quiz': { width: 120, height: 104, icon: Zap },
  'journey-habit': { width: 120, height: 104, icon: Flame },
  'journey-first-mock': { width: 120, height: 104, icon: ClipboardList },
  'journey-level-3': { width: 120, height: 104, icon: TrendingUp },
  'journey-seasoned': { width: 120, height: 104, icon: Library },
  'journey-olympiad-ready': { width: 120, height: 104, icon: Medal },
  'mountain-climber': { width: 360, height: 260, icon: Mountain },
  plant: { width: 120, height: 140, icon: Sprout },
  'light-bulb': { width: 160, height: 140, icon: Lightbulb },
  'maths-doodles': { width: 480, height: 360, icon: Pi },
  'paper-plane': { width: 120, height: 80, icon: Send },
} satisfies Record<string, IllustrationEntry>

export type IllustrationName = keyof typeof ILLUSTRATIONS

/** Every registered name, in registry order. */
export const ILLUSTRATION_NAMES = Object.keys(ILLUSTRATIONS) as IllustrationName[]
