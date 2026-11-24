import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerDownRight } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { toDayInput } from '@/core/utils/format'
import type { FieldValue, OptionColor, TaskTypeField } from '@/domain/task-config'
import { customValueIssues, datesIssue, parseHours, type TaskDetail, type TaskInput } from '@/domain/tasks'
import { planItemStage, planStageChoices } from '@/domain/plan-tasks'
import { statusChoices, type StatusCategory } from '@/domain/workflow'
import { isUrgency, NO_URGENCY } from '@/domain/urgency'
import { AppButton, AppDatePicker, AppDialog, AppMultiSelect, AppSelect, AppTextField, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useCan } from '@/features/auth/session'
import { useProject, useProjectMembers, useProjects } from '@/features/projects/queries'
import { ColorDot, TaskTypeIconBadge } from '@/features/task-config/config-visuals'
import { useTaskType, useTaskTypes } from '@/features/task-config/queries'
import { useFieldOptionCreator } from '@/features/task-config/use-field-option-creator'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { AreaBadge } from '@/features/workflow/area-visuals'
import { useAreas, usePriorities, useStatuses } from '@/features/workflow/queries'
import { useTaskAttachments, useTaskMutations } from './queries'
import { PROJECT_OPTIONS_QUERY } from './required-fields'
import { TaskTypeFieldsSection } from './TaskTypeFieldsSection'
import { useUrgencyChoices } from './urgency-choices'
import { useFieldAttachmentUpload, useFieldFilesSender, useHeldFieldFiles } from './use-attachment-uploader'
import { useTags } from '@/features/tags/queries'
import { useSprints } from '@/features/backlog/queries'
import { usePlan } from '@/features/plan/queries'
import { DemandFormDialog, LockedValue } from '@/features/demands/DemandFormDialog'
import { CopyEmailsField } from './CopyEmailsField'
import { useRecentCopyEmails } from './use-recent-copy-emails'
import { useSendCopy } from './use-send-copy'
import { useDemandOwners } from '@/features/demands/queries'

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
  /**
   * Criação no módulo Tarefas (§45): qual formulário abre — o de tarefa de projeto (o de sempre) ou o da
   * demanda interna. Cada botão do cabeçalho abre só o seu; não há troca de tipo dentro da janela.
   */
  initialKind?: TaskKindChoice
}

/** Tarefa de projeto (como sempre) ou demanda interna (sem projeto, §45). */
export type TaskKindChoice = 'project' | 'demand'

export type TaskFormInitial = Partial<Pick<Draft, 'typeId' | 'title' | 'statusId' | 'priorityId' | 'assigneeId' | 'sprintId' | 'parentTaskId' | 'planItemId'>>

const NONE = '__none__'

interface LookupOption {
  id: string
  name: string
  color: OptionColor
  category?: StatusCategory
}


interface Draft {
  projectId: string
  typeId: string
  title: string
  description: string
  statusId: string
  priorityId: string
  /** Urgência (§31; '' = sem urgência). */
  urgency: string
  assigneeId: string
  /** Área responsável ('' = sem área). */
  areaId: string
  startDate: string
  dueDate: string
  estimatedHours: string
  actualHours: string
  values: Record<string, FieldValue>
  tagIds: string[]
  sprintId: string
  /** Subtarefa: pai (só na criação; na edição o vínculo muda pela aba Relações). */
  parentTaskId: string
  /** Elemento da Gestão já ligado (criação a partir do painel do elemento; '' = nenhum). */
  planItemId: string
  /** Etapa da Gestão em que a tarefa entra como linha nova ('' = sem etapa). */
  planGroupId: string
  /** Responsável que recebe e distribui (§45; '' = nenhum: a tarefa segue como sempre). */
  demandOwnerId: string
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
    urgency: task?.urgency ?? '',
    assigneeId: task?.assignee?.id ?? '',
    areaId: task?.area?.id ?? '',
    startDate: toDayInput(task?.startDate),
    dueDate: toDayInput(task?.dueDate),
    estimatedHours: hours(task?.estimatedHours ?? null),
    actualHours: hours(task?.actualHours ?? null),
    values: { ...(task?.customValues ?? {}) },
    tagIds: (task?.tags ?? []).map((tag) => tag.id),
    sprintId: task?.sprint?.id ?? '',
    parentTaskId: task?.parentTaskId ?? '',
    planItemId: task?.planItem?.id ?? '',
    planGroupId: '',
    demandOwnerId: task?.demand?.owner?.id ?? '',
    ...(task ? {} : initial),
  }
}

/**
 * Remonta o formulário a cada abertura (rascunho novo, sem efeitos). Demanda interna (§45) — em edição ou
 * na criação com `initialKind = 'demand'` — abre o formulário curto da demanda; o resto, o de sempre.
 */
export function TaskFormDialog(props: TaskFormDialogProps) {
  const key = props.open ? (props.task?.id ?? `new:${props.projectId ?? ''}:${props.initialKind ?? ''}`) : 'closed'
  if (props.task?.demand && !props.task.project) return <DemandFormDialog open={props.open} onOpenChange={props.onOpenChange} task={props.task} onSaved={props.onSaved} />
  if (props.initialKind === 'demand' && !props.task && !props.projectId) return <DemandFormDialog open={props.open} onOpenChange={props.onOpenChange} onSaved={props.onSaved} />
  return <TaskForm key={key} {...props} />
}

function TaskForm({ open, onOpenChange, task, projectId, initial, onSaved }: TaskFormDialogProps) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const canAssign = useCan('tasks.assign')
  const urgencyChoices = useUrgencyChoices()
  const isEdit = !!task
  const { create, update } = useTaskMutations()

  const [draft, setDraft] = useState<Draft>(() => draftFrom(task, projectId, initial))
  // "Com cópia" (ajuste 24/11): na criação vai junto; na edição, o aviso sai logo depois de salvar. Os endereços
  // usados ficam lembrados neste navegador
  const [ccEmails, setCcEmails] = useState<string[]>([])
  const copy = useRecentCopyEmails()
  const copySender = useSendCopy()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [valueErrors, setValueErrors] = useState<Record<string, string>>({})

  const types = useTaskTypes(false)
  // o formulário fica montado nas telas: fechado, não busca nada além das listas gerais (já em cache)
  const typeDetail = useTaskType(open ? draft.typeId || undefined : undefined)
  // projetos: para escolher o da tarefa (criação fora de um projeto) e como opções de campos do tipo "projeto"
  const hasProjectField = (typeDetail.data?.fields ?? []).some((link) => link.visible && link.field.type === 'project')
  const projects = useProjects(PROJECT_OPTIONS_QUERY, open && ((!isEdit && !projectId) || hasProjectField))
  const statuses = useStatuses(false)
  const priorities = usePriorities(false)
  const areas = useAreas(false)
  const members = useProjectMembers(open ? draft.projectId || undefined : undefined)
  // Empresa (§46): a tarefa de projeto herda a do projeto — só leitura, acompanha o projeto escolhido
  const fixedProject = useProject(open && !isEdit && projectId ? projectId : undefined)
  const company = isEdit
    ? (task?.company ?? null)
    : projectId
      ? (fixedProject.data?.company ?? null)
      : ((projects.data?.items ?? []).find((p) => p.id === draft.projectId)?.company ?? null)
  // campos de imagem/arquivo: na edição, escolhem entre os anexos da tarefa ou enviam pelo campo; na
  // criação (a tarefa ainda não existe), os arquivos escolhidos ficam aqui e vão logo depois de criar
  const taskAttachments = useTaskAttachments(open ? task?.id : undefined)
  const uploadToField = useFieldAttachmentUpload(task?.id ?? '')
  const heldFiles = useHeldFieldFiles()
  const sendFieldFiles = useFieldFilesSender()
  const [sendingFiles, setSendingFiles] = useState(false)
  const createOption = useFieldOptionCreator()
  const tags = useTags(open)
  // Responsável que recebe e distribui (§45): qualquer pessoa ativa; com ele, o fluxo da demanda vale na tarefa
  const owners = useDemandOwners(open)
  const withOwner = !!draft.demandOwnerId
  const flowHint = withOwner ? t('demands.projectFlow.locked') : undefined
  const sprints = useSprints(open ? draft.projectId || undefined : undefined)
  // Etapa da gestão: só para quem vê a Gestão e quando o quadro do projeto tem etapas. Tarefa já ligada
  // a um elemento (na edição, ou criada pelo painel do elemento) mostra a etapa dele só para leitura.
  const canViewPlan = useCan('plan.view')
  const plan = usePlan(draft.projectId, open && canViewPlan)
  const stages = useMemo(() => (plan.data ? planStageChoices(plan.data) : []), [plan.data])
  const linkedItem = isEdit ? (task?.planItem ?? null) : draft.planItemId ? { id: draft.planItemId, name: '' } : null
  const linkedStage = linkedItem && plan.data ? planItemStage(plan.data, linkedItem.id) : null
  const showStage = canViewPlan && (linkedItem ? !!(linkedStage || linkedItem.name) : stages.length > 0)

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
  // arquivo escolhido preenche o campo: some o "obrigatório" dele
  const heldForm = useMemo(
    () => ({
      ...heldFiles,
      add: (name: string, files: File[], imagesOnly: boolean) => {
        heldFiles.add(name, files, imagesOnly)
        setValueErrors(({ [name]: _removed, ...rest }) => rest)
      },
    }),
    [heldFiles],
  )
  const activeMembers = useMemo(() => (members.data ?? []).filter((m) => m.user.status === 'active'), [members.data])
  const references = useMemo(
    () => ({
      people: activeMembers.map((m) => ({ id: m.user.id, name: m.user.name })),
      projects: (projects.data?.items ?? []).map((p) => ({ id: p.id, key: p.key, name: p.name })),
      attachments: task ? (taskAttachments.data ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url })) : undefined,
      uploadFiles: task ? uploadToField : undefined,
      heldFiles: task ? undefined : heldForm,
      createOption,
    }),
    [activeMembers, projects.data, task, taskAttachments.data, uploadToField, heldForm, createOption],
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
  // nome em texto + ícone no prefixo: a lista com busca filtra e mostra pelo nome
  const typeOptions = [...typeList, ...currentType].map((type) => ({
    value: type.id,
    label: type.name,
    prefix: <TaskTypeIconBadge icon={type.icon} color={type.color} size="sm" />,
  }))

  const lookupOptions = (list: LookupOption[], current: LookupOption | null | undefined) =>
    [...list, ...(current && !list.some((x) => x.id === current.id) ? [current] : [])].map((item) => ({
      value: item.id,
      label: <LookupBadge item={item} />,
    }))

  const pending = create.isPending || update.isPending || copySender.pending || sendingFiles

  /** Depois de criar: envia os arquivos escolhidos nos campos. A tarefa já existe — falha não a desfaz. */
  async function sendHeldFiles(saved: TaskDetail): Promise<string[]> {
    const failed: string[] = []
    for (const link of fields) {
      const chosen = heldFiles.files[link.field.name] ?? []
      if ((link.field.type !== 'image' && link.field.type !== 'file') || chosen.length === 0) continue
      const result = await sendFieldFiles(saved.id, chosen, link.field.name, link.field.type === 'image')
      result.failed.forEach((item) => failed.push(`${item.name} (${item.reason})`))
    }
    return failed
  }

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
    // na criação, o campo de arquivo/imagem exigido conta os arquivos escolhidos (vão logo depois de criar)
    const held = isEdit ? undefined : Object.fromEntries(Object.entries(heldFiles.files).map(([name, list]) => [name, list.length]))
    const issues = customValueIssues(fields, draft.values, draft.statusId, held)
    setErrors(found)
    setValueErrors(issues)
    if (Object.keys(found).length > 0 || Object.keys(issues).length > 0) return

    const customValues: Record<string, FieldValue> = {}
    fields.forEach((link) => {
      if ((link.field.type === 'image' || link.field.type === 'file') && !isEdit) return
      const value = draft.values[link.field.name]
      customValues[link.field.name] = value === undefined || value === '' ? null : value
    })
    // com responsável (§45), status, executor, prazo e estimativa são do fluxo: não vão no corpo
    const flow = withOwner
    const ownerChanged = draft.demandOwnerId !== (task?.demand?.owner?.id ?? '')
    const data: TaskInput = {
      taskTypeId: draft.typeId,
      title: draft.title.trim(),
      description: draft.description,
      statusId: flow ? undefined : draft.statusId || undefined,
      priorityId: draft.priorityId || undefined,
      urgency: isUrgency(draft.urgency) ? draft.urgency : null,
      assigneeId: flow ? undefined : draft.assigneeId || null,
      // só quando mudou: a área inativa que a tarefa já tem continua valendo
      areaId: draft.areaId !== (task?.area?.id ?? '') ? draft.areaId || null : undefined,
      startDate: draft.startDate || null,
      dueDate: flow ? undefined : draft.dueDate || null,
      ...(ownerChanged ? { demandOwnerId: draft.demandOwnerId || null } : {}),
      estimatedHours: flow ? undefined : estimated,
      actualHours: actual,
      customValues,
      tagIds: draft.tagIds,
      sprintId: draft.sprintId || null,
      // etapa escolhida (só para a tarefa ainda fora da Gestão): o servidor cria a linha e liga
      planGroupId: !linkedItem && draft.planGroupId ? draft.planGroupId : undefined,
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
    const done = (saved: TaskDetail) => {
      onSaved?.(saved)
      onOpenChange(false)
    }
    const onSuccess = (saved: TaskDetail) => {
      notify.success(isEdit ? t('tasks.updated', { code: saved.code }) : t('tasks.created', { code: saved.code }))
      done(saved)
    }
    // edição com alguém em cópia: a tarefa já está salva; o aviso sai em seguida e a tela diz para quem foi
    const onUpdated = (saved: TaskDetail) => {
      if (ccEmails.length === 0) return onSuccess(saved)
      copySender.send(
        saved,
        ccEmails,
        () => {
          copy.remember(ccEmails)
          done(saved)
        },
        onError,
      )
    }
    const onCreated = async (saved: TaskDetail) => {
      setSendingFiles(true)
      let failed: string[] = []
      try {
        failed = await sendHeldFiles(saved)
      } finally {
        setSendingFiles(false)
      }
      onSuccess(saved)
      if (failed.length > 0) notify.warning(t('tasks.filesNotSent', { count: failed.length, code: saved.code, names: failed.join(', ') }))
    }
    if (task) update.mutate({ id: task.id, data }, { onSuccess: onUpdated, onError })
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
          // criada pelo painel do elemento: já nasce ligada a ele
          planItemId: draft.planItemId || undefined,
          ccEmails,
        },
        {
          onSuccess: (saved) => {
            copy.remember(ccEmails)
            void onCreated(saved)
          },
          onError,
        },
      )
  }

  const assignable = activeMembers.filter((m) => m.role !== 'viewer' || m.isOwner)
  const canChangeAssignee = isEdit ? !!task?.capabilities.assign : canAssign
  const selectedType = types.data?.find((x) => x.id === draft.typeId) ?? task?.type ?? null

  return (
    <AppDialog
      open={open}
      // enviando os arquivos da tarefa recém-criada: espera terminar
      onOpenChange={(next) => !sendingFiles && onOpenChange(next)}
      size="2xl"
      closeOnOutsideClick={false}
      title={isEdit ? t('tasks.editTitle', { code: task?.code }) : t('tasks.createTitle')}
      description={isEdit ? task?.title : undefined}
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
                searchable
                value={draft.projectId || undefined}
                placeholder={t('fields.selectPlaceholder')}
                error={errors.project_id}
                onValueChange={(value) => setDraft((d) => ({ ...d, projectId: value, assigneeId: '', sprintId: '', planItemId: '', planGroupId: '' }))}
                options={(projects.data?.items ?? [])
                  .filter((p) => p.myRole !== 'viewer' && !p.archivedAt)
                  .map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))}
              />
            )}
            <AppSelect
              label={t('tasks.fields.type')}
              required
              searchable
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
          {showStage &&
            (linkedItem ? (
              <AppSelect
                disabled
                label={t('tasks.stage.label')}
                value={linkedItem.id}
                hint={t('tasks.stage.linkedHint', { path: linkedStage?.path ?? linkedItem.name })}
                onValueChange={() => {}}
                options={[{ value: linkedItem.id, label: linkedStage?.stage ?? linkedItem.name }]}
              />
            ) : (
              <AppSelect
                label={t('tasks.stage.label')}
                searchable
                value={draft.planGroupId || NONE}
                error={errors.plan_group_id}
                onValueChange={(value) => set('planGroupId', value === NONE ? '' : value)}
                options={[
                  { value: NONE, label: t('tasks.stage.none') },
                  ...stages.map((stage) => ({
                    value: stage.id,
                    label: stage.label,
                    prefix: stage.sub ? <CornerDownRight className="size-3.5 shrink-0 text-subtle" aria-hidden /> : undefined,
                  })),
                ]}
              />
            ))}
          {draft.typeId && (
            <TaskTypeFieldsSection
              type={selectedType}
              loading={typeDetail.isPending}
              fields={fields}
              values={draft.values}
              errors={valueErrors}
              statusId={draft.statusId}
              references={references}
              onChange={(name, value) => {
                setDraft((d) => ({ ...d, values: { ...d.values, [name]: value } }))
                setValueErrors(({ [name]: _removed, ...rest }) => rest)
              }}
            />
          )}
        </div>

        <aside aria-label={t('tasks.properties')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-border lg:pl-8">
          <LockedValue label={t('companies.field')}>{company ? company.name : draft.projectId ? t('companies.none') : '—'}</LockedValue>
          <AppSelect
            label={t('demands.projectFlow.owner')}
            searchable
            value={draft.demandOwnerId || NONE}
            error={errors.demand_owner_id}
            disabled={!canChangeAssignee || !draft.projectId}
            onValueChange={(value) => set('demandOwnerId', value === NONE ? '' : value)}
            options={[
              { value: NONE, label: t('demands.projectFlow.none') },
              ...(owners.data ?? []).map((person) => ({ value: person.id, label: person.name })),
              ...(task?.demand?.owner && !(owners.data ?? []).some((person) => person.id === task.demand?.owner?.id)
                ? [{ value: task.demand.owner.id, label: task.demand.owner.name }]
                : []),
            ]}
          />
          <CopyEmailsField value={ccEmails} onChange={setCcEmails} error={errors.cc_emails} recent={copy.recent} />
          <AppSelect
            label={t('tasks.fields.status')}
            value={draft.statusId || undefined}
            error={errors.status_id}
            disabled={withOwner}
            hint={flowHint}
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
            label={t('tasks.fields.urgency')}
            value={draft.urgency || NO_URGENCY}
            error={errors.urgency}
            onValueChange={(value) => set('urgency', value === NO_URGENCY ? '' : value)}
            options={urgencyChoices}
          />
          <AppSelect
            label={t('tasks.fields.assignee')}
            searchable
            value={draft.assigneeId || NONE}
            error={errors.assignee_id}
            disabled={withOwner || !canChangeAssignee || !draft.projectId}
            hint={withOwner ? flowHint : !canChangeAssignee ? t('tasks.assignLocked') : undefined}
            onValueChange={(value) => set('assigneeId', value === NONE ? '' : value)}
            options={[
              { value: NONE, label: t('tasks.unassigned') },
              ...assignable.map((m) => ({ value: m.user.id, label: m.user.name })),
              ...(task?.assignee && !assignable.some((m) => m.user.id === task.assignee?.id) ? [{ value: task.assignee.id, label: task.assignee.name }] : []),
            ]}
          />
          <AppSelect
            label={t('tasks.fields.area')}
            searchable
            value={draft.areaId || NONE}
            error={errors.area_id}
            onValueChange={(value) => set('areaId', value === NONE ? '' : value)}
            options={[
              { value: NONE, label: t('areas.none') },
              // a área inativa que a tarefa já tem continua na lista
              ...[...(areas.data ?? []), ...(task?.area && !(areas.data ?? []).some((a) => a.id === task.area?.id) ? [task.area] : [])].map((a) => ({
                value: a.id,
                label: <AreaBadge area={a} />,
                textValue: a.name,
              })),
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
            disabled={withOwner}
            hint={flowHint}
            clearable
            onValueChange={(value) => set('dueDate', value)}
          />
          <AppTextField
            label={t('tasks.fields.estimatedHours')}
            inputMode="decimal"
            value={draft.estimatedHours}
            error={errors.estimated_hours}
            disabled={withOwner}
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
            searchable
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
