import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { isAppError } from '@/core/errors/app-error'
import { toDayInput } from '@/core/utils/format'
import { PROJECT_COVERS, PROJECT_ICONS, PROJECT_PRIORITIES, PROJECT_STATUSES, canHaveParent, parentCandidates, suggestKey, type Project } from '@/domain/projects'
import { projectSchema, type ProjectInput } from '@/domain/validation'
import { TASK_URGENCIES } from '@/domain/tasks'
import { AppButton, AppDatePicker, AppDialog, AppFormField, AppSelect, AppTextField, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useAreas } from '@/features/workflow/queries'
import { PROJECT_ICON_COMPONENTS, coverStyle } from './project-theme'
import { ProjectAvatar } from './project-visuals'
import { useCreateProject, useProjects, useUpdateProject } from './queries'

const SERVER_FIELDS: Record<string, keyof ProjectInput> = { start_date: 'startDate', due_date: 'dueDate', area_id: 'areaId', parent_id: 'parentId' }

/** Valor do select para "sem área" (o select não aceita string vazia). */
const NO_AREA = '__none__'

/** Projetos que podem ser pai (sem pai, ativos): até 100, ordenados pelo nome. */
const PARENT_QUERY = { view: 'all' as const, page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' as const }, search: '', filters: { parent: 'none' } }

function defaults(project?: Project | null, parentId?: string): ProjectInput {
  return {
    name: project?.name ?? '',
    key: project?.key ?? '',
    description: project?.description ?? '',
    icon: project?.icon ?? 'folder',
    cover: project?.cover ?? 'violet',
    status: project?.status ?? 'planning',
    priority: project?.priority ?? 'medium',
    urgency: project?.urgency ?? 'none',
    areaId: project?.area?.id ?? '',
    parentId: project ? (project.parent?.id ?? '') : (parentId ?? ''),
    startDate: toDayInput(project?.startDate),
    dueDate: toDayInput(project?.dueDate),
  }
}

export interface ProjectFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ausente = criação. */
  project?: Project | null
  /** Criação de subprojeto: o pai já vem escolhido. */
  parentId?: string
}

export function ProjectFormDialog({ open, onOpenChange, project, parentId }: ProjectFormDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const isEdit = !!project
  const create = useCreateProject()
  const update = useUpdateProject()
  const pending = create.isPending || update.isPending
  const areas = useAreas(false)
  const parents = useProjects(PARENT_QUERY, open)
  const parentOptions = parentCandidates(parents.data?.items ?? [], project)
  const lockedParent = !canHaveParent(project)

  const { register, handleSubmit, reset, control, setValue, setError, formState } = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: defaults(project, parentId),
  })

  useEffect(() => {
    if (!open) return
    reset(defaults(project, parentId))
  }, [open, project, parentId, reset])

  const [name, key, icon, cover] = useWatch({ control, name: ['name', 'key', 'icon', 'cover'] })

  const onSubmit = handleSubmit((values) => {
    const data = {
      name: values.name.trim(),
      description: values.description,
      icon: values.icon,
      cover: values.cover,
      status: values.status,
      priority: values.priority,
      urgency: values.urgency === 'none' ? null : values.urgency,
      areaId: values.areaId || null,
      parentId: values.parentId || null,
      startDate: values.startDate || null,
      dueDate: values.dueDate || null,
    }
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'PROJECT_KEY_IN_USE') return setError('key', { message: 'key_in_use' })
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
        return Object.entries(error.fieldErrors()).forEach(([field, code]) =>
          setError(SERVER_FIELDS[field] ?? (field as keyof ProjectInput), { message: code }),
        )
      }
      notify.error(errorMessage(error))
    }
    if (project) {
      update.mutate(
        { id: project.id, data },
        {
          onSuccess: () => {
            notify.success(t('projects.updated'))
            onOpenChange(false)
          },
          onError,
        },
      )
    } else {
      create.mutate(
        { ...data, key: values.key.trim().toUpperCase() },
        {
          onSuccess: (created) => {
            notify.success(t('projects.created', { key: created.key }))
            onOpenChange(false)
            navigate(`/projects/${created.id}`)
          },
          onError,
        },
      )
    }
  })

  // A chave acompanha o nome até o usuário editá-la manualmente (campo "sujo").
  const keyTouched = isEdit || !!formState.dirtyFields.key
  const nameField = register('name', {
    onChange: (event: { target: { value: string } }) => {
      if (!keyTouched) setValue('key', suggestKey(event.target.value), { shouldValidate: formState.isSubmitted })
    },
  })
  const keyField = register('key')
  const errors = formState.errors

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      closeOnOutsideClick={false}
      title={isEdit ? t('projects.editTitle') : t('projects.createTitle')}
      description={isEdit ? `${project?.key} · ${project?.name}` : t('projects.createDescription')}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" form="project-form" loading={pending}>
            {isEdit ? t('common.save') : t('projects.create')}
          </AppButton>
        </>
      }
    >
      <form id="project-form" onSubmit={onSubmit} noValidate className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <AppTextField label={t('projects.fields.name')} required autoComplete="off" error={errors.name?.message} {...nameField} />
            <AppTextField
              label={t('projects.fields.key')}
              required
              autoComplete="off"
              disabled={isEdit}
              maxLength={10}
              className="font-mono uppercase"
              hint={isEdit ? t('projects.keyLocked') : t('projects.keyHint')}
              error={errors.key?.message}
              {...keyField}
            />
          </div>

          <AppTextarea label={t('projects.fields.description')} rows={4} error={errors.description?.message} {...register('description')} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <AppSelect
                  label={t('projects.fields.status')}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={PROJECT_STATUSES.map((s) => ({ value: s, label: t(`projects.status.${s}`) }))}
                />
              )}
            />
            <Controller
              control={control}
              name="priority"
              render={({ field }) => (
                <AppSelect
                  label={t('projects.fields.priority')}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={PROJECT_PRIORITIES.map((p) => ({ value: p, label: t(`projects.priority.${p}`) }))}
                />
              )}
            />
            <Controller
              control={control}
              name="urgency"
              render={({ field }) => (
                <AppSelect
                  label={t('tasks.fields.urgency')}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={[...TASK_URGENCIES, 'none' as const].map((u) => ({ value: u, label: t(`tasks.urgency.${u}`) }))}
                />
              )}
            />
            <Controller
              control={control}
              name="areaId"
              render={({ field }) => (
                <AppSelect
                  label={t('tasks.fields.area')}
                  value={field.value || NO_AREA}
                  onValueChange={(value) => field.onChange(value === NO_AREA ? '' : value)}
                  error={errors.areaId?.message}
                  options={[
                    { value: NO_AREA, label: t('areas.none') },
                    ...(areas.data ?? []).map((a) => ({ value: a.id, label: a.name })),
                    ...(project?.area && !(areas.data ?? []).some((a) => a.id === project.area?.id) ? [{ value: project.area.id, label: project.area.name }] : []),
                  ]}
                />
              )}
            />
            <Controller
              control={control}
              name="parentId"
              render={({ field }) => {
                const current = project?.parent ?? null
                const options = [
                  { value: NO_AREA, label: t('projects.parent.none') },
                  ...parentOptions.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` })),
                ]
                if (current && !options.some((o) => o.value === current.id)) options.push({ value: current.id, label: `${current.key} · ${current.name}` })
                if (field.value && !options.some((o) => o.value === field.value)) options.push({ value: field.value, label: field.value })
                return (
                  <AppSelect
                    label={t('projects.parent.field')}
                    value={field.value || NO_AREA}
                    onValueChange={(value) => field.onChange(value === NO_AREA ? '' : value)}
                    disabled={lockedParent}
                    hint={lockedParent ? t('projects.parent.lockedHint', { count: project?.childCount ?? 0 }) : t('projects.parent.hint')}
                    error={errors.parentId?.message}
                    options={options}
                  />
                )
              }}
            />
            <Controller
              control={control}
              name="startDate"
              render={({ field }) => (
                <AppDatePicker label={t('projects.fields.startDate')} value={field.value} onValueChange={field.onChange} error={errors.startDate?.message} />
              )}
            />
            <Controller
              control={control}
              name="dueDate"
              render={({ field }) => (
                <AppDatePicker label={t('projects.fields.dueDate')} value={field.value} onValueChange={field.onChange} error={errors.dueDate?.message} />
              )}
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:border-l lg:border-border lg:pl-8">
          <div className="flex items-center gap-4 rounded-xl border border-border p-4">
            <ProjectAvatar icon={icon} cover={cover} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">{name || t('projects.namePlaceholder')}</p>
              <p className="font-mono text-xs text-muted">{key ? key.toUpperCase() : '—'}</p>
            </div>
          </div>

          <Controller
            control={control}
            name="icon"
            render={({ field }) => (
              <AppFormField label={t('projects.fields.icon')}>
                {({ id }) => (
                  <div id={id} role="radiogroup" aria-label={t('projects.fields.icon')} className="grid grid-cols-10 gap-1.5">
                    {PROJECT_ICONS.map((key) => {
                      const Icon = PROJECT_ICON_COMPONENTS[key]
                      const selected = field.value === key
                      return (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={t(`projects.icons.${key}`)}
                          title={t(`projects.icons.${key}`)}
                          onClick={() => field.onChange(key)}
                          className={cn(
                            'flex aspect-square items-center justify-center rounded-md border text-muted transition-colors hover:bg-surface-2 hover:text-fg',
                            selected ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-border',
                          )}
                        >
                          <Icon className="size-4" />
                        </button>
                      )
                    })}
                  </div>
                )}
              </AppFormField>
            )}
          />

          <Controller
            control={control}
            name="cover"
            render={({ field }) => (
              <AppFormField label={t('projects.fields.cover')}>
                {({ id }) => (
                  <div id={id} role="radiogroup" aria-label={t('projects.fields.cover')} className="flex flex-wrap gap-2">
                    {PROJECT_COVERS.map((key) => {
                      const selected = field.value === key
                      return (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={t(`projects.covers.${key}`)}
                          title={t(`projects.covers.${key}`)}
                          onClick={() => field.onChange(key)}
                          style={coverStyle(key)}
                          className={cn(
                            'flex size-8 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-surface transition-transform hover:scale-110',
                            selected && 'ring-2 ring-primary',
                          )}
                        >
                          {selected && <Check className="size-4" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </AppFormField>
            )}
          />
        </div>
      </form>
    </AppDialog>
  )
}
