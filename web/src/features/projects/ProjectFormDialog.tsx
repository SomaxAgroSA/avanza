import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { isAppError } from '@/core/errors/app-error'
import { toDayInput } from '@/core/utils/format'
import { PROJECT_COVERS, PROJECT_ICONS, PROJECT_PRIORITIES, PROJECT_STATUSES, suggestKey, type Project } from '@/domain/projects'
import { projectSchema, type ProjectInput } from '@/domain/validation'
import { AppButton, AppDatePicker, AppDialog, AppFormField, AppSelect, AppTextField, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { PROJECT_ICON_COMPONENTS, coverStyle } from './project-theme'
import { ProjectAvatar } from './project-visuals'
import { useCreateProject, useUpdateProject } from './queries'

const SERVER_FIELDS: Record<string, keyof ProjectInput> = { start_date: 'startDate', due_date: 'dueDate' }

function defaults(project?: Project | null): ProjectInput {
  return {
    name: project?.name ?? '',
    key: project?.key ?? '',
    description: project?.description ?? '',
    icon: project?.icon ?? 'folder',
    cover: project?.cover ?? 'green',
    status: project?.status ?? 'planning',
    priority: project?.priority ?? 'medium',
    startDate: toDayInput(project?.startDate),
    dueDate: toDayInput(project?.dueDate),
  }
}

export interface ProjectFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ausente = criação. */
  project?: Project | null
}

export function ProjectFormDialog({ open, onOpenChange, project }: ProjectFormDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const isEdit = !!project
  const create = useCreateProject()
  const update = useUpdateProject()
  const pending = create.isPending || update.isPending

  const { register, handleSubmit, reset, control, setValue, setError, formState } = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: defaults(project),
  })

  useEffect(() => {
    if (!open) return
    reset(defaults(project))
  }, [open, project, reset])

  const [name, key, icon, cover] = useWatch({ control, name: ['name', 'key', 'icon', 'cover'] })

  const onSubmit = handleSubmit((values) => {
    const data = {
      name: values.name.trim(),
      description: values.description,
      icon: values.icon,
      cover: values.cover,
      status: values.status,
      priority: values.priority,
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
