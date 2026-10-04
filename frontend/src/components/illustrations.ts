import type { ComponentType } from 'react'
import {
  BookOpen,
  Brain,
  Castle,
  Crown,
  Gift,
  GraduationCap,
  Lightbulb,
  Mountain,
  Pi,
  Send,
  Sprout,
  TreePine,
  Triangle,
  Trophy,
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
  'journey-number-forest': { width: 120, height: 104, icon: TreePine },
  'journey-logic-valley': { width: 120, height: 104, icon: Brain },
  'journey-algebra-castle': { width: 120, height: 104, icon: Castle },
  'journey-geometry-temple': { width: 120, height: 104, icon: Triangle },
  'journey-speed-arena': { width: 120, height: 104, icon: Zap },
  'journey-olympiad-kingdom': { width: 120, height: 104, icon: Crown },
  'mountain-climber': { width: 360, height: 260, icon: Mountain },
  plant: { width: 120, height: 140, icon: Sprout },
  'light-bulb': { width: 160, height: 140, icon: Lightbulb },
  'maths-doodles': { width: 480, height: 360, icon: Pi },
  'paper-plane': { width: 120, height: 80, icon: Send },
} satisfies Record<string, IllustrationEntry>

export type IllustrationName = keyof typeof ILLUSTRATIONS

/** Every registered name, in registry order. */
export const ILLUSTRATION_NAMES = Object.keys(ILLUSTRATIONS) as IllustrationName[]
