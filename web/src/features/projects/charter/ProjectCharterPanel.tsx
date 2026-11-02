import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, CircleCheck, CircleX, ClipboardList, Gauge, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { formatDay, formatRelative } from '@/core/utils/format'
import {
  CHARTER_SECTIONS,
  FEATURE_TONE,
  OBJECTIVE_TONE,
  SITUATION_TONE,
  formatMeasure,
  itemsOf,
  type CharterItem,
  type FeatureItem,
  type ProjectCharter,
  type ResultItem,
  type ScopeItem,
} from '@/domain/charter'
import type { Project } from '@/domain/projects'
import {
  AppAvatar,
  AppBadge,
  AppButton,
  AppCard,
  AppConfirmDialog,
  AppDataTable,
  AppEmptyState,
  AppErrorState,
  AppIconButton,
  AppSkeleton,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { SectionHeader } from '@/presentation/layouts/SectionHeader'
import { useCan, useSession } from '@/features/auth/session'
import { useTimeline } from '@/features/timeline/queries'
import { useProjectOutlet } from '../project-context'
import { useProjectMembers } from '../queries'
import { CharterItemDialog, ObjectiveDialog, type CharterDialogState } from './CharterItemDialog'
import { ProgressBar } from './ProgressBar'
import { MeasurementDialog, ResultDrawer } from './ResultTracking'
import { useCharter, useCharterMutations } from './queries'
import { PrintCharterButton } from './PrintCharterButton'

const utcDay = (day: string) => new Date(`${day}T00:00:00.000Z`)

/** Aba Ficha da página do projeto (`/projects/:projectId/charter`). */
export function ProjectCharterTab() {
  return <ProjectCharterPanel project={useProjectOutlet().project} />
}

/** Ficha do projeto (regras de negócio §21): resumo, objetivos, funcionalidades, escopo e resultados. */
export function ProjectCharterPanel({ project }: { project: Project }) {
  const charter = useCharter(project.id)
  if (charter.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <AppSkeleton className="h-32 rounded-xl" />
        <AppSkeleton className="h-64 rounded-xl" />
      </div>
    )
  }
  if (charter.isError) return <AppErrorState correlationId={isAppError(charter.error) ? charter.error.correlationId : undefined} onRetry={() => void charter.refetch()} />
  return <CharterView project={project} charter={charter.data} />
}

function CharterView({ project, charter }: { project: Project; charter: ProjectCharter }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const canEdit = charter.capabilities.edit
  const canViewTasks = useCan('tasks.view')
  const me = useSession().current?.user.id
  const members = useProjectMembers(canEdit ? project.id : undefined)
  const timeline = useTimeline(project.id, canEdit && canViewTasks)
  const mutations = useCharterMutations(project.id)
  const [dialog, setDialog] = useState<CharterDialogState>(null)
  const [editingObjective, setEditingObjective] = useState(false)
  const [deleting, setDeleting] = useState<CharterItem | null>(null)
  const [viewing, setViewing] = useState<ResultItem | null>(null)
  const [measuring, setMeasuring] = useState<ResultItem | null>(null)

  const archived = !!project.archivedAt
  // quem edita mede sempre; a sessão só importa para o responsável (assim as linhas não mudam quando ela carrega)
  const measurer = canEdit ? null : me
  const canMeasure = useCallback((item: ResultItem) => canEdit || (!!measurer && item.owner?.id === measurer && !archived), [canEdit, measurer, archived])
  const create = (kind: CharterItem['kind']) => setDialog({ mode: 'create', kind })
  // estáveis: a tabela recria os botões das linhas quando as ações mudam
  const edit = useCallback((item: CharterItem) => setDialog({ mode: 'edit', item }), [])
  const viewingNow = viewing ? (itemsOf(charter, 'result').find((r) => r.id === viewing.id) ?? null) : null

  return (
    <div className="flex flex-col gap-4">
      {/* "Imprimir ficha" na ponta da linha das abas (fora da página do projeto, numa linha própria) */}
      <SectionHeader actions={<PrintCharterButton project={project} charter={charter} />} />
      <CharterSummary charter={charter} />
      <ObjectivesSection charter={charter} canEdit={canEdit} onGeneral={() => setEditingObjective(true)} onCreate={() => create('objective')} onEdit={edit} onDelete={setDeleting} />
      <FeaturesSection charter={charter} canEdit={canEdit} onCreate={() => create('feature')} onEdit={edit} onDelete={setDeleting} />
      <ScopeSection charter={charter} canEdit={canEdit} onCreate={() => create('scope_in')} onEdit={edit} onDelete={setDeleting} />
      <ResultsSection charter={charter} canEdit={canEdit} canMeasure={canMeasure} onCreate={() => create('result')} onEdit={edit} onDelete={setDeleting} onView={setViewing} onMeasure={setMeasuring} />

      <CharterItemDialog
        projectId={project.id}
        charter={charter}
        members={members.data ?? []}
        tasks={timeline.data?.tasks ?? []}
        state={dialog}
        onClose={() => setDialog(null)}
      />
      <ObjectiveDialog key={editingObjective ? 'open' : 'closed'} projectId={project.id} value={charter.objective} open={editingObjective} onClose={() => setEditingObjective(false)} />
      <ResultDrawer item={viewingNow} canMeasure={!!viewingNow && canMeasure(viewingNow)} onMeasure={setMeasuring} onClose={() => setViewing(null)} />
      <MeasurementDialog projectId={project.id} item={measuring} onClose={() => setMeasuring(null)} />
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('charter.deleteTitle', { title: deleting?.title ?? '' })}
        description={t(deleting?.kind === 'result' ? 'charter.deleteResultDescription' : 'charter.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={mutations.remove.isPending}
        onConfirm={() =>
          deleting &&
          mutations.remove.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('charter.deleted', { title: deleting.title }))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </div>
  )
}

/* ------------------------------------------------------------------ resumo */

function CharterSummary({ charter }: { charter: ProjectCharter }) {
  const { t, i18n } = useTranslation()
  const { completeness, summary } = charter
  const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0)
  return (
    <AppCard padded={false} aria-label={t('charter.summary.title')}>
      <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x [&>*]:min-w-0">
        <Stat label={t('charter.summary.completeness')} value={`${completeness.percent}%`} detail={t('charter.summary.sections', { done: completeness.done, total: completeness.total })}>
          <ul className="flex flex-wrap gap-1.5" aria-label={t('charter.summary.completeness')}>
            {CHARTER_SECTIONS.map((section) => (
              <li key={section}>
                <AppBadge tone={completeness.sections[section] ? 'success' : 'neutral'}>
                  {completeness.sections[section] && <Check aria-hidden />}
                  {t(`charter.sections.${section}`)}
                  <span className="sr-only">{completeness.sections[section] ? t('charter.summary.filled') : t('charter.summary.missing')}</span>
                </AppBadge>
              </li>
            ))}
          </ul>
        </Stat>
        <Stat label={t('charter.summary.features')} value={`${summary.featuresDelivered}`} detail={t('charter.summary.ofTotal', { total: summary.featuresTotal })}>
          <ProgressBar value={pct(summary.featuresDelivered, summary.featuresTotal)} />
          <p className="text-xs text-muted">{summary.featuresTotal ? t('charter.summary.tasks', { done: summary.tasksDone, total: summary.tasksTotal }) : t('charter.summary.noFeatures')}</p>
        </Stat>
        <Stat label={t('charter.summary.results')} value={`${summary.resultsOnTrack}`} detail={t('charter.summary.ofTotal', { total: summary.resultsTotal })}>
          <ProgressBar value={pct(summary.resultsOnTrack, summary.resultsTotal)} tone={summary.resultsLate ? 'warning' : 'primary'} />
          <p className="text-xs text-muted">
            {summary.resultsTotal
              ? [t('charter.summary.late', { count: summary.resultsLate }), summary.resultsStale ? t('charter.summary.stale', { count: summary.resultsStale }) : null].filter(Boolean).join(' · ')
              : t('charter.summary.noResults')}
          </p>
        </Stat>
        <Stat label={t('charter.summary.updated')} value={charter.updatedAt ? formatRelative(charter.updatedAt, i18n.language) : '—'} small>
          <p className="text-xs text-muted">{charter.updatedBy ? t('charter.summary.by', { name: charter.updatedBy.name }) : t('charter.summary.neverUpdated')}</p>
        </Stat>
      </div>
    </AppCard>
  )
}

function Stat({ label, value, detail, small, children }: { label: string; value: string; detail?: string; small?: boolean; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className={cn('font-bold tabular-nums text-fg', small ? 'text-lg' : 'text-2xl')}>
        {value}
        {detail && <span className="ml-1.5 text-sm font-medium text-muted">{detail}</span>}
      </span>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ seções */

function Section({ id, title, hint, action, children }: { id: string; title: string; hint: string; action?: ReactNode; children: ReactNode }) {
  return (
    <AppCard aria-labelledby={id}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={id} className="text-base font-semibold text-fg">
              {title}
            </h2>
            <p className="text-sm text-muted">{hint}</p>
          </div>
          {action}
        </div>
        {children}
      </div>
    </AppCard>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <AppButton variant="secondary" size="sm" leftIcon={<Plus />} onClick={onClick}>
      {label}
    </AppButton>
  )
}

function RowActions({ item, onEdit, onDelete }: { item: CharterItem; onEdit: (item: CharterItem) => void; onDelete: (item: CharterItem) => void }) {
  const { t } = useTranslation()
  return (
    <span className="flex shrink-0 items-center">
      <AppIconButton variant="ghost" size="sm" label={t('charter.editItem', { title: item.title })} icon={<Pencil />} onClick={() => onEdit(item)} />
      <AppIconButton variant="ghost" size="sm" className="text-danger" label={t('charter.deleteItem', { title: item.title })} icon={<Trash2 />} onClick={() => onDelete(item)} />
    </span>
  )
}

interface SectionProps {
  charter: ProjectCharter
  canEdit: boolean
  onCreate: () => void
  onEdit: (item: CharterItem) => void
  onDelete: (item: CharterItem) => void
}

function ObjectivesSection({ charter, canEdit, onGeneral, onCreate, onEdit, onDelete }: SectionProps & { onGeneral: () => void }) {
  const { t } = useTranslation()
  const objectives = itemsOf(charter, 'objective')
  const empty = !charter.objective && objectives.length === 0
  return (
    <Section id="charter-objectives" title={t('charter.sections.objectives')} hint={t('charter.hints.objectives')} action={canEdit && !empty ? <AddButton label={t('charter.add.objective')} onClick={onCreate} /> : undefined}>
      {empty ? (
        <AppEmptyState
          compact
          icon={<Target />}
          title={t('charter.empty.objectives')}
          description={t('charter.emptyHint.objectives')}
          action={canEdit ? <AppButton onClick={onGeneral}>{t('charter.general.write')}</AppButton> : undefined}
        />
      ) : (
        <>
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <div className="mb-1 flex items-center gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t('charter.general.title')}</span>
              {canEdit && <AppIconButton variant="ghost" size="sm" label={t('charter.general.edit')} icon={<Pencil />} onClick={onGeneral} />}
            </div>
            <p className="max-w-prose whitespace-pre-line text-fg">{charter.objective || <span className="text-muted">{t('charter.general.missing')}</span>}</p>
          </div>
          {objectives.length > 0 && (
            <ol className="flex flex-col gap-2">
              {objectives.map((o, index) => (
                <li key={o.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-xs font-bold tabular-nums text-primary-soft-fg">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-fg">{o.title}</p>
                    {o.description && <p className="text-sm text-muted">{o.description}</p>}
                    {o.linkIds.length > 0 && <p className="mt-1 text-xs text-muted">{t('charter.linkedCount', { count: o.linkIds.length })}</p>}
                  </div>
                  <AppBadge tone={OBJECTIVE_TONE[o.effectiveState]} dot title={o.state === 'auto' ? t('charter.state.autoTitle') : t('charter.state.manualTitle')}>
                    {t(`charter.objectiveState.${o.effectiveState}`)}
                  </AppBadge>
                  {canEdit && <RowActions item={o} onEdit={onEdit} onDelete={onDelete} />}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Section>
  )
}

function FeaturesSection({ charter, canEdit, onCreate, onEdit, onDelete }: SectionProps) {
  const { t } = useTranslation()
  const table = useDataTableState('charter-features', { sort: null })
  const rows = itemsOf(charter, 'feature')
  const actions = useMemo(() => (canEdit ? { onEdit, onDelete } : {}), [canEdit, onEdit, onDelete])
  const columns = useMemo<DataTableColumn<FeatureItem>[]>(
    () => [
      {
        id: 'title',
        header: t('charter.columns.feature'),
        hideable: false,
        size: 320,
        cell: (f) => (
          <div className="min-w-0">
            <p className="font-medium text-fg">{f.title}</p>
            {f.description && <p className="line-clamp-2 text-xs text-muted">{f.description}</p>}
          </div>
        ),
      },
      {
        id: 'state',
        hideable: false,
        header: t('charter.columns.state'),
        size: 160,
        cell: (f) => (
          <AppBadge tone={FEATURE_TONE[f.effectiveState]} dot title={f.state === 'auto' ? t('charter.state.autoTitle') : t('charter.state.manualTitle')}>
            {t(`charter.featureState.${f.effectiveState}`)}
          </AppBadge>
        ),
      },
      {
        id: 'tasks',
        hideable: false,
        header: t('charter.columns.tasks'),
        size: 200,
        cell: (f) =>
          f.progress.total ? (
            <ProgressBar value={(f.progress.done / f.progress.total) * 100} label={t('charter.tasksDone', { done: f.progress.done, total: f.progress.total })} />
          ) : (
            <span className="text-xs text-muted">{t('charter.noTasks')}</span>
          ),
      },
      { id: 'owner', hideable: false, header: t('charter.columns.owner'), size: 200, cell: (f) => <Owner item={f} /> },
    ],
    [t],
  )
  return (
    <Section id="charter-features" title={t('charter.sections.features')} hint={t('charter.hints.features')} action={canEdit && rows.length > 0 ? <AddButton label={t('charter.add.feature')} onClick={onCreate} /> : undefined}>
      {rows.length === 0 ? (
        <AppEmptyState
          compact
          icon={<ClipboardList />}
          title={t('charter.empty.features')}
          description={t('charter.emptyHint.features')}
          action={canEdit ? <AppButton leftIcon={<Plus />} onClick={onCreate}>{t('charter.add.feature')}</AppButton> : undefined}
        />
      ) : (
        <AppDataTable
          caption={t('charter.sections.features')}
          columns={columns}
          data={rows}
          total={rows.length}
          getRowId={(f) => f.id}
          table={table}
          searchable={false}
          paginated={false}
          bordered={false}
          actions={actions}
        />
      )}
    </Section>
  )
}

function ScopeSection({ charter, canEdit, onCreate, onEdit, onDelete }: SectionProps) {
  const { t } = useTranslation()
  const included = itemsOf(charter, 'scope_in')
  const excluded = itemsOf(charter, 'scope_out')
  const empty = included.length === 0 && excluded.length === 0
  const list = (kind: 'scope_in' | 'scope_out', items: ScopeItem[]) => (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        {kind === 'scope_in' ? <CircleCheck className="size-4 text-success" aria-hidden /> : <CircleX className="size-4 text-danger" aria-hidden />}
        {t(`charter.kinds.${kind}`)}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('charter.empty.scopeList')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">{item.title}</p>
                {item.description && <p className="text-xs text-muted">{item.description}</p>}
              </div>
              {canEdit && <RowActions item={item} onEdit={onEdit} onDelete={onDelete} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
  return (
    <Section id="charter-scope" title={t('charter.sections.scope')} hint={t('charter.hints.scope')} action={canEdit && !empty ? <AddButton label={t('charter.add.scope')} onClick={onCreate} /> : undefined}>
      {empty ? (
        <AppEmptyState compact icon={<CircleCheck />} title={t('charter.empty.scope')} description={t('charter.emptyHint.scope')} action={canEdit ? <AppButton leftIcon={<Plus />} onClick={onCreate}>{t('charter.add.scope')}</AppButton> : undefined} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list('scope_in', included)}
          {list('scope_out', excluded)}
        </div>
      )}
    </Section>
  )
}

function ResultsSection({
  charter,
  canEdit,
  canMeasure,
  onCreate,
  onEdit,
  onDelete,
  onView,
  onMeasure,
}: SectionProps & { canMeasure: (item: ResultItem) => boolean; onView: (item: ResultItem) => void; onMeasure: (item: ResultItem) => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const table = useDataTableState('charter-results', { sort: null })
  const rows = itemsOf(charter, 'result')
  const actions = useMemo(
    () => ({
      leading: (r: ResultItem) =>
        canMeasure(r) ? <AppIconButton variant="ghost" size="sm" label={t('charter.measure.actionFor', { title: r.title })} icon={<Gauge />} onClick={() => onMeasure(r)} /> : null,
      onView,
      ...(canEdit ? { onEdit, onDelete } : {}),
    }),
    [canMeasure, canEdit, onEdit, onDelete, onView, onMeasure, t],
  )
  const columns = useMemo<DataTableColumn<ResultItem>[]>(
    () => [
      { id: 'title', header: t('charter.columns.indicator'), hideable: false, size: 280, cell: (r) => <p className="font-medium text-fg">{r.title}</p> },
      { id: 'baseline', hideable: false, header: t('charter.fields.baseline'), size: 110, align: 'end', cell: (r) => <span className="tabular-nums">{formatMeasure(r.baseline, r.unit, locale)}</span> },
      { id: 'target', hideable: false, header: t('charter.fields.target'), size: 110, align: 'end', cell: (r) => <span className="tabular-nums">{formatMeasure(r.target, r.unit, locale)}</span> },
      {
        id: 'current',
        hideable: false,
        header: t('charter.fields.current'),
        size: 180,
        cell: (r) => (
          <div className="flex flex-col gap-1">
            <span className="font-semibold tabular-nums text-fg">{formatMeasure(r.current, r.unit, locale)}</span>
            <ProgressBar value={r.percent} tone={r.situation === 'late' ? 'warning' : 'primary'} />
          </div>
        ),
      },
      { id: 'due', hideable: false, header: t('charter.fields.dueDate'), size: 130, cell: (r) => <span className="tabular-nums">{r.dueDate ? formatDay(utcDay(r.dueDate), locale) : '—'}</span> },
      {
        id: 'situation',
        hideable: false,
        header: t('charter.columns.situation'),
        size: 170,
        cell: (r) => (
          <span className="flex flex-wrap gap-1">
            <AppBadge tone={SITUATION_TONE[r.situation]} dot>
              {t(`charter.situation.${r.situation}`)}
            </AppBadge>
            {r.stale && <AppBadge tone="warning">{t('charter.stale')}</AppBadge>}
          </span>
        ),
      },
      { id: 'owner', hideable: false, header: t('charter.columns.owner'), size: 180, cell: (r) => <Owner item={r} /> },
    ],
    [t, locale],
  )
  return (
    <Section id="charter-results" title={t('charter.sections.results')} hint={t('charter.hints.results')} action={canEdit && rows.length > 0 ? <AddButton label={t('charter.add.result')} onClick={onCreate} /> : undefined}>
      {rows.length === 0 ? (
        <AppEmptyState compact icon={<Gauge />} title={t('charter.empty.results')} description={t('charter.emptyHint.results')} action={canEdit ? <AppButton leftIcon={<Plus />} onClick={onCreate}>{t('charter.add.result')}</AppButton> : undefined} />
      ) : (
        <AppDataTable
          caption={t('charter.sections.results')}
          columns={columns}
          data={rows}
          total={rows.length}
          getRowId={(r) => r.id}
          table={table}
          searchable={false}
          paginated={false}
          bordered={false}
          actions={actions}
        />
      )}
    </Section>
  )
}

function Owner({ item }: { item: CharterItem }) {
  const { t } = useTranslation()
  if (!item.owner) return <span className="text-muted">{t('charter.fields.noOwner')}</span>
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="flex">
        <AppAvatar name={item.owner.name} src={item.owner.avatarUrl} size="xs" />
      </span>
      <span className="truncate">{item.owner.name}</span>
    </span>
  )
}
