import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { cn } from '@/core/utils/cn'
import { isAppError } from '@/core/errors/app-error'
import { toDayInput } from '@/core/utils/format'
import { PROJECT_COVERS, PROJECT_ICONS, PROJECT_PRIORITIES, PROJECT_STATUSES, canHaveParent, parentCandidates, suggestKey, type Project, type ProjectCover } from '@/domain/projects'
import type { ProjectListQuery } from '@/domain/repositories'
import { projectSchema, type ProjectInput } from '@/domain/validation'
import { NO_URGENCY } from '@/domain/urgency'
import { AppButton, AppDatePicker, AppDialog, AppFormField, AppSelect, AppTextField, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { PROJECT_ICON_COMPONENTS, coverStyle } from './project-theme'
import { ProjectAvatar } from './project-visuals'
import { CustomColorSwatch } from '@/features/task-config/config-visuals'
import { isHexColor } from '@/domain/colors'
import { IconPicker } from '@/features/icons/IconPicker'
import { useCreateProject, useProjectCovers, useProjects, useUpdateProject } from './queries'
import { useUrgencyFilterOptions } from '@/features/tasks/urgency-options'
import { useAreas } from '@/features/workflow/queries'
import { AreaBadge } from '@/features/workflow/area-visuals'

const SERVER_FIELDS: Record<string, keyof ProjectInput> = { start_date: 'startDate', due_date: 'dueDate', area_id: 'areaId', parent_id: 'parentId', platform_url: 'platformUrl' }

const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Valor do select para "sem área" / "sem pai" (o select não aceita texto vazio). */
const NO_AREA = '__none__'

/** Projetos que podem ser pai (sem pai, ativos): até 100, pelo nome (a regra final é do servidor, §34). */
const PARENT_QUERY: ProjectListQuery = { view: 'all', page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' }, search: '', filters: { parent: 'none' } }

function defaults(project?: Project | null, parentId?: string): ProjectInput {
  return {
    name: project?.name ?? '',
    key: project?.key ?? '',
    description: project?.description ?? '',
    platformUrl: project?.platformUrl ?? '',
    icon: project?.icon ?? 'folder',
    cover: project?.cover ?? 'violet',
    status: project?.status ?? 'planning',
    priority: project?.priority ?? 'medium',
    urgency: project?.urgency ?? NO_URGENCY,
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
  /** Criação de subprojeto ("Novo subprojeto"): o pai já vem escolhido. */
  parentId?: string
}

export function ProjectFormDialog({ open, onOpenChange, project, parentId }: ProjectFormDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const urgencyOptions = useUrgencyFilterOptions()
  const areas = useAreas(false)
  const errorMessage = useErrorMessage()
  const isEdit = !!project
  const create = useCreateProject()
  const update = useUpdateProject()
  const pending = create.isPending || update.isPending
  const parents = useProjects(PARENT_QUERY, open)
  const parentOptions = parentCandidates(parents.data?.items ?? [], project)
  const lockedParent = !canHaveParent(project)
  // cor única (§24): as dos outros projetos ficam travadas e o projeto novo já nasce com uma livre
  const covers = useProjectCovers(project?.id, open)
  const usedCovers = covers.data?.used ?? []

  const { register, handleSubmit, reset, control, setValue, setError, formState } = useForm<ProjectInput>({
    resolver: zodResolver(projectSchema),
    defaultValues: defaults(project, parentId),
  })

  useEffect(() => {
    if (!open) return
    reset(defaults(project, parentId))
  }, [open, project, parentId, reset])

  const [name, key, icon, cover, parentValue] = useWatch({ control, name: ['name', 'key', 'icon', 'cover', 'parentId'] })
  // subprojeto: usa a cor e o ícone do pai (o servidor aplica a mesma regra)
  const parent = parentValue ? (parentOptions.find((p) => p.id === parentValue) ?? (project?.parent?.id === parentValue ? project.parent : null)) : null
  const shownIcon = parent ? parent.icon : icon
  const shownCover = parent ? parent.cover : cover
  const coverTaken = (value: string) => usedCovers.some((used) => sameColor(used, value)) && !(project && !project.parent && sameColor(project.cover, value))

  const suggested = covers.data?.suggested
  const coverDirty = !!formState.dirtyFields.cover
  useEffect(() => {
    if (!open || isEdit || !suggested || coverDirty) return
    setValue('cover', suggested as ProjectCover)
  }, [open, isEdit, suggested, coverDirty, setValue])

  const onSubmit = handleSubmit((values) => {
    const data = {
      name: values.name.trim(),
      description: values.description,
      platformUrl: values.platformUrl.trim(),
      icon: values.icon,
      cover: values.cover,
      status: values.status,
      priority: values.priority,
      urgency: values.urgency === NO_URGENCY ? null : values.urgency,
      // só quando mudou: a área inativa que o projeto já tem continua valendo
      areaId: values.areaId !== (project?.area?.id ?? '') ? values.areaId || null : undefined,
      // só quando mudou (null solta): o pai que ficou arquivado depois continua valendo
      parentId: values.parentId !== (project?.parent?.id ?? '') ? values.parentId || null : undefined,
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
      size="2xl"
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
          <AppTextField
            label={t('projects.fields.platformUrl')}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            hint={t('projects.platformUrlHint')}
            error={errors.platformUrl?.message}
            {...register('platformUrl')}
          />
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

          <div className="grid gap-4 sm:grid-cols-3">
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
              render={({ field }) => <AppSelect label={t('tasks.fields.urgency')} value={field.value} onValueChange={field.onChange} options={urgencyOptions} />}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
                    // a área inativa que o projeto já tem continua na lista
                    ...[...(areas.data ?? []), ...(project?.area && !(areas.data ?? []).some((a) => a.id === project.area?.id) ? [project.area] : [])].map((a) => ({
                      value: a.id,
                      label: <AreaBadge area={a} />,
                    })),
                  ]}
                />
              )}
            />
            <Controller
              control={control}
              name="parentId"
              render={({ field }) => {
                const current = project?.parent ?? null
                const options = [{ value: NO_AREA, label: t('projects.parent.none') }, ...parentOptions.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))]
                // o pai atual (arquivado ou fora da lista) continua aparecendo
                if (current && !options.some((o) => o.value === current.id)) options.push({ value: current.id, label: `${current.key} · ${current.name}` })
                if (field.value && !options.some((o) => o.value === field.value)) options.push({ value: field.value, label: field.value })
                return (
                  <AppSelect
                    label={t('projects.parent.field')}
                    searchable
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
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
            <ProjectAvatar icon={shownIcon} cover={shownCover} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">{name || t('projects.namePlaceholder')}</p>
              <p className="font-mono text-xs text-muted">{key ? key.toUpperCase() : '—'}</p>
            </div>
          </div>

          {parent && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted" data-testid="project-inherits-parent">
              {t('projects.inheritsParent', { name: parent.name })}
            </p>
          )}

          {!parent && (
            <Controller
              control={control}
              name="icon"
              render={({ field }) => (
                <IconPicker
                  label={t('projects.fields.icon')}
                  value={field.value}
                  onChange={field.onChange}
                  builtins={PROJECT_ICONS}
                  components={PROJECT_ICON_COMPONENTS}
                  fallback={PROJECT_ICON_COMPONENTS.folder}
                  builtinLabel={(icon) => t(`projects.icons.${icon}`)}
                />
              )}
            />
          )}

          {!parent && (
          <Controller
            control={control}
            name="cover"
            render={({ field }) => (
              <AppFormField
                label={t('projects.fields.cover')}
                hint={t('projects.coverUniqueHint')}
                error={errors.cover?.message ?? (isHexColor(field.value) && coverTaken(field.value) ? 'color_in_use' : undefined)}
              >
                {({ id }) => (
                  <div id={id} role="radiogroup" aria-label={t('projects.fields.cover')} className="flex flex-wrap items-center gap-2">
                    {PROJECT_COVERS.map((key) => {
                      const selected = field.value === key
                      const taken = !selected && coverTaken(key)
                      const label = taken ? t('projects.coverTaken', { color: t(`projects.covers.${key}`) }) : t(`projects.covers.${key}`)
                      return (
                        <button
                          key={key}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={label}
                          title={label}
                          disabled={taken}
                          onClick={() => field.onChange(key)}
                          style={coverStyle(key)}
                          className={cn(
                            'flex size-8 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-surface transition-transform',
                            taken ? 'cursor-not-allowed opacity-25' : 'hover:scale-110',
                            selected && 'ring-2 ring-primary',
                          )}
                        >
                          {selected && <Check className="size-4" />}
                        </button>
                      )
                    })}
                    <CustomColorSwatch value={isHexColor(field.value) ? field.value : null} onChange={field.onChange} swatchStyle={coverStyle} className="size-8" />
                  </div>
                )}
              </AppFormField>
            )}
          />
          )}
        </div>
      </form>
    </AppDialog>
  )
}
