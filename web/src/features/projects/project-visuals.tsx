import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronsUp, ChevronUp, Equal, type LucideIcon } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { ProjectCover, ProjectIcon, ProjectPriority, ProjectStatus } from '@/domain/projects'
import { PROJECT_ICON_COMPONENTS, coverStyle } from './project-theme'
import { AppBadge, AppIcon } from '@/presentation/components'

const SIZES = { sm: 'size-7 rounded-md [&_svg]:size-3.5', md: 'size-9 rounded-lg [&_svg]:size-4', lg: 'size-14 rounded-xl [&_svg]:size-7' }

export function ProjectAvatar({
  icon,
  cover,
  size = 'md',
  className,
}: {
  icon: ProjectIcon
  cover: ProjectCover
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center text-white shadow-sm', SIZES[size], className)} style={coverStyle(cover)} aria-hidden>
      <AppIcon name={icon} builtins={PROJECT_ICON_COMPONENTS} fallback={PROJECT_ICON_COMPONENTS.folder} />
    </span>
  )
}

const STATUS_TONE: Record<ProjectStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary'> = {
  planning: 'info',
  active: 'success',
  paused: 'warning',
  completed: 'primary',
  cancelled: 'neutral',
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation()
  return (
    <AppBadge tone={STATUS_TONE[status]} dot>
      {t(`projects.status.${status}`)}
    </AppBadge>
  )
}

const PRIORITY_ICON: Record<ProjectPriority, { icon: LucideIcon; className: string }> = {
  critical: { icon: ChevronsUp, className: 'text-danger' },
  high: { icon: ChevronUp, className: 'text-warning' },
  medium: { icon: Equal, className: 'text-info-soft-fg' },
  low: { icon: ChevronDown, className: 'text-subtle' },
}

export function ProjectPriorityLabel({ priority }: { priority: ProjectPriority }) {
  const { t } = useTranslation()
  const { icon: Icon, className } = PRIORITY_ICON[priority]
  return (
    <span className="inline-flex items-center gap-1 text-sm text-fg">
      <Icon className={cn('size-4', className)} aria-hidden />
      {t(`projects.priority.${priority}`)}
    </span>
  )
}
