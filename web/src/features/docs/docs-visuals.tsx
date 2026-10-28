import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { matchRanges, type DocSpace, type SpaceIcon } from '@/domain/docs'
import { SPACE_ICON_COMPONENTS } from './docs-theme'
import type { OptionColor } from '@/domain/task-config'
import { AppBadge, AppIcon } from '@/presentation/components'
import { optionColor, optionTint } from '@/features/task-config/config-theme'

const SIZES = { sm: 'size-7 rounded-md [&_svg]:size-3.5', md: 'size-10 rounded-lg [&_svg]:size-5', lg: 'size-14 rounded-xl [&_svg]:size-7' }

export function SpaceAvatar({ icon, color, size = 'md', className }: { icon: SpaceIcon; color: OptionColor; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center', SIZES[size], className)} style={{ backgroundColor: optionTint(color), color: optionColor(color) }}>
      <AppIcon name={icon} builtins={SPACE_ICON_COMPONENTS} fallback={SPACE_ICON_COMPONENTS.book} />
    </span>
  )
}

/** "Toda a empresa" ou "Projeto CRM" (com cadeado: só membros). */
export function SpaceVisibilityBadge({ space }: { space: Pick<DocSpace, 'visibility' | 'project'> }) {
  const { t } = useTranslation()
  if (space.visibility === 'company') return <AppBadge tone="neutral">{t('docs.visibility.company')}</AppBadge>
  return (
    <AppBadge tone="info">
      <Lock aria-hidden className="size-3" />
      {space.project ? t('docs.visibility.projectNamed', { key: space.project.key }) : t('docs.visibility.project')}
    </AppBadge>
  )
}

/** Página nunca publicada ou com alterações pendentes. */
export function DraftBadge({ status, hasDraft }: { status: 'draft' | 'published'; hasDraft: boolean }) {
  const { t } = useTranslation()
  if (status === 'draft') return <AppBadge tone="warning">{t('docs.page.draftBadge')}</AppBadge>
  if (hasDraft) return <AppBadge tone="info">{t('docs.page.pendingBadge')}</AppBadge>
  return null
}

/** Destaca no texto os trechos que casam com a busca (sem acento/maiúsculas). */
export function Highlighted({ text, query }: { text: string; query: string }) {
  const chars = [...text]
  const parts: ReactNode[] = []
  let last = 0
  matchRanges(text, query).forEach(([start, end], index) => {
    if (start > last) parts.push(chars.slice(last, start).join(''))
    parts.push(
      <mark key={index} className="rounded-sm bg-warning-soft px-0.5 text-fg">
        {chars.slice(start, end).join('')}
      </mark>,
    )
    last = end
  })
  if (last < chars.length) parts.push(chars.slice(last).join(''))
  return <>{parts}</>
}
