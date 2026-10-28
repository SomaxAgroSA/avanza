import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronRight, MoreHorizontal, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { TASK_TYPE_ICONS, TRANSLATED_LOCALES, normalizeTypeKey, type OptionColor, type TaskType, type TaskTypeIcon, type TranslatedLocale, type TypeTexts } from '@/domain/task-config'
import {
  AppBadge,
  AppButton,
  AppConfirmDialog,
  AppDialog,
  AppDragHandle,
  AppDropdown,
  AppErrorState,
  AppIcon,
  AppSkeleton,
  AppSortableList,
  AppTextField,
  notify,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { TASK_TYPE_ICON_COMPONENTS, optionColor, optionTint } from './config-theme'
import { ColorPicker, TaskTypeIconBadge } from './config-visuals'
import { IconPicker } from '@/features/icons/IconPicker'
import { useTaskTypeMutations, useTaskTypes } from './queries'

export function TaskTypesPage() {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const types = useTaskTypes(true)
  const mutations = useTaskTypeMutations()
  const [order, setOrder] = useState<TaskType[] | null>(null)
  const [editing, setEditing] = useState<TaskType | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<TaskType | null>(null)

  const list = order ?? types.data ?? []

  function reorder(next: TaskType[]) {
    setOrder(next)
    mutations.reorder.mutate(
      next.map((type) => type.id),
      {
        onSuccess: () => notify.success(t('taskTypes.reordered')),
        onError: (error) => notify.error(errorMessage(error)),
        onSettled: () => setOrder(null),
      },
    )
  }

  function toggleActive(type: TaskType) {
    mutations.update.mutate(
      { id: type.id, data: { isActive: !type.isActive } },
      {
        onSuccess: () => notify.success(type.isActive ? t('taskTypes.deactivated', { name: type.name }) : t('taskTypes.activated', { name: type.name })),
        onError: (error) => notify.error(errorMessage(error)),
      },
    )
  }

  return (
    <>
      <PageHeader
        title={t('taskTypes.title')}
        description={t('taskTypes.description')}
        actions={
          <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
            {t('taskTypes.create')}
          </AppButton>
        }
      />

      {types.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <AppSkeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : types.isError ? (
        <AppErrorState onRetry={() => void types.refetch()} />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{t('taskTypes.reorderHint')}</p>
          <AppSortableList
            items={list}
            getId={(type) => type.id}
            getLabel={(type) => type.name}
            onReorder={reorder}
            disabled={mutations.reorder.isPending}
            renderItem={(type, { handle, isDragging }) => (
              <div
                className={cn(
                  'flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-card transition-colors',
                  !type.isActive && 'opacity-60',
                  isDragging && 'border-primary',
                )}
              >
                <AppDragHandle handle={handle} />
                <TaskTypeIconBadge icon={type.icon} color={type.color} />
                <Link to={`/settings/task-types/${type.id}`} className="group min-w-0 flex-1 rounded-md focus-visible:outline-2 focus-visible:outline-ring">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg group-hover:text-primary-text">{type.name}</span>
                    <span className="font-mono text-xs text-subtle">{type.key}</span>
                    {!type.isActive && <AppBadge>{t('taskTypes.inactive')}</AppBadge>}
                  </span>
                  <span className="block truncate text-xs text-muted">{type.description || t('taskTypes.noDescription')}</span>
                </Link>
                <AppBadge tone={type.fieldCount > 0 ? 'primary' : 'neutral'} className="hidden sm:inline-flex">
                  {t('taskTypes.fieldCount', { count: type.fieldCount })}
                </AppBadge>
                <AppDropdown
                  items={[
                    { key: 'edit', label: t('common.edit'), icon: <Pencil />, onSelect: () => setEditing(type) },
                    { key: 'active', label: type.isActive ? t('taskTypes.deactivate') : t('taskTypes.activate'), icon: <Power />, onSelect: () => toggleActive(type) },
                    { type: 'separator', key: 's' },
                    { key: 'delete', label: t('common.delete'), icon: <Trash2 />, tone: 'danger', onSelect: () => setDeleting(type) },
                  ]}
                  trigger={
                    <button
                      type="button"
                      aria-label={t('common.more')}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  }
                />
                <Link
                  to={`/settings/task-types/${type.id}`}
                  aria-label={t('taskTypes.configureFieldsOf', { name: type.name })}
                  className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                >
                  <ChevronRight className="size-4" />
                </Link>
              </div>
            )}
          />
        </>
      )}

      <TaskTypeFormDialog
        open={creating || !!editing}
        type={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
      />
      <AppConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('taskTypes.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('taskTypes.deleteDescription')}
        confirmLabel={t('common.delete')}
        loading={mutations.remove.isPending}
        onConfirm={() =>
          deleting &&
          mutations.remove.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t('taskTypes.deleted', { name: deleting.name }))
              setDeleting(null)
            },
            onError: (error) => notify.error(errorMessage(error)),
          })
        }
      />
    </>
  )
}

interface TypeDraft {
  key: string
  /** Original (pt-BR). */
  name: string
  description: string
  icon: TaskTypeIcon
  color: OptionColor
  translations: Record<TranslatedLocale, TypeTexts>
}

const NO_TRANSLATIONS: Record<TranslatedLocale, TypeTexts> = { en: { name: '', description: '' }, es: { name: '', description: '' } }

/** Criação e edição de tipo (nome, chave, descrição, ícone e cor). */
export function TaskTypeFormDialog({ open, type, onOpenChange }: { open: boolean; type: TaskType | null; onOpenChange: (open: boolean) => void }) {
  const { t, i18n } = useTranslation()
  const errorMessage = useErrorMessage()
  const { create, update } = useTaskTypeMutations()
  const isEdit = !!type
  const blank: TypeDraft = { key: '', name: '', description: '', icon: 'check-square', color: 'blue', translations: NO_TRANSLATIONS }
  const [draft, setDraft] = useState<TypeDraft>(blank)
  const [keyTouched, setKeyTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  // Reinicia o rascunho ao abrir (ajuste durante a renderização, sem efeito).
  const signature = open ? (type?.id ?? 'new') : null
  if (signature !== openedFor) {
    setOpenedFor(signature)
    if (signature) {
      // edita sempre o original (pt-BR), mesmo com a tela em outro idioma
      setDraft(
        type
          ? {
              key: type.key,
              name: type.translations['pt-BR'].name || type.name,
              description: type.translations['pt-BR'].description,
              icon: type.icon,
              color: type.color,
              translations: { en: { ...type.translations.en }, es: { ...type.translations.es } },
            }
          : blank,
      )
      setKeyTouched(!!type)
      setErrors({})
    }
  }

  const pending = create.isPending || update.isPending

  function submit() {
    const found: Record<string, string> = {}
    if (!draft.name.trim()) found.name = 'required'
    if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(draft.key)) found.key = 'invalid_format'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const translations = Object.fromEntries(
      TRANSLATED_LOCALES.map((locale) => [locale, { name: draft.translations[locale].name.trim(), description: draft.translations[locale].description.trim() }]),
    ) as Record<TranslatedLocale, TypeTexts>
    const data = { name: draft.name.trim(), description: draft.description.trim(), icon: draft.icon, color: draft.color, translations }
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'TASK_TYPE_KEY_IN_USE') return setErrors({ key: 'key_in_use' })
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') return setErrors(error.fieldErrors())
      notify.error(errorMessage(error))
    }
    const onSuccess = () => {
      notify.success(isEdit ? t('taskTypes.updated', { name: data.name }) : t('taskTypes.created', { name: data.name }))
      onOpenChange(false)
    }
    if (type) update.mutate({ id: type.id, data }, { onSuccess, onError })
    else create.mutate({ ...data, key: draft.key }, { onSuccess, onError })
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isEdit ? t('taskTypes.editTitle') : t('taskTypes.createTitle')}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {t('common.save')}
          </AppButton>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="flex items-center gap-3 rounded-xl border border-border p-3">
          <span className="flex size-10 items-center justify-center rounded-lg" style={{ color: optionColor(draft.color), backgroundColor: optionTint(draft.color) }}>
            <AppIcon name={draft.icon} builtins={TASK_TYPE_ICON_COMPONENTS} fallback={TASK_TYPE_ICON_COMPONENTS['check-square']} className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{draft.name || t('taskTypes.namePlaceholder')}</p>
            <p className="font-mono text-xs text-muted">{draft.key || '—'}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <AppTextField
            label={t('taskTypes.fields.name')}
            required
            autoComplete="off"
            value={draft.name}
            error={errors.name}
            hint={i18n.language === 'pt-BR' ? undefined : t('taskTypes.originalHint')}
            onChange={(event) => {
              const name = event.target.value
              setDraft((d) => ({ ...d, name, key: keyTouched ? d.key : normalizeTypeKey(name) }))
            }}
          />
          <AppTextField
            label={t('taskTypes.fields.key')}
            required
            autoComplete="off"
            disabled={isEdit}
            className="font-mono uppercase"
            value={draft.key}
            error={errors.key}
            hint={isEdit ? t('taskTypes.keyLocked') : undefined}
            onChange={(event) => {
              setKeyTouched(true)
              setDraft((d) => ({ ...d, key: normalizeTypeKey(event.target.value) }))
            }}
          />
        </div>
        <AppTextField
          label={t('taskTypes.fields.description')}
          value={draft.description}
          maxLength={255}
          error={errors.description}
          onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
        />
        <section aria-labelledby="type-translations-title" className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <div>
            <h3 id="type-translations-title" className="text-sm font-semibold text-fg">
              {t('taskTypes.translationsTitle')}
            </h3>
            <p className="mt-0.5 text-xs text-muted">{t('taskTypes.translationsHint')}</p>
            {errors.translations && <p className="mt-1 text-xs font-medium text-danger">{t(`validation.${errors.translations}`, { defaultValue: t('validation.invalid_format') })}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {TRANSLATED_LOCALES.map((locale) => (
              <fieldset key={locale} className="flex min-w-0 flex-col gap-3">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t(`language.${locale}`)}</legend>
                <AppTextField
                  label={t('taskTypes.fields.name')}
                  autoComplete="off"
                  lang={locale}
                  maxLength={60}
                  placeholder={draft.name}
                  value={draft.translations[locale].name}
                  onChange={(event) => setDraft((d) => ({ ...d, translations: { ...d.translations, [locale]: { ...d.translations[locale], name: event.target.value } } }))}
                />
                <AppTextField
                  label={t('taskTypes.fields.description')}
                  lang={locale}
                  maxLength={255}
                  placeholder={draft.description}
                  value={draft.translations[locale].description}
                  onChange={(event) => setDraft((d) => ({ ...d, translations: { ...d.translations, [locale]: { ...d.translations[locale], description: event.target.value } } }))}
                />
              </fieldset>
            ))}
          </div>
        </section>
        <IconPicker
          label={t('taskTypes.fields.icon')}
          value={draft.icon}
          onChange={(icon) => setDraft((d) => ({ ...d, icon }))}
          builtins={TASK_TYPE_ICONS}
          components={TASK_TYPE_ICON_COMPONENTS}
          fallback={TASK_TYPE_ICON_COMPONENTS['check-square']}
          builtinLabel={(icon) => t(`taskTypes.icons.${icon}`)}
        />
        <ColorPicker label={t('taskTypes.fields.color')} value={draft.color} onChange={(color) => setDraft((d) => ({ ...d, color }))} />
      </form>
    </AppDialog>
  )
}
