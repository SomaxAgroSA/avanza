import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { isAppError } from '@/core/errors/app-error'
import { SPACE_ICONS, SPACE_VISIBILITIES, type DocSpace } from '@/domain/docs'
import { suggestKey } from '@/domain/projects'
import { docSpaceSchema, type DocSpaceFormInput } from '@/domain/validation'
import { AppButton, AppDialog, AppSelect, AppTextField, AppTextarea, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { ColorPicker } from '@/features/task-config/config-visuals'
import { useProjects } from '@/features/projects/queries'
import { SPACE_ICON_COMPONENTS } from './docs-theme'
import { IconPicker } from '@/features/icons/IconPicker'
import { SpaceAvatar } from './docs-visuals'
import { useSpaceMutations } from './queries'

const PROJECT_QUERY = { view: 'all' as const, page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' as const }, search: '', filters: {} }
const SERVER_FIELDS: Record<string, keyof DocSpaceFormInput> = { project_id: 'projectId' }

function defaults(space?: DocSpace | null): DocSpaceFormInput {
  return {
    name: space?.name ?? '',
    key: space?.key ?? '',
    description: space?.description ?? '',
    icon: space?.icon ?? 'book',
    color: space?.color ?? 'blue',
    visibility: space?.visibility ?? 'company',
    projectId: space?.project?.id ?? '',
  }
}

export interface SpaceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ausente = criação. */
  space?: DocSpace | null
}

/** Criação/configuração de espaço. A chave e o projeto só se escolhem na criação. */
export function SpaceFormDialog({ open, onOpenChange, space }: SpaceFormDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const isEdit = !!space
  const { create, update } = useSpaceMutations()
  const pending = create.isPending || update.isPending
  const projects = useProjects(PROJECT_QUERY, open && !isEdit)

  const { register, handleSubmit, reset, control, setValue, setError, formState } = useForm<DocSpaceFormInput>({
    resolver: zodResolver(docSpaceSchema),
    defaultValues: defaults(space),
  })

  useEffect(() => {
    if (open) reset(defaults(space))
  }, [open, space, reset])

  const [name, icon, color, visibility, projectId] = useWatch({ control, name: ['name', 'icon', 'color', 'visibility', 'projectId'] })

  const onSubmit = handleSubmit((values) => {
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'DOC_SPACE_KEY_IN_USE') return setError('key', { message: 'key_in_use' })
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
        return Object.entries(error.fieldErrors()).forEach(([field, code]) => setError(SERVER_FIELDS[field] ?? (field as keyof DocSpaceFormInput), { message: code }))
      }
      notify.error(errorMessage(error))
    }
    const common = { name: values.name.trim(), description: values.description, icon: values.icon, color: values.color, visibility: values.visibility }
    if (space) {
      update.mutate(
        { id: space.id, input: common },
        {
          onSuccess: () => {
            notify.success(t('docs.space.updated'))
            onOpenChange(false)
          },
          onError,
        },
      )
      return
    }
    create.mutate(
      { ...common, key: values.key.trim().toUpperCase(), ...(values.projectId ? { projectId: values.projectId } : {}) },
      {
        onSuccess: (created) => {
          notify.success(t('docs.space.created', { name: created.name }))
          onOpenChange(false)
          void navigate(`/docs/${encodeURIComponent(created.key)}`)
        },
        onError,
      },
    )
  })

  // A chave acompanha o nome até ser editada à mão.
  const keyTouched = isEdit || !!formState.dirtyFields.key
  const nameField = register('name', {
    onChange: (event: { target: { value: string } }) => {
      if (!keyTouched) setValue('key', suggestKey(event.target.value), { shouldValidate: formState.isSubmitted })
    },
  })
  const errors = formState.errors
  // espaço de projeto: só entre os projetos ativos em que a pessoa pode gerenciar (o servidor confere)
  const projectOptions = (projects.data?.items ?? []).filter((p) => !p.archivedAt).map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))
  const visibilityOptions = SPACE_VISIBILITIES.filter((v) => v === 'company' || isEdit === false || !!space?.project).map((v) => ({
    value: v,
    label: t(`docs.visibility.${v}`),
  }))

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      closeOnOutsideClick={false}
      title={isEdit ? t('docs.space.editTitle') : t('docs.space.createTitle')}
      description={isEdit ? `${space?.key} · ${space?.name}` : t('docs.space.createDescription')}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" form="doc-space-form" loading={pending}>
            {isEdit ? t('common.save') : t('docs.space.create')}
          </AppButton>
        </>
      }
    >
      <form id="doc-space-form" onSubmit={onSubmit} noValidate className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <AppTextField label={t('docs.space.fields.name')} required autoComplete="off" maxLength={80} error={errors.name?.message} {...nameField} />
            <AppTextField
              label={t('docs.space.fields.key')}
              required
              autoComplete="off"
              disabled={isEdit}
              maxLength={10}
              className="font-mono uppercase"
              hint={isEdit ? t('docs.space.keyLocked') : t('docs.space.keyHint')}
              error={errors.key?.message}
              {...register('key')}
            />
          </div>
          <AppTextarea label={t('docs.space.fields.description')} rows={3} maxLength={500} error={errors.description?.message} {...register('description')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="visibility"
              render={({ field }) => (
                <AppSelect
                  label={t('docs.space.fields.visibility')}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={visibilityOptions}
                  hint={t(`docs.visibility.${visibility}Hint`)}
                />
              )}
            />
            {isEdit ? (
              space?.project && <AppTextField label={t('docs.space.fields.project')} value={`${space.project.key} · ${space.project.name}`} disabled readOnly hint={t('docs.space.projectLocked')} />
            ) : (
              <Controller
                control={control}
                name="projectId"
                render={({ field }) => (
                  <AppSelect
                    label={t('docs.space.fields.project')}
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                    options={projectOptions}
                    placeholder={t('docs.space.noProject')}
                    required={visibility === 'project'}
                    hint={t('docs.space.projectHint')}
                    error={errors.projectId?.message}
                  />
                )}
              />
            )}
          </div>
          {!isEdit && projectId && (
            <AppButton variant="link" size="sm" className="self-start" onClick={() => setValue('projectId', '', { shouldDirty: true })}>
              {t('docs.space.clearProject')}
            </AppButton>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:border-l lg:border-border lg:pl-8">
          <div className="flex items-center gap-4 rounded-xl border border-border p-4">
            <SpaceAvatar icon={icon} color={color} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">{name.trim() || t('docs.space.namePlaceholder')}</p>
              <p className="text-sm text-muted">{t(`docs.visibility.${visibility}`)}</p>
            </div>
          </div>
          <Controller
            control={control}
            name="icon"
            render={({ field }) => (
              <IconPicker
                label={t('docs.space.fields.icon')}
                value={field.value}
                onChange={field.onChange}
                builtins={SPACE_ICONS}
                components={SPACE_ICON_COMPONENTS}
                fallback={SPACE_ICON_COMPONENTS.book}
                builtinLabel={(icon) => t(`docs.icons.${icon}`)}
              />
            )}
          />
          <Controller control={control} name="color" render={({ field }) => <ColorPicker label={t('docs.space.fields.color')} value={field.value} onChange={field.onChange} />} />
        </div>
      </form>
    </AppDialog>
  )
}
