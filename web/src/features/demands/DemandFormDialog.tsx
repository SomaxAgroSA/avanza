import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { formatShortDateTime } from '@/core/utils/format'
import type { FieldValue, TaskTypeField } from '@/domain/task-config'
import { customValueIssues, type TaskDetail } from '@/domain/tasks'
import { isUrgency, NO_URGENCY } from '@/domain/urgency'
import { AppAvatar, AppButton, AppDialog, AppFormField, AppSelect, AppTextField, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { TaskTypeIconBadge } from '@/features/task-config/config-visuals'
import { useTaskType, useTaskTypes } from '@/features/task-config/queries'
import { useFieldOptionCreator } from '@/features/task-config/use-field-option-creator'
import { LookupBadge } from '@/features/workflow/workflow-visuals'
import { useAreas, usePriorities, useStatuses } from '@/features/workflow/queries'
import { useProjects } from '@/features/projects/queries'
import { useTaskAttachments, useTaskMutations } from '@/features/tasks/queries'
import { PROJECT_OPTIONS_QUERY } from '@/features/tasks/required-fields'
import { TaskTypeFieldsSection } from '@/features/tasks/TaskTypeFieldsSection'
import { useUrgencyChoices } from '@/features/tasks/urgency-choices'
import { useFieldAttachmentUpload, useFieldFilesSender, useHeldFieldFiles } from '@/features/tasks/use-attachment-uploader'
import { useDemandMutations, useDemandOwners } from './queries'
import { useCompanies } from '@/features/companies/queries'
import { CopyEmailsField } from '@/features/tasks/CopyEmailsField'
import { useRecentCopyEmails } from '@/features/tasks/use-recent-copy-emails'
import { useSendCopy } from '@/features/tasks/use-send-copy'
import { companyRequired } from '@/domain/companies'

export interface DemandFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Demanda em edição; ausente = nova. */
  task?: TaskDetail | null
  onSaved?: (task: TaskDetail) => void
}

interface Draft {
  typeId: string
  title: string
  description: string
  ownerId: string
  areaId: string
  priorityId: string
  /** Urgência (§31; '' = sem urgência). */
  urgency: string
  /** Empresa (§46; '' = sem empresa). */
  companyId: string
}

/** Valor fixo (abertura, prazo, responsável na edição): com cadeado, sem campo. */
export function LockedValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <AppFormField label={label}>
      {() => (
        <div className="flex min-h-9 items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2 px-3 py-2 text-sm text-muted">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">{children}</span>
        </div>
      )}
    </AppFormField>
  )
}

/** Remonta a cada abertura (rascunho novo). */
export function DemandFormDialog(props: DemandFormDialogProps) {
  const key = props.open ? (props.task?.id ?? 'new') : 'closed'
  return <DemandForm key={key} {...props} />
}

/**
 * Demanda interna (§45): o formulário curto. Esquerda: Tipo, Título e Descrição; direita: Responsável
 * (qualquer pessoa ativa; quem recebe e distribui), Departamento que pede, Prioridade, Urgência, Abertura (automática,
 * travada) e Prazo (quem define é o responsável ao atribuir). Na edição o responsável fica fixo.
 */
function DemandForm({ open, onOpenChange, task, onSaved }: DemandFormDialogProps) {
  const { t, i18n } = useTranslation()
  const errorMessage = useErrorMessage()
  const isEdit = !!task
  const { create } = useDemandMutations()
  const { update } = useTaskMutations()
  const [draft, setDraft] = useState<Draft>(() => ({
    typeId: task?.type?.id ?? '',
    title: task?.title ?? '',
    description: task?.description ?? '',
    ownerId: task?.demand?.owner?.id ?? '',
    areaId: task?.area?.id ?? '',
    priorityId: task?.priority?.id ?? '',
    urgency: task?.urgency ?? '',
    companyId: task?.company?.id ?? '',
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  // "Com cópia" (ajuste 24/11): na abertura vai junto; na edição, o aviso sai logo depois de salvar. Os
  // endereços usados ficam lembrados neste navegador
  const [ccEmails, setCcEmails] = useState<string[]>([])
  const copy = useRecentCopyEmails()
  const copySender = useSendCopy()
  const [openedAt] = useState(() => new Date())
  const types = useTaskTypes(false)
  const priorities = usePriorities(false)
  const urgencyChoices = useUrgencyChoices()
  const areas = useAreas(false)
  // Empresa (§46): obrigatória quando existe empresa ativa (a regra é do servidor; aqui só antecipa)
  const companies = useCompanies(open)
  const needsCompany = companyRequired(companies.data ?? [])

  // Campos do tipo (§45): os mesmos da tarefa de projeto, exigidos no status em que a demanda está (ou nasce: o padrão)
  const [values, setValues] = useState<Record<string, FieldValue>>(() => ({ ...(task?.customValues ?? {}) }))
  const [valueErrors, setValueErrors] = useState<Record<string, string>>({})
  const typeDetail = useTaskType(open ? draft.typeId || undefined : undefined)
  const fields: TaskTypeField[] = useMemo(() => (typeDetail.data?.fields ?? []).filter((f) => f.visible), [typeDetail.data])
  const uses = (...kinds: string[]) => fields.some((link) => kinds.includes(link.field.type))
  const statuses = useStatuses(false)
  const statusId = isEdit ? task?.status?.id : statuses.data?.find((s) => s.isDefault)?.id
  // pessoas: o responsável (na criação) e os campos de pessoa; qualquer pessoa ativa, como no servidor
  const owners = useDemandOwners(open && (!isEdit || uses('user', 'users')))
  const projects = useProjects(PROJECT_OPTIONS_QUERY, open && uses('project'))
  // imagem/arquivo: na edição, anexos da demanda ou envio pelo campo; na criação, ficam aqui e vão logo depois de criar
  const taskAttachments = useTaskAttachments(open && uses('image', 'file') ? task?.id : undefined)
  const uploadToField = useFieldAttachmentUpload(task?.id ?? '')
  const heldFiles = useHeldFieldFiles()
  const sendFieldFiles = useFieldFilesSender()
  const [sendingFiles, setSendingFiles] = useState(false)
  const createOption = useFieldOptionCreator()
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
  const references = useMemo(
    () => ({
      people: (owners.data ?? []).map((p) => ({ id: p.id, name: p.name })),
      projects: (projects.data?.items ?? []).map((p) => ({ id: p.id, key: p.key, name: p.name })),
      attachments: task ? (taskAttachments.data ?? []).map((a) => ({ id: a.id, name: a.name, kind: a.kind, url: a.url })) : undefined,
      uploadFiles: task ? uploadToField : undefined,
      heldFiles: task ? undefined : heldForm,
      createOption,
    }),
    [owners.data, projects.data, task, taskAttachments.data, uploadToField, heldForm, createOption],
  )
  // padrões do tipo (criação): aplicados quando os campos do tipo chegam
  const [defaultsFor, setDefaultsFor] = useState<string | null>(isEdit ? (task?.type?.id ?? null) : null)
  if (!isEdit && typeDetail.data && defaultsFor !== typeDetail.data.id && typeDetail.data.id === draft.typeId) {
    setDefaultsFor(typeDetail.data.id)
    const next = { ...values }
    typeDetail.data.fields.forEach((link) => {
      if (link.visible && next[link.field.name] === undefined && link.field.defaultValue !== null) next[link.field.name] = link.field.defaultValue
    })
    setValues(next)
  }
  const pending = create.isPending || update.isPending || copySender.pending || sendingFiles

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setErrors((e) => ({ ...e, [fieldOf(key)]: '' }))
  }

  const typeOptions = [...(types.data ?? []), ...(task?.type && !(types.data ?? []).some((x) => x.id === task.type?.id) ? [task.type] : [])].map((type) => ({
    value: type.id,
    label: type.name,
    prefix: <TaskTypeIconBadge icon={type.icon} color={type.color} size="sm" />,
  }))
  const priorityOptions = (priorities.data ?? []).map((item) => ({ value: item.id, label: <LookupBadge item={item} /> }))
  const areaOptions = [...(areas.data ?? []), ...(task?.area && !(areas.data ?? []).some((a) => a.id === task.area?.id) ? [task.area] : [])].map((area) => ({ value: area.id, label: area.name }))
  // a empresa inativa que a demanda já tem continua na lista
  const companyOptions = [...(companies.data ?? []), ...(task?.company && !(companies.data ?? []).some((c) => c.id === task.company?.id) ? [task.company] : [])].map((c) => ({ value: c.id, label: c.name }))
  // lista com busca: rótulo em texto e a foto à esquerda
  const ownerOptions = (owners.data ?? []).map((person) => ({ value: person.id, label: person.name, prefix: <AppAvatar name={person.name} src={person.avatarUrl} size="xs" /> }))

  function submit() {
    const found: Record<string, string> = {}
    if (!draft.typeId) found.task_type_id = 'required'
    if (!draft.title.trim()) found.title = 'required'
    if (!isEdit && !draft.ownerId) found.demand_owner_id = 'required'
    if (!draft.areaId) found.area_id = 'required'
    // obrigatória ao abrir; a demanda antiga (sem empresa) pode ser editada sem escolher
    if (!isEdit && needsCompany && !draft.companyId) found.company_id = 'required'
    // na criação, o campo de arquivo/imagem exigido conta os arquivos escolhidos (vão logo depois de criar)
    const held = isEdit ? undefined : Object.fromEntries(Object.entries(heldFiles.files).map(([name, list]) => [name, list.length]))
    const issues = customValueIssues(fields, values, statusId, held)
    setValueErrors(issues)
    if (Object.keys(found).length > 0 || Object.keys(issues).length > 0) return setErrors(found)
    const customValues: Record<string, FieldValue> = {}
    fields.forEach((link) => {
      if ((link.field.type === 'image' || link.field.type === 'file') && !isEdit) return
      const value = values[link.field.name]
      customValues[link.field.name] = value === undefined || value === '' ? null : value
    })
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
        const base: Record<string, string> = {}
        const custom: Record<string, string> = {}
        Object.entries(error.fieldErrors()).forEach(([key, code]) => {
          if (key.startsWith('custom_values.')) custom[key.slice('custom_values.'.length)] = code
          else base[key] = code
        })
        setErrors(base)
        setValueErrors(custom)
      } else notify.error(errorMessage(error))
    }
    if (isEdit && task) {
      update.mutate(
        {
          id: task.id,
          data: {
            taskTypeId: draft.typeId,
            title: draft.title.trim(),
            description: draft.description,
            areaId: draft.areaId,
            ...(draft.priorityId ? { priorityId: draft.priorityId } : {}),
            urgency: isUrgency(draft.urgency) ? draft.urgency : null,
            // só quando mudou: a empresa inativa que a demanda já tem continua valendo
            ...(draft.companyId && draft.companyId !== (task.company?.id ?? '') ? { companyId: draft.companyId } : {}),
            customValues,
          },
        },
        {
          onSuccess: (saved) => {
            const done = () => {
              onOpenChange(false)
              onSaved?.(saved)
            }
            if (ccEmails.length === 0) {
              notify.success(t('demands.saved', { code: saved.code }))
              return done()
            }
            // alguém em cópia: a demanda já está salva; o aviso sai em seguida e a tela diz para quem foi
            copySender.send(
              saved,
              ccEmails,
              () => {
                copy.remember(ccEmails)
                done()
              },
              onError,
            )
          },
          onError,
        },
      )
      return
    }
    /** Depois de criar: envia os arquivos escolhidos nos campos. A demanda já existe — falha não a desfaz. */
    const onCreated = async (saved: TaskDetail) => {
      const failed: string[] = []
      setSendingFiles(true)
      try {
        for (const link of fields) {
          const chosen = heldFiles.files[link.field.name] ?? []
          if ((link.field.type !== 'image' && link.field.type !== 'file') || chosen.length === 0) continue
          const result = await sendFieldFiles(saved.id, chosen, link.field.name, link.field.type === 'image')
          result.failed.forEach((item) => failed.push(`${item.name} (${item.reason})`))
        }
      } finally {
        setSendingFiles(false)
      }
      notify.success(t('demands.created', { code: saved.code, owner: saved.demand?.owner?.name ?? '' }))
      onOpenChange(false)
      onSaved?.(saved)
      if (failed.length > 0) notify.warning(t('tasks.filesNotSent', { count: failed.length, code: saved.code, names: failed.join(', ') }))
    }
    create.mutate(
      {
        taskTypeId: draft.typeId,
        title: draft.title.trim(),
        description: draft.description,
        ownerId: draft.ownerId,
        areaId: draft.areaId,
        ...(draft.priorityId ? { priorityId: draft.priorityId } : {}),
        ...(isUrgency(draft.urgency) ? { urgency: draft.urgency } : {}),
        ...(draft.companyId ? { companyId: draft.companyId } : {}),
        customValues,
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

  return (
    <AppDialog
      open={open}
      // enviando os arquivos da demanda recém-criada: espera terminar
      onOpenChange={(next) => !sendingFiles && onOpenChange(next)}
      size="2xl"
      closeOnOutsideClick={false}
      title={isEdit ? t('demands.form.editTitle', { code: task?.code }) : t('demands.form.createTitle')}
      description={isEdit ? task?.title : undefined}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {isEdit ? t('common.save') : t('demands.form.submit')}
          </AppButton>
        </>
      }
    >
      <form
        noValidate
        aria-label={t('demands.newDemand')}
        className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_20rem]"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="flex min-w-0 flex-col gap-5">
          <AppSelect
            label={t('tasks.fields.type')}
            required
            searchable
            value={draft.typeId || undefined}
            placeholder={t('fields.selectPlaceholder')}
            error={errors.task_type_id}
            onValueChange={(value) => {
              set('typeId', value)
              setValueErrors({})
            }}
            options={typeOptions}
          />
          <AppTextField
            label={t('tasks.fields.title')}
            required
            autoComplete="off"
            maxLength={200}
            value={draft.title}
            error={errors.title}
            placeholder={t('demands.form.titlePlaceholder')}
            onChange={(event) => set('title', event.target.value)}
          />
          <AppTextarea
            label={t('tasks.fields.description')}
            rows={6}
            maxLength={50000}
            value={draft.description}
            error={errors.description}
            placeholder={t('demands.form.descriptionPlaceholder')}
            onChange={(event) => set('description', event.target.value)}
          />
          {draft.typeId && (
            <TaskTypeFieldsSection
              type={types.data?.find((x) => x.id === draft.typeId) ?? task?.type ?? null}
              loading={typeDetail.isPending}
              fields={fields}
              values={values}
              errors={valueErrors}
              statusId={statusId}
              references={references}
              onChange={(name, value) => {
                setValues((v) => ({ ...v, [name]: value }))
                setValueErrors(({ [name]: _removed, ...rest }) => rest)
              }}
            />
          )}
        </div>
        <aside aria-label={t('tasks.properties')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:border-l lg:border-border lg:pl-8">
          <AppSelect
            label={t('companies.field')}
            searchable
            required={needsCompany && (!isEdit || !!task?.company)}
            value={draft.companyId || undefined}
            placeholder={t('companies.placeholder')}
            error={errors.company_id}
            onValueChange={(value) => set('companyId', value)}
            options={companyOptions}
          />
          {isEdit ? (
            <LockedValue label={t('demands.form.owner')}>
              <span title={t('demands.form.ownerFixed')}>{task?.demand?.owner?.name ?? '—'}</span>
            </LockedValue>
          ) : (
            <AppSelect
              label={t('demands.form.owner')}
              required
              searchable
              value={draft.ownerId || undefined}
              placeholder={t('fields.selectPlaceholder')}
              error={errors.demand_owner_id}
              onValueChange={(value) => set('ownerId', value)}
              options={ownerOptions}
            />
          )}
          <CopyEmailsField value={ccEmails} onChange={setCcEmails} error={errors.cc_emails} recent={copy.recent} />
          <AppSelect
            label={t('demands.form.department')}
            required
            searchable
            value={draft.areaId || undefined}
            placeholder={t('fields.selectPlaceholder')}
            error={errors.area_id}
            onValueChange={(value) => set('areaId', value)}
            options={areaOptions}
          />
          <AppSelect
            label={t('tasks.fields.priority')}
            value={draft.priorityId || (priorities.data ?? []).find((p) => p.isDefault)?.id}
            error={errors.priority_id}
            onValueChange={(value) => set('priorityId', value)}
            options={priorityOptions}
          />
          <AppSelect
            label={t('tasks.fields.urgency')}
            value={draft.urgency || NO_URGENCY}
            error={errors.urgency}
            onValueChange={(value) => set('urgency', value === NO_URGENCY ? '' : value)}
            options={urgencyChoices}
          />
          <LockedValue label={t('demands.form.opening')}>
            {t('demands.form.openingAuto', { date: formatShortDateTime(task?.demand?.openedAt ?? openedAt, i18n.language) })}
          </LockedValue>
          <LockedValue label={t('demands.form.deadline')}>
            {task?.demand?.dueAt ? formatShortDateTime(task.demand.dueAt, i18n.language) : t('demands.form.deadlineLocked')}
          </LockedValue>
        </aside>
      </form>
    </AppDialog>
  )
}

/** Campo do rascunho → nome do campo na API (erros). */
function fieldOf(key: keyof Draft): string {
  return { typeId: 'task_type_id', title: 'title', description: 'description', ownerId: 'demand_owner_id', areaId: 'area_id', priorityId: 'priority_id', urgency: 'urgency', companyId: 'company_id' }[key]
}
