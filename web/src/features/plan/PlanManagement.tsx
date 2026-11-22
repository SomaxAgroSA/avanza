import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NotebookPen, Plus, TriangleAlert } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { ISSUE_DESCRIPTION_MAX, ISSUE_STATES, JOURNAL_MAX, type IssueState, type JournalEntry, type PlanIssue } from '@/domain/plan-management'
import type { Plan } from '@/domain/plan'
import { isoFromDay, todayOf } from '@/domain/timeline'
import {
  AppAvatar,
  AppBadge,
  AppButton,
  AppConfirmDialog,
  AppDataTable,
  AppDatePicker,
  AppDialog,
  AppEmptyState,
  AppSelect,
  AppTextarea,
  notify,
  useDataTableState,
  type DataTableColumn,
} from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useProjectMembers } from '@/features/projects/queries'
import { usePlanIssues, usePlanJournal, usePlanManagementMutations } from './queries'

const STATE_TONE: Record<IssueState, 'warning' | 'info' | 'success'> = { in_progress: 'info', pending: 'warning', resolved: 'success' }
const NO_OWNER = '__none__'
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const formatDay = (iso: string | null, locale: string) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '—')

/** Gestão do projeto (GP-4): Diário do projeto e Gestão dos problemas. */
export function PlanManagement({ plan }: { plan: Plan }) {
  return (
    <div className="flex flex-col gap-8">
      <JournalSection plan={plan} />
      <IssuesSection plan={plan} />
    </div>
  )
}

/* ------------------------------------------------------------------ diário */

function JournalSection({ plan }: { plan: Plan }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const errorMessage = useErrorMessage()
  const projectId = plan.project.id
  const journal = usePlanJournal(projectId)
  const mutations = usePlanManagementMutations(projectId)
  const table = useDataTableState(`plan-journal`, { sort: { id: 'date', direction: 'desc' } })
  const [editing, setEditing] = useState<JournalEntry | 'new' | null>(null)
  const [deleting, setDeleting] = useState<JournalEntry | null>(null)

  const rows = useMemo(() => {
    const q = fold(table.state.search.trim())
    const list = (journal.data?.entries ?? []).filter((e) => !q || fold(e.content).includes(q))
    const sort = table.state.sort
    if (!sort || sort.id !== 'date') return list
    return sort.direction === 'asc' ? [...list].reverse() : list
  }, [journal.data, table.state.search, table.state.sort])

  const columns = useMemo<DataTableColumn<JournalEntry>[]>(
    () => [
      { id: 'date', header: t('plan.management.journal.date'), sortable: true, hideable: false, size: 130, cell: (e) => <span className="tabular-nums text-fg">{formatDay(e.entryDate, locale)}</span> },
      { id: 'content', header: t('plan.management.journal.content'), hideable: false, size: 560, cell: (e) => <p className="whitespace-pre-line text-fg">{e.content}</p> },
      {
        id: 'author',
        header: t('plan.management.journal.author'),
        size: 200,
        cell: (e) =>
          e.author ? (
            <span className="flex items-center gap-2">
              <span aria-hidden className="flex">
                <AppAvatar name={e.author.name} src={e.author.avatarUrl} size="xs" />
              </span>
              <span className="truncate">{e.author.name}</span>
            </span>
          ) : (
            '—'
          ),
      },
    ],
    [t, locale],
  )

  return (
    <section aria-labelledby="plan-journal" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="plan-journal" className="flex items-center gap-2 text-base font-semibold text-fg">
            <NotebookPen className="size-4 text-muted" aria-hidden /> {t('plan.management.journal.title')}
          </h2>
          <p className="text-sm text-muted">{t('plan.management.journal.hint')}</p>
        </div>
        {journal.data?.capabilities.create && (
          <AppButton leftIcon={<Plus />} onClick={() => setEditing('new')}>
            {t('plan.management.journal.create')}
          </AppButton>
        )}
      </div>
      <AppDataTable
        tableId="plan-journal"
        caption={t('plan.management.journal.title')}
        columns={columns}
        data={rows}
        total={rows.length}
        getRowId={(e) => e.id}
        table={table}
        paginated={false}
        loading={journal.isPending}
        fetching={journal.isFetching}
        error={journal.isError ? { correlationId: isAppError(journal.error) ? journal.error.correlationId : undefined } : null}
        onRetry={() => void journal.refetch()}
        searchPlaceholder={t('plan.management.journal.search')}
        emptyState={table.hasActiveFilters ? undefined : <AppEmptyState compact title={t('plan.management.journal.empty')} description={t('plan.management.journal.emptyHint')} />}
        actions={{ onEdit: setEditing, canEdit: (e) => e.capabilities.edit, onDelete: setDeleting, canDelete: (e) => e.capabilities.delete }}
      />
      {editing && <JournalDialog projectId={projectId} entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('plan.management.journal.deleteTitle')}
        description={t('plan.management.journal.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={mutations.deleteEntry.isPending}
        onConfirm={() =>
          deleting &&
          mutations.deleteEntry.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('plan.management.journal.deleted'))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </section>
  )
}

function JournalDialog({ projectId, entry, onClose }: { projectId: string; entry: JournalEntry | null; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const mutations = usePlanManagementMutations(projectId)
  const [date, setDate] = useState(entry?.entryDate ?? isoFromDay(todayOf(new Date())))
  const [content, setContent] = useState(entry?.content ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pending = mutations.createEntry.isPending || mutations.updateEntry.isPending

  function submit() {
    const missing: Record<string, string> = {}
    if (!date) missing.entry_date = 'required'
    if (!content.trim()) missing.content = 'required'
    if (Object.keys(missing).length) return setErrors(missing)
    const input = { entryDate: date, content: content.trim() }
    const options = {
      onSuccess: () => {
        notify.success(t(entry ? 'plan.management.journal.updated' : 'plan.management.journal.created'))
        onClose()
      },
      onError: (error: unknown) => (isAppError(error) && error.code === 'VALIDATION_ERROR' ? setErrors(error.fieldErrors()) : notify.error(errorMessage(error))),
    }
    if (entry) mutations.updateEntry.mutate({ id: entry.id, input }, options)
    else mutations.createEntry.mutate(input, options)
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      size="lg"
      closeOnOutsideClick={false}
      title={entry ? t('plan.management.journal.editTitle') : t('plan.management.journal.createTitle')}
      description={t('plan.management.journal.hint')}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {entry ? t('common.save') : t('plan.management.journal.create')}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <AppDatePicker label={t('plan.management.journal.date')} required value={date} onValueChange={setDate} error={errors.entry_date ? t(`validation.${errors.entry_date}`) : undefined} fieldClassName="sm:w-56" />
        <AppTextarea
          label={t('plan.management.journal.content')}
          required
          rows={6}
          maxLength={JOURNAL_MAX}
          value={content}
          placeholder={t('plan.management.journal.placeholder')}
          onChange={(event) => setContent(event.target.value)}
          error={errors.content ? t(`validation.${errors.content}`) : undefined}
        />
      </div>
    </AppDialog>
  )
}

/* ------------------------------------------------------------------ problemas */

function IssuesSection({ plan }: { plan: Plan }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const errorMessage = useErrorMessage()
  const projectId = plan.project.id
  const issues = usePlanIssues(projectId)
  const mutations = usePlanManagementMutations(projectId)
  const table = useDataTableState(`plan-issues`, { sort: { id: 'number', direction: 'asc' } })
  const [editing, setEditing] = useState<PlanIssue | 'new' | null>(null)
  const [deleting, setDeleting] = useState<PlanIssue | null>(null)
  const stateFilter = table.state.filters.state

  const rows = useMemo(() => {
    const q = fold(table.state.search.trim())
    const list = (issues.data?.issues ?? []).filter((i) => (!q || fold(i.description).includes(q) || `#${i.number}` === q) && (!stateFilter || i.state === stateFilter))
    const sort = table.state.sort
    if (!sort) return list
    const factor = sort.direction === 'asc' ? 1 : -1
    const value = (i: PlanIssue): string | number => (sort.id === 'date' ? i.openedOn : sort.id === 'state' ? ISSUE_STATES.indexOf(i.state) : i.number)
    return [...list].sort((a, b) => (value(a) > value(b) ? factor : value(a) < value(b) ? -factor : 0))
  }, [issues.data, table.state.search, table.state.sort, stateFilter])

  const changeState = (issue: PlanIssue, state: IssueState) =>
    mutations.updateIssue.mutate(
      { id: issue.id, input: { state } },
      { onSuccess: () => notify.success(t('plan.management.issues.stateChanged', { number: issue.number, state: t(`plan.management.issues.states.${state}`) })), onError: (error) => notify.error(errorMessage(error)) },
    )

  const columns = useMemo<DataTableColumn<PlanIssue>[]>(
    () => [
      { id: 'number', header: '#', sortable: true, hideable: false, size: 70, cell: (i) => <span className="font-mono text-xs text-muted">#{i.number}</span> },
      { id: 'date', header: t('plan.management.issues.openedOn'), sortable: true, size: 120, cell: (i) => <span className="tabular-nums">{formatDay(i.openedOn, locale)}</span> },
      { id: 'description', header: t('plan.management.issues.description'), hideable: false, size: 420, cell: (i) => <p className="whitespace-pre-line text-fg">{i.description}</p> },
      { id: 'owner', header: t('plan.management.issues.owner'), size: 180, cell: (i) => i.owner?.name ?? <span className="text-subtle">{t('plan.management.issues.noOwner')}</span> },
      {
        id: 'state',
        header: t('plan.management.issues.state'),
        sortable: true,
        size: 190,
        filter: { label: t('plan.management.issues.state'), options: ISSUE_STATES.map((s) => ({ value: s, label: t(`plan.management.issues.states.${s}`) })) },
        cell: (i) =>
          i.capabilities.edit ? (
            <AppSelect
              size="sm"
              aria-label={t('plan.management.issues.stateOf', { number: i.number })}
              value={i.state}
              onValueChange={(value) => changeState(i, value as IssueState)}
              options={ISSUE_STATES.map((s) => ({ value: s, label: t(`plan.management.issues.states.${s}`) }))}
            />
          ) : (
            <AppBadge tone={STATE_TONE[i.state]} dot>
              {t(`plan.management.issues.states.${i.state}`)}
            </AppBadge>
          ),
      },
      { id: 'resolved', header: t('plan.management.issues.resolvedOn'), size: 120, cell: (i) => <span className="tabular-nums text-muted">{formatDay(i.resolvedOn, locale)}</span> },
    ],
    // changeState usa as mutações (estáveis por render); recriar as colunas a cada render é inofensivo
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale],
  )

  const open = (issues.data?.issues ?? []).filter((i) => i.state !== 'resolved').length

  return (
    <section aria-labelledby="plan-issues" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="plan-issues" className="flex items-center gap-2 text-base font-semibold text-fg">
            <TriangleAlert className="size-4 text-muted" aria-hidden /> {t('plan.management.issues.title')}
            {open > 0 && <AppBadge tone="warning">{t('plan.management.issues.openCount', { count: open })}</AppBadge>}
          </h2>
          <p className="text-sm text-muted">{t('plan.management.issues.hint')}</p>
        </div>
        {issues.data?.capabilities.create && (
          <AppButton leftIcon={<Plus />} onClick={() => setEditing('new')}>
            {t('plan.management.issues.create')}
          </AppButton>
        )}
      </div>
      <AppDataTable
        tableId="plan-issues"
        caption={t('plan.management.issues.title')}
        columns={columns}
        data={rows}
        total={rows.length}
        getRowId={(i) => i.id}
        table={table}
        paginated={false}
        loading={issues.isPending}
        fetching={issues.isFetching}
        error={issues.isError ? { correlationId: isAppError(issues.error) ? issues.error.correlationId : undefined } : null}
        onRetry={() => void issues.refetch()}
        searchPlaceholder={t('plan.management.issues.search')}
        emptyState={table.hasActiveFilters ? undefined : <AppEmptyState compact title={t('plan.management.issues.empty')} description={t('plan.management.issues.emptyHint')} />}
        actions={{ onEdit: setEditing, canEdit: (i) => i.capabilities.edit, onDelete: setDeleting, canDelete: (i) => i.capabilities.delete }}
      />
      {editing && <IssueDialog projectId={projectId} issue={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('plan.management.issues.deleteTitle', { number: deleting?.number ?? '' })}
        description={t('plan.management.issues.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={mutations.deleteIssue.isPending}
        onConfirm={() =>
          deleting &&
          mutations.deleteIssue.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('plan.management.issues.deleted', { number: deleting.number }))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </section>
  )
}

function IssueDialog({ projectId, issue, onClose }: { projectId: string; issue: PlanIssue | null; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const mutations = usePlanManagementMutations(projectId)
  const members = useProjectMembers(projectId)
  const [openedOn, setOpenedOn] = useState(issue?.openedOn ?? isoFromDay(todayOf(new Date())))
  const [description, setDescription] = useState(issue?.description ?? '')
  const [state, setState] = useState<IssueState>(issue?.state ?? 'pending')
  const [ownerId, setOwnerId] = useState(issue?.owner?.id ?? NO_OWNER)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pending = mutations.createIssue.isPending || mutations.updateIssue.isPending
  const people = (members.data ?? []).filter((m) => m.role !== 'viewer' || m.user.id === issue?.owner?.id)

  function submit() {
    const missing: Record<string, string> = {}
    if (!openedOn) missing.opened_on = 'required'
    if (!description.trim()) missing.description = 'required'
    if (Object.keys(missing).length) return setErrors(missing)
    const input = { openedOn, description: description.trim(), state, ownerId: ownerId === NO_OWNER ? null : ownerId }
    const options = {
      onSuccess: (saved: PlanIssue) => {
        notify.success(t(issue ? 'plan.management.issues.updated' : 'plan.management.issues.created', { number: saved.number }))
        onClose()
      },
      onError: (error: unknown) => (isAppError(error) && error.code === 'VALIDATION_ERROR' ? setErrors(error.fieldErrors()) : notify.error(errorMessage(error))),
    }
    if (issue) mutations.updateIssue.mutate({ id: issue.id, input }, options)
    else mutations.createIssue.mutate(input, options)
  }

  const fieldError = (key: string) => (errors[key] ? t(`plan.fieldIssues.${errors[key]}`, { defaultValue: t(`validation.${errors[key]}`) }) : undefined)

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      size="lg"
      closeOnOutsideClick={false}
      title={issue ? t('plan.management.issues.editTitle', { number: issue.number }) : t('plan.management.issues.createTitle')}
      description={t('plan.management.issues.hint')}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {issue ? t('common.save') : t('plan.management.issues.create')}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <AppDatePicker label={t('plan.management.issues.openedOn')} required value={openedOn} onValueChange={setOpenedOn} error={fieldError('opened_on')} />
          <AppSelect label={t('plan.management.issues.state')} value={state} onValueChange={(value) => setState(value as IssueState)} options={ISSUE_STATES.map((s) => ({ value: s, label: t(`plan.management.issues.states.${s}`) }))} />
          <AppSelect
            label={t('plan.management.issues.owner')}
            value={ownerId}
            onValueChange={setOwnerId}
            error={fieldError('owner_id')}
            options={[{ value: NO_OWNER, label: t('plan.management.issues.noOwner') }, ...people.map((m) => ({ value: m.user.id, label: m.user.name }))]}
          />
        </div>
        <AppTextarea
          label={t('plan.management.issues.description')}
          required
          rows={5}
          maxLength={ISSUE_DESCRIPTION_MAX}
          value={description}
          placeholder={t('plan.management.issues.placeholder')}
          onChange={(event) => setDescription(event.target.value)}
          error={fieldError('description')}
        />
      </div>
    </AppDialog>
  )
}
