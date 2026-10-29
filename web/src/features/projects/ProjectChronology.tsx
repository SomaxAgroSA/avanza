import { useMemo } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Diamond, ListTodo, NotebookPen } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { buildChronology, type ChronologyItem } from '@/domain/project-chronology'
import { AppBadge, AppEmptyState, AppErrorState, AppSkeleton } from '@/presentation/components'
import { usePlanJournal } from '@/features/plan/queries'
import { useTimeline } from '@/features/timeline/queries'
import { TaskStatusBadge } from '@/features/tasks/task-visuals'

const formatDay = (iso: string, locale: string, style: 'full' | 'short') =>
  new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

/**
 * Linha do tempo do projeto na aba Histórico: Diário, marcos e tarefas pela data do fato, do mais antigo
 * ao mais recente. Cada fonte é opcional: sem acesso ao quadro (ou à timeline), mostra o que houver.
 */
export function ProjectChronology({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation()
  const timeline = useTimeline(projectId)
  const journal = usePlanJournal(projectId)
  const chronology = useMemo(
    () => buildChronology({ journal: journal.data?.entries, milestones: timeline.data?.milestones, tasks: timeline.data?.tasks }),
    [journal.data, timeline.data],
  )

  if (timeline.isPending && journal.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <AppSkeleton className="h-12" />
        <AppSkeleton className="h-12" />
      </div>
    )
  }
  if (timeline.isError && journal.isError) return <AppErrorState onRetry={() => void Promise.all([timeline.refetch(), journal.refetch()])} />
  if (chronology.days.length === 0 && chronology.undated.length === 0) {
    return <AppEmptyState compact icon={<CalendarClock />} title={t('projects.chronology.empty')} description={t('projects.chronology.emptyHint')} />
  }

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col gap-6">
        {chronology.days.map((day) => (
          <li key={day.date} className="grid gap-3 sm:grid-cols-[10.5rem_1fr] sm:gap-x-8">
            <h3 className="text-sm font-semibold text-fg sm:pt-2">
              <time dateTime={day.date}>{formatDay(day.date, i18n.language, 'full')}</time>
            </h3>
            <ul className="relative flex flex-col gap-2 border-l border-border pl-5">
              {day.items.map((item) => (
                <ChronologyRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {chronology.undated.length > 0 && (
        <section aria-labelledby="chronology-undated" className="flex flex-col gap-2">
          <h3 id="chronology-undated" className="text-sm font-semibold text-muted">
            {t('projects.chronology.undated', { count: chronology.undated.length })}
          </h3>
          <ul className="flex flex-col gap-2">
            {chronology.undated.map((item) => (
              <ChronologyRow key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const ICONS = { journal: NotebookPen, milestone: Diamond, task: ListTodo }

function ChronologyRow({ item }: { item: ChronologyItem }) {
  const { t, i18n } = useTranslation()
  const Icon = ICONS[item.kind]
  return (
    <li className="relative rounded-md bg-surface-2 px-3 py-2 text-sm">
      <span
        className={cn(
          'absolute -left-[31px] top-2 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-muted',
          item.kind === 'milestone' && 'border-primary-border text-primary',
        )}
        aria-hidden
      >
        <Icon className="size-3" />
      </span>
      <span className="mb-1 block text-xs font-medium text-muted">{t(`projects.chronology.kinds.${item.kind}`)}</span>
      {item.kind === 'journal' && (
        <>
          <p className="whitespace-pre-line text-fg">{item.content}</p>
          {item.author && <p className="mt-1 text-xs text-subtle">{item.author.name}</p>}
        </>
      )}
      {item.kind === 'milestone' && (
        <>
          <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
            {item.name}
            <AppBadge tone={item.state === 'done' ? 'success' : 'warning'} dot>
              {t(`timeline.milestones.states.${item.state}`)}
            </AppBadge>
          </p>
          {item.description && <p className="mt-1 text-muted">{item.description}</p>}
        </>
      )}
      {item.kind === 'task' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link to={`/tasks/${item.id}`} className="min-w-0 font-medium text-fg hover:text-primary">
            <span className="text-muted">{item.code}</span> {item.title}
          </Link>
          <TaskStatusBadge status={item.status} />
          {(item.start || item.due) && (
            <span className="text-xs tabular-nums text-subtle">
              {item.start && item.due && item.start !== item.due
                ? t('projects.chronology.span', { start: formatDay(item.start, i18n.language, 'short'), end: formatDay(item.due, i18n.language, 'short') })
                : formatDay((item.start ?? item.due) as string, i18n.language, 'short')}
            </span>
          )}
          {item.assignee && <span className="text-xs text-subtle">{item.assignee.name}</span>}
        </div>
      )}
    </li>
  )
}
