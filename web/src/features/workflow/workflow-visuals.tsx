import { useTranslation } from 'react-i18next'
import { Flag } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { LookupItem, StatusCategory } from '@/domain/workflow'
import { optionText, optionTint } from '@/features/task-config/config-theme'
import { CATEGORY_ICONS } from './workflow-theme'

/** Selo de status ou prioridade na cor configurada (ícone da categoria no status, bandeira na prioridade). */
export function LookupBadge({ item, className, iconOnly = false }: { item: Pick<LookupItem, 'name' | 'color' | 'category'>; className?: string; iconOnly?: boolean }) {
  const Icon = item.category ? CATEGORY_ICONS[item.category] : Flag
  if (iconOnly) {
    return (
      <span className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded-full', className)} style={{ color: optionText(item.color), backgroundColor: optionTint(item.color) }} title={item.name}>
        <Icon className="size-3" aria-hidden />
        <span className="sr-only">{item.name}</span>
      </span>
    )
  }
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', className)}
      style={{ color: optionText(item.color), backgroundColor: optionTint(item.color) }}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{item.name}</span>
    </span>
  )
}

/** Nome da categoria do status com o ícone correspondente. */
export function CategoryLabel({ category, className }: { category: StatusCategory; className?: string }) {
  const { t } = useTranslation()
  const Icon = CATEGORY_ICONS[category]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted', className)}>
      <Icon className="size-3.5" aria-hidden />
      {t(`workflow.categories.${category}`)}
    </span>
  )
}
