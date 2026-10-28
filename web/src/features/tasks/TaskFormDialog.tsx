import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isAppError } from '@/core/errors/app-error'
import { toDayInput } from '@/core/utils/format'
import { isRequiredIn, isRequiredOnCreate, type FieldValue, type OptionColor, type TaskTypeField } from '@/domain/task-config'
import { customValueIssues, datesIssue, parseHours, type TaskDetail, type TaskInput } from '@/domain/tasks'
import { statusChoices, type StatusCategory } from '@/domain/workflow'
import { AppButton, AppDatePicker, AppDialog, AppMultiSelect, AppSelect, AppSkeleton, AppTextField, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCan } from '@/features/auth/session'
import { useProjectMembers, useProjects } from '@/features/projects/queries'
import { CustomFieldInput } from '@/features/task-config/CustomFieldInput'
import { ColorDot, TaskTypeIconBadge } from '@/features/task-config/config-visuals'
import { useTaskType, useTaskTypes } from '@/features/task-config/queries'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { usePriorities, useStatuses } from '@/features/workflow/queries'
import { useTaskAttachments, useTaskMutations } from './queries'
import { useTags } from '@/features/tags/queries'
import { useSprints } from '@/features/backlog/queries'

export interface TaskFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tarefa em edição (detalhe); ausente = criação. */
  task?: TaskDetail | null
  /** Projeto fixo na criação (ex.: aberta a partir da página do projeto). */
  projectId?: string
  /** Valores iniciais na criação (ex.: vindos da criação rápida do Kanban). */
  initial?: TaskFormInitial
  onSaved?: (task: TaskDetail) => void
}

export type TaskFormInitial = Partial<Pick<Draft, 'typeId' | 'title' | 'statusId' | 'priorityId' | 'assigneeId' | 'sprintId' | 'parentTaskId'>>

const NONE = '__none__'

interface LookupOption {
  id: string
  name: string
  color: OptionColor
  category?: StatusCategory
}

const PROJECT_QUERY = { view: 'all' as const, page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' as const }, search: '', filters: {} }

interface Draft {
  projectId: string
  typeId: string
  title: string
  description: string
  statusId: string
  priorityId: string
  assigneeId: string
  startDate: string
  dueDate: string
  estimatedHours: string
  actualHours: string
  values: Record<string, FieldValue>
  tagIds: string[]
  sprintId: string
  /** Subtarefa: pai (só na criação; na edição o vínculo muda pela aba Relações). */
  parentTaskId: string
}

function draftFrom(task: TaskDetail | null | undefined, projectId: string | undefined, initial?: TaskFormInitial): Draft {
  const hours = (n: number | null) => (n === null ? '' : String(n))
  return {
    projectId: task?.project?.id ?? projectId ?? '',
    typeId: task?.type?.id ?? '',
    title: task?.title ?? '',
    description: task?.description ?? '',
    statusId: task?.status?.id ?? '',
    priorityId: task?.priority?.id ?? '',
    assigneeId: task?.assignee?.id ?? '',
    startDate: toDayInput(task?.startDate),
    dueDate: toDayInput(task?.dueDate),
    estimatedHours: hours(task?.estimatedHours ?? null),
    actualHours: hours(task?.actualHours ?? null),
    values: { ...(task?.customValues ?? {}) },
    tagIds: (task?.tags ?? []).map((tag) => tag.id),
    sprintId: task?.sprint?.id ?? '',
    parentTaskId: task?.parentTaskId ?? '',
    ...(task ? {} : initial),
  }
}

/** Remonta o formulário a cada abertura (rascunho novo, sem efeitos). */
export function TaskFormDialog(props: TaskFormDialogProps) {
  const key = props.open ? (props.task?.id ?? `new:${props.projectId ?? ''}`) : 'closed'
  return <TaskForm key={key} {...props} />
}

function TaskForm({ open, onOpenChange, task, projectId, initial, onSaved }: TaskFormDialogProps) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const canAssign = useCan('tasks.assign')
  const isEdit = !!task
  const { create, update } = useTaskMutations()

  const [draft, setDraft] = useState<Draft>(() => draftFrom(task, projectId, initial))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [valueErrors, setValueErrors] = useState<Record<string, string>>({})

  const projects = useProjects(PROJECT_QUERY, open && !isEdit && !projectId)
  const types = useTaskTypes(false)
  // o formulário fica montado nas telas: fechado, não busca nada além das listas gerais (já em cache)
  const typeDetail = useTaskType(open ? draft.typeId || undefined : undefined)
  const statuses = useStatuses(false)
  const priorities = usePriorities(false)
  const members = useProjectMembers(open ? draft.projectId || undefined : undefined)
  // campos de imagem/arquivo escolhem entre os anexos da tarefa (só na edição: na criação ainda não há anexos)
  const taskAttachments = useTaskAttachments(open ? task?.id : undefined)
  const tags = useTags(open)
  const sprints = useSprints(open ? draft.projectId || undefined : undefined)

  // Padrões de status/prioridade na criação (ajuste durante a renderização).
  if (!isEdit && !draft.statusId && statuses.data) {
    const def = statuses.data.find((s) => s.isDefault)
    if (def) setDraft((d) => ({ ...d, statusId: def.id }))
  }
  if (!isEdit && !draft.priorityId && priorities.data) {
    const def = priorities.data.find((p) => p.isDefault)
    if (def) setDraft((d) => ({ ...d, priorityId: def.id }))
  }

  const fields: TaskTypeField[] = useMemo(() => (typeDetail.data?.fields ?? []).filter((f) => f.visible), [typeDetail.data])
  const activeMembers = useMemo(() => (members.data ?? []).filter((m) => m.user.status === 'active'), [members.data])
  const references = useMemo(
    () => ({
      people: activeMembers.map((m) => ({ id: m.user.id, name: m.user.name })),
      projects: (projects.data?.items ?? []).map((p) => ({ id: p.id, key: p.key, name: p.name })),
      attachments: task ? (taskAttachments.data ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url })) : undefined,
    }),
    [activeMembers, projects.data, task, taskAttachments.data],
  )

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  /** Troca de tipo: mantém valores de campos com o mesmo nome e aplica padrões do novo tipo. */
  function changeType(typeId: string) {
    setValueErrors({})
    setDraft((d) => ({ ...d, typeId }))
  }
  // Padrões do tipo (criação): aplicados quando os campos do tipo chegam.
  const [defaultsFor, setDefaultsFor] = useState<string | null>(isEdit ? (task?.type?.id ?? null) : null)
  if (!isEdit && typeDetail.data && defaultsFor !== typeDetail.data.id && typeDetail.data.id === draft.typeId) {
    setDefaultsFor(typeDetail.data.id)
    const next = { ...draft.values }
    typeDetail.data.fields.forEach((link) => {
      if (link.visible && next[link.field.name] === undefined && link.field.defaultValue !== null) next[link.field.name] = link.field.defaultValue
    })
    setDraft((d) => ({ ...d, values: next }))
  }

  // o tipo atual continua na lista mesmo se foi desativado depois
  const typeList = types.data ?? []
  const currentType = task?.type && !typeList.some((x) => x.id === task.type?.id) ? [task.type] : []
  const typeOptions = [...typeList, ...currentType].map((type) => ({
    value: type.id,
    label: (
      <span className="inline-flex items-center gap-2">
        <TaskTypeIconBadge icon={type.icon} color={type.color} size="sm" />
        {type.name}
      </span>
    ),
  }))

  const lookupOptions = (list: LookupOption[], current: LookupOption | null | undefined) =>
    [...list, ...(current && !list.some((x) => x.id === current.id) ? [current] : [])].map((item) => ({
      value: item.id,
      label: <LookupBadge item={item} />,
    }))

  const pending = create.isPending || update.isPending

  function submit() {
    const found: Record<string, string> = {}
    if (!draft.projectId) found.project_id = 'required'
    if (!draft.typeId) found.task_type_id = 'required'
    if (!draft.title.trim()) found.title = 'required'
    const estimated = parseHours(draft.estimatedHours)
    const actual = parseHours(draft.actualHours)
    if (estimated !== null && !(estimated > 0)) found.estimated_hours = Number.isNaN(estimated) ? 'invalid_type' : 'too_small'
    if (actual !== null && !(actual > 0)) found.actual_hours = Number.isNaN(actual) ? 'invalid_type' : 'too_small'
    // obrigatórios do status escolhido no formulário (sempre + exigidos nele)
    // início planejado ≤ prazo (mesma regra do servidor)
    const datesProblem = datesIssue(draft.startDate, draft.dueDate)
    if (datesProblem) {
      setErrors({ start_date: datesProblem })
      return
    }
    const issues = customValueIssues(fields, draft.values, draft.statusId)
    setErrors(found)
    setValueErrors(issues)
    if (Object.keys(found).length > 0 || Object.keys(issues).length > 0) return

    const customValues: Record<string, FieldValue> = {}
    fields.forEach((link) => {
      if ((link.field.type === 'image' || link.field.type === 'file') && !isEdit) return
      const value = draft.values[link.field.name]
      customValues[link.field.name] = value === undefined || value === '' ? null : value
    })
    const data: TaskInput = {
      taskTypeId: draft.typeId,
      title: draft.title.trim(),
      description: draft.description,
      statusId: draft.statusId || undefined,
      priorityId: draft.priorityId || undefined,
      assigneeId: draft.assigneeId || null,
      startDate: draft.startDate || null,
      dueDate: draft.dueDate || null,
      estimatedHours: estimated,
      actualHours: actual,
      customValues,
      tagIds: draft.tagIds,
      sprintId: draft.sprintId || null,
    }
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
        const server = error.fieldErrors()
        const base: Record<string, string> = {}
        const custom: Record<string, string> = {}
        Object.entries(server).forEach(([key, code]) => {
          if (key.startsWith('custom_values.')) custom[key.slice('custom_values.'.length)] = code
          else base[key] = code
        })
        setErrors(base)
        setValueErrors(custom)
        return
      }
      notify.error(errorMessage(error))
    }
    const onSuccess = (saved: TaskDetail) => {
      notify.success(isEdit ? t('tasks.updated', { code: saved.code }) : t('tasks.created', { code: saved.code }))
      onSaved?.(saved)
      onOpenChange(false)
    }
    if (task) update.mutate({ id: task.id, data }, { onSuccess, onError })
    else
      create.mutate(
        {
          ...data,
          projectId: draft.projectId,
          taskTypeId: draft.typeId,
          title: draft.title.trim(),
          assigneeId: draft.assigneeId || undefined,
          sprintId: draft.sprintId || undefined,
          parentTaskId: draft.parentTaskId || undefined,
        },
        { onSuccess, onError },
      )
  }

  const assignable = activeMembers.filter((m) => m.role !== 'viewer' || m.isOwner)
  const canChangeAssignee = isEdit ? !!task?.capabilities.assign : canAssign
  const selectedType = types.data?.find((x) => x.id === draft.typeId) ?? task?.type ?? null

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      closeOnOutsideClick={false}
      title={isEdit ? t('tasks.editTitle', { code: task?.code }) : t('tasks.createTitle')}
      description={isEdit ? task?.title : t('tasks.createDescription')}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {isEdit ? t('common.save') : t('tasks.create')}
          </AppButton>
        </>
      }
    >
      <form
        noValidate
        className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {!isEdit && !projectId && (
              <AppSelect
                label={t('tasks.fields.project')}
                required
                value={draft.projectId || undefined}
                placeholder={t('fields.selectPlaceholder')}
                error={errors.project_id}
                onValueChange={(value) => setDraft((d) => ({ ...d, projectId: value, assigneeId: '', sprintId: '' }))}
                options={(projects.data?.items ?? [])
                  .filter((p) => p.myRole !== 'viewer' && !p.archivedAt)
                  .map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))}
              />
            )}
            <AppSelect
              label={t('tasks.fields.type')}
              required
              value={draft.typeId || undefined}
              placeholder={t('fields.selectPlaceholder')}
              error={errors.task_type_id}
              hint={isEdit ? t('tasks.typeChangeHint') : undefined}
              onValueChange={changeType}
              options={typeOptions}
            />
          </div>
          <AppTextField
            label={t('tasks.fields.title')}
            required
            autoComplete="off"
            maxLength={200}
            value={draft.title}
            error={errors.title}
            placeholder={t('tasks.titlePlaceholder')}
            onChange={(event) => set('title', event.target.value)}
          />
          <AppTextarea
            label={t('tasks.fields.description')}
            rows={5}
            maxLength={50000}
            value={draft.description}
            error={errors.description}
            hint={t('tasks.markdownHint')}
            onChange={(event) => set('description', event.target.value)}
          />
          <AppMultiSelect
            label={t('tasks.fields.tags')}
            value={draft.tagIds}
            error={errors.tag_ids}
            onValueChange={(tagIds) => set('tagIds', tagIds)}
            placeholder={t('tasks.tagsPlaceholder')}
            options={(tags.data ?? []).map((tag) => ({ value: tag.id, label: tag.name, prefix: <ColorDot color={tag.color} /> }))}
          />
          {draft.typeId && (
            <section aria-labelledby="task-fields-title" className="flex flex-col gap-4 rounded-xl border border-border p-4">
              <h3 id="task-fields-title" className="flex items-center gap-2 text-sm font-semibold text-fg">
                {selectedType && <TaskTypeIconBadge icon={selectedType.icon} color={selectedType.color} size="sm" />}
                {t('tasks.typeFields', { name: selectedType?.name ?? '' })}
              </h3>
              {typeDetail.isPending ? (
                <AppSkeleton className="h-24" />
              ) : fields.length === 0 ? (
                <p className="text-sm text-muted">{t('tasks.noTypeFields')}</p>
              ) : (
                fields.map((link) => (
                  <CustomFieldInput
                    key={link.field.id}
                    field={link.field}
                    required={isEdit ? isRequiredIn(link, draft.statusId) : isRequiredOnCreate(link, draft.statusId)}
                    value={draft.values[link.field.name]}
                    error={valueErrors[link.field.name]}
                    references={references}
                    onChange={(value) => {
                      setDraft((d) => ({ ...d, values: { ...d.values, [link.field.name]: value } }))
                      setValueErrors(({ [link.field.name]: _removed, ...rest }) => rest)
                    }}
                  />
                ))
              )}
            </section>
          )}
        </div>

        <aside aria-label={t('tasks.properties')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-border lg:pl-8">
          <AppSelect
            label={t('tasks.fields.status')}
            value={draft.statusId || undefined}
            error={errors.status_id}
            onValueChange={(value) => set('statusId', value)}
            // só as transições permitidas a partir do status salvo (sem transições configuradas, todos)
            options={lookupOptions(statusChoices(statuses.data ?? [], task?.status?.id), task?.status)}
          />
          <AppSelect
            label={t('tasks.fields.priority')}
            value={draft.priorityId || undefined}
            error={errors.priority_id}
            onValueChange={(value) => set('priorityId', value)}
            options={lookupOptions(priorities.data ?? [], task?.priority)}
          />
          <AppSelect
            label={t('tasks.fields.assignee')}
            value={draft.assigneeId || NONE}
            error={errors.assignee_id}
            disabled={!canChangeAssignee || !draft.projectId}
            hint={!canChangeAssignee ? t('tasks.assignLocked') : undefined}
            onValueChange={(value) => set('assigneeId', value === NONE ? '' : value)}
            options={[
              { value: NONE, label: t('tasks.unassigned') },
              ...assignable.map((m) => ({ value: m.user.id, label: m.user.name })),
              ...(task?.assignee && !assignable.some((m) => m.user.id === task.assignee?.id) ? [{ value: task.assignee.id, label: task.assignee.name }] : []),
            ]}
          />
          <AppDatePicker
            label={t('tasks.fields.startDate')}
            value={draft.startDate}
            max={draft.dueDate || undefined}
            error={errors.start_date}
            clearable
            onValueChange={(value) => set('startDate', value)}
          />
          <AppDatePicker
            label={t('tasks.fields.dueDate')}
            value={draft.dueDate}
            min={draft.startDate || undefined}
            error={errors.due_date}
            clearable
            onValueChange={(value) => set('dueDate', value)}
          />
          <AppTextField
            label={t('tasks.fields.estimatedHours')}
            inputMode="decimal"
            value={draft.estimatedHours}
            error={errors.estimated_hours}
            onChange={(event) => set('estimatedHours', event.target.value.replace(/[^0-9,.]/g, ''))}
          />
          <AppTextField
            label={t('tasks.fields.actualHours')}
            inputMode="decimal"
            value={draft.actualHours}
            error={errors.actual_hours}
            onChange={(event) => set('actualHours', event.target.value.replace(/[^0-9,.]/g, ''))}
          />
          <AppSelect
            label={t('tasks.fields.sprint')}
            value={draft.sprintId || NONE}
            error={errors.sprint_id}
            disabled={!draft.projectId}
            onValueChange={(value) => set('sprintId', value === NONE ? '' : value)}
            options={[
              { value: NONE, label: t('sprints.none') },
              ...(sprints.data ?? []).map((c) => ({ value: c.id, label: c.name })),
              // sprint já encerrado continua visível na edição
              ...(task?.sprint && !(sprints.data ?? []).some((c) => c.id === task.sprint?.id)
                ? [{ value: task.sprint.id, label: task.sprint.name, disabled: true }]
                : []),
            ]}
          />
        </aside>
      </form>
    </AppDialog>
  )
}
