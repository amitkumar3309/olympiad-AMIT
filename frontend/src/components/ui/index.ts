/**
 * The design system's public surface (Milestone 23 Phase A; extended in Milestone 26).
 *
 * Import from here rather than from the individual files:
 *
 *     import { Button, Card, Section, Field, Input, Badge } from '../../components/ui'
 *
 * ## Thirty-four primitives, and no near-duplicates
 *
 * Twenty-five through Milestone 26; Milestone 30 added nine for the launch mockups
 * (`CountUp`, `Reveal`, `OptionTile`, `Countdown`, `Podium`, `LeaderboardTable`,
 * `JourneyTrack`, `ActivityList`, `Confetti`) — see the block at the end of the file.
 *
 * Milestone 26 added five — `Section`, `IconTile`, `Avatar`, `Menu`, `Breadcrumb` —
 * and the discipline that matters is the ones it did **not** add. There is no
 * `PageHeader` (that is `Section` with `size="page"`), no `IconButton` (that is
 * `Button` with `iconOnly`), no `Search` (that is `SearchInput`), no `Drawer` (the one
 * drawer in the product is the navigation's, and it belongs to `AppShell`), and no
 * `Dropdown` separate from `Menu`. A design system earns its keep by being the only
 * answer to a question; two components that nearly do the same thing put the decision
 * back on every call site.
 *
 * ## What belongs in this folder
 *
 * A component belongs here if it has **no knowledge of this product's domain**. A
 * badge does not know what a payment state is; a table does not know what a student
 * is. That boundary is what stops the design system from becoming a second place
 * where business rules live — and it is why `EntryFeeBanner`, `Recommendations`,
 * `MathText` and the two shells stay in `components/`, where they can talk about
 * entry fees and answer keys.
 *
 * ## Compatibility
 *
 * `components/Button.tsx`, `components/Spinner.tsx` and `components/StatTile.tsx`
 * re-export from here, so the eighty-eight existing imports of those three keep
 * working and pick up the new design. New code should import from `components/ui`.
 */

export { default as Icon } from './Icon'
export type { IconProps, IconSize, IconWeight } from './Icon'

export { default as Button, ButtonLink } from './Button'
export type { ButtonProps, ButtonSize, ButtonVariant, ButtonIcon } from './Button'

export { default as Card, CardHeader, CardBody, CardFooter } from './Card'
export type { CardProps, CardHeaderProps } from './Card'

/**
 * `Section` is the page's rhythm unit — eyebrow, heading, lead, content — and with
 * `titleAs="h1" size="page"` it is also the page header. There is deliberately no
 * separate `PageHeader`: the two are the same shape at two sizes.
 */
export { default as Section } from './Section'
export type { SectionProps } from './Section'

/** THE only place the categorical palette appears. See the note in the file. */
export { default as IconTile } from './IconTile'
export type { IconTileProps, IconTileTone } from './IconTile'

export { default as Avatar } from './Avatar'
export type { AvatarProps } from './Avatar'

export { default as Menu } from './Menu'
export type { MenuProps, MenuItem, MenuAction, MenuSeparator } from './Menu'

export { default as Breadcrumb } from './Breadcrumb'
export type { BreadcrumbProps, Crumb } from './Breadcrumb'

export { default as Badge } from './Badge'
export type { BadgeProps, BadgeTone } from './Badge'

export { default as Alert } from './Alert'
export type { AlertProps, AlertTone } from './Alert'

export { default as Field } from './Field'
export type { FieldProps } from './Field'
export { useFieldContext } from './fieldContext'
export type { FieldContextValue } from './fieldContext'

export { Input, PasswordInput, Textarea, Select, Checkbox, SearchInput } from './Input'
export type {
  InputProps,
  PasswordInputProps,
  TextareaProps,
  SelectProps,
  CheckboxProps,
  SearchInputProps,
} from './Input'

export { default as Modal } from './Modal'
export type { ModalProps } from './Modal'

export { default as ToastProvider } from './ToastProvider'
export { useToast } from './toastContext'
export type { Toast, ToastApi, ToastInput, ToastTone } from './toastContext'

export { default as Tabs, TabPanel } from './Tabs'
export type { TabsProps, TabItem, TabPanelProps } from './Tabs'

export { default as Pagination } from './Pagination'
export type { PaginationProps } from './Pagination'

export {
  default as Skeleton,
  SkeletonGroup,
  SkeletonText,
  SkeletonTable,
  SkeletonCards,
} from './Skeleton'
export type { SkeletonProps } from './Skeleton'

export { Table, TableScroll, DataCardList, DataCard, DataRow } from './Table'
export type { TableProps, TableScrollProps, DataCardProps } from './Table'

export { default as EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { default as ErrorState } from './ErrorState'
export type { ErrorStateProps } from './ErrorState'

export { default as Spinner } from './Spinner'
export type { SpinnerProps } from './Spinner'

export { default as Progress } from './Progress'
export type { ProgressProps } from './Progress'

export { default as Tooltip } from './Tooltip'
export type { TooltipProps } from './Tooltip'

export { default as Steps } from './Steps'
export type { Step, StepsProps } from './Steps'

export { default as StatTile } from './StatTile'
export type { StatTileProps, StatDelta } from './StatTile'

/* ---------------------------------------------------------------------------
   Milestone 30 (the Diwali launch), Phase 1 — the primitives the launch mockups need.
   Each is domain-agnostic: a podium does not know it is ranking students, an option
   tile does not know it is a quiz. The product-aware pieces built on them
   (`DailyQuizFab`, `Illustration`) live in `components/`.
   --------------------------------------------------------------------------- */

/** Motion hooks. Each has a timer fallback — see the note in the file. */
export { usePrefersReducedMotion, useInView, useCountUp } from './motion'
export type { InViewOptions } from './motion'

export { default as CountUp } from './CountUp'
export type { CountUpProps } from './CountUp'

export { default as Reveal } from './Reveal'
export type { RevealProps } from './Reveal'

export { default as OptionTile, OptionGroup } from './OptionTile'
export type { OptionTileProps, OptionGroupProps } from './OptionTile'

export { default as Countdown } from './Countdown'
export { clockOffset } from './clock'
export type { CountdownProps } from './Countdown'

export { default as Podium } from './Podium'
export type { PodiumProps, PodiumEntry } from './Podium'

export { default as LeaderboardTable } from './LeaderboardTable'
export type { LeaderboardTableProps, LeaderboardRow } from './LeaderboardTable'

export { default as JourneyTrack } from './JourneyTrack'
export type { JourneyTrackProps, JourneyStage } from './JourneyTrack'

export { default as ActivityList } from './ActivityList'
export type { ActivityListProps, ActivityItem } from './ActivityList'

export { default as Confetti } from './Confetti'
export type { ConfettiProps } from './Confetti'

export { default as SkipLink } from './SkipLink'
