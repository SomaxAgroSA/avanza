import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CalendarX, CircleAlert, CircleCheck, Flag, OctagonAlert, TriangleAlert } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import type { AttentionItem } from '@/domain/executive'
import { AppButton } from '@/presentation/components'
import { managementLink } from '@/features/plan/paths'
import { ExecutiveSection, ProjectKey } from './executive-visuals'
import { useDayText, useFactorText, useHealthLabel } from './use-executive-format'

/** Quantas exceções aparecem antes do "Ver mais" (na impressão, todas). */
const VISIBLE = 6

const ICON_TONE = {
  danger: 'bg-danger-soft text-danger-soft-fg',
  warning: 'bg-warning-soft text-warning-soft-fg',
  info: 'bg-info-soft text-info-soft-fg',
} as const

interface RowView {
  to: string
  icon: ReactNode
  tone: keyof typeof ICON_TONE
  title: ReactNode
  detail: string
  aside?: ReactNode
}

/** ② Precisa de atenção: as exceções do portfólio, priorizadas (domain/executive.ts#attentionItems). */
export function AttentionSection({ items, id, delay, onSeeCritical }: { items: AttentionItem[]; id?: string; delay?: number; onSeeCritical: () => void }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const hidden = items.length - VISIBLE
  const hasCritical = items.some((item) => item.kind === 'project' && item.level === 'critical')

  return (
    <ExecutiveSection
      id={id}
      delay={delay}
      title={t('executive.attention.title')}
      meta={items.length > 0 ? items.length : undefined}
      className="@container"
      actions={
        hasCritical && (
          <AppButton variant="ghost" size="sm" onClick={onSeeCritical} className="-mr-2 print:hidden">
            {t('executive.attention.seeCritical')}
          </AppButton>
        )
      }
    >
      {items.length === 0 ? (
        <div className="flex flex-1 items-center gap-4 rounded-lg bg-success-soft p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-success-soft-fg shadow-card">
            <CircleCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-success-soft-fg">{t('executive.attention.allClear')}</p>
            <p className="text-xs text-success-soft-fg">{t('executive.attention.allClearHint')}</p>
          </div>
        </div>
      ) : (
        <>
          <ul id={listId} aria-label={t('executive.attention.title')} className="-mt-1 grid gap-x-6 gap-y-1 @2xl:grid-cols-2">
            {items.map((item, index) => (
              <AttentionRow key={`${item.kind}-${item.id}`} item={item} className={cn(index >= VISIBLE && (expanded ? 'motion-safe:animate-rise' : 'hidden print:flex'))} />
            ))}
          </ul>
          {hidden > 0 && (
            <AppButton variant="ghost" size="sm" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((open) => !open)} className="mt-2 -ml-3 self-start print:hidden">
              {expanded ? t('executive.attention.showLess') : t('executive.attention.showMore', { count: hidden })}
            </AppButton>
          )}
        </>
      )}
    </ExecutiveSection>
  )
}

function AttentionRow({ item, className }: { item: AttentionItem; className?: string }) {
  const view = useRowView()(item)
  return (
    <li className={cn('group/row -mx-2 flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2', className)}>
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-200 group-hover/row:scale-110 [&_svg]:size-4', ICON_TONE[view.tone])}>{view.icon}</span>
      <div className="min-w-0 flex-1">
        <Link to={view.to} className="block truncate text-sm font-medium text-fg hover:text-primary-text">
          {view.title}
        </Link>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <ProjectKey value={item.project.key} />
          <span className="truncate">{view.detail}</span>
        </div>
      </div>
      {view.aside && <span className="shrink-0 text-xs tabular-nums text-muted">{view.aside}</span>}
    </li>
  )
}

function useRowView() {
  const { t } = useTranslation()
  const day = useDayText()
  const level = useHealthLabel()
  const factor = useFactorText()
  return (item: AttentionItem): RowView => {
    switch (item.kind) {
      case 'project':
        return {
          to: `/projects/${item.project.id}`,
          icon: item.level === 'critical' ? <OctagonAlert aria-hidden /> : <TriangleAlert aria-hidden />,
          tone: item.level === 'critical' ? 'danger' : 'warning',
          title: item.project.name,
          detail: [level(item.level), item.factor ? factor(item.factor) : null].filter(Boolean).join(' · '),
        }
      case 'issue':
        return {
          to: managementLink(item.project.id, { view: 'management' }),
          icon: <CircleAlert aria-hidden />,
          tone: 'warning',
          title: (
            <>
              <span className="text-muted">#{item.number}</span> {item.description}
            </>
          ),
          detail: t('executive.attention.issue'),
          aside: item.openedOn ? t('executive.attention.since', { date: day(item.openedOn) }) : undefined,
        }
      case 'task':
        return {
          to: `/tasks/${item.id}`,
          icon: <CalendarX aria-hidden />,
          tone: 'danger',
          title: (
            <>
              {item.code && <span className="font-mono text-xs text-muted">{item.code}</span>} {item.title}
            </>
          ),
          detail: t('executive.attention.task'),
          aside: <span className="text-danger">{t('executive.attention.due', { date: day(item.dueDate) })}</span>,
        }
      default:
        return {
          to: `/timeline/${item.project.id}`,
          icon: <Flag aria-hidden />,
          tone: 'info',
          title: item.name,
          detail: t('executive.attention.milestone'),
          aside: day(item.dueDate),
        }
    }
  }
}
