/**
 * The design system's public surface (Milestone 23, Phase A).
 *
 * Import from here rather than from the individual files:
 *
 *     import { Button, Card, CardHeader, Field, Input, Badge } from '../../components/ui'
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
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button'

export { default as Card, CardHeader, CardBody, CardFooter } from './Card'
export type { CardProps, CardHeaderProps } from './Card'

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
export type { StatTileProps } from './StatTile'
