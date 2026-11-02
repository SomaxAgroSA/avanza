import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, Pencil, Plus, Power, Star, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { normalizeTypeKey, type OptionColor } from '@/domain/task-config'
import { STATUS_CATEGORIES, lookupHasDefault, type LookupItem, type LookupKind, type StatusCategory } from '@/domain/workflow'
import {
  AppBadge,
  AppButton,
  AppConfirmDialog,
  AppDialog,
  AppDragHandle,
  AppDropdown,
  AppErrorState,
  AppMultiSelect,
  AppSelect,
  AppSkeleton,
  AppSortableList,
  AppSwitch,
  AppTextField,
  notify,
} from '@/presentation/components'
import { PageHeader } from '@/presentation/layouts/PageHeader'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useDocumentTitle } from '@/presentation/common/use-document-title'
import { ColorPicker } from '@/features/task-config/config-visuals'
import { useLookupMutations, useLookups } from './queries'
import { CategoryLabel, LookupBadge } from './workflow-visuals'

export function StatusesPage() {
  return <LookupsPage kind="status" />
}

export function PrioritiesPage() {
  return <LookupsPage kind="priority" />
}

export function AreasPage() {
  return <LookupsPage kind="area" />
}

/** Configuração de status (`kind="status"`), prioridades (`kind="priority"`) ou áreas (`kind="area"`, sem padrão): mesmas regras e tela. */
export function LookupsPage({ kind }: { kind: LookupKind }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const items = useLookups(kind, true)
  const mutations = useLookupMutations(kind)
  const [order, setOrder] = useState<LookupItem[] | null>(null)
  const [editing, setEditing] = useState<LookupItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<LookupItem | null>(null)
  useDocumentTitle(t(`workflow.${kind}.title`))

  const list = order ?? items.data ?? []
  const onError = (error: unknown) => notify.error(errorMessage(error))

  function reorder(next: LookupItem[]) {
    setOrder(next)
    mutations.reorder.mutate(
      next.map((item) => item.id),
      { onSuccess: () => notify.success(t(`workflow.${kind}.reordered`)), onError, onSettled: () => setOrder(null) },
    )
  }

  function patch(item: LookupItem, data: { isActive?: boolean; isDefault?: boolean }, message: string) {
    mutations.update.mutate({ id: item.id, data }, { onSuccess: () => notify.success(message), onError })
  }

  return (
    <>
      <PageHeader
        title={t(`workflow.${kind}.title`)}
        description={t(`workflow.${kind}.description`)}
        actions={
          <AppButton leftIcon={<Plus />} onClick={() => setCreating(true)}>
            {t(`workflow.${kind}.create`)}
          </AppButton>
        }
      />

      {items.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <AppSkeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : items.isError ? (
        <AppErrorState onRetry={() => void items.refetch()} />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">{t(`workflow.${kind}.reorderHint`)}</p>
          <AppSortableList
            items={list}
            getId={(item) => item.id}
            getLabel={(item) => item.name}
            onReorder={reorder}
            disabled={mutations.reorder.isPending}
            renderItem={(item, { handle, isDragging }) => (
              <div
                className={cn(
                  'flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-card transition-colors',
                  !item.isActive && 'opacity-60',
                  isDragging && 'border-primary',
                )}
              >
                <AppDragHandle handle={handle} />
                <div className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <LookupBadge item={item} className="text-sm" />
                    <span className="font-mono text-xs text-subtle">{item.key}</span>
                    {item.isDefault && (
                      <AppBadge tone="primary">
                        <Star className="size-3" aria-hidden /> {t('workflow.default')}
                      </AppBadge>
                    )}
                    {!item.isActive && <AppBadge>{t('workflow.inactive')}</AppBadge>}
                  </span>
                  {item.description && <span className="mt-0.5 block truncate text-xs text-muted">{item.description}</span>}
                  {kind === 'status' && (!!item.wipLimit || !!item.allowedNext?.length) && (
                    <span className="mt-0.5 block truncate text-xs text-subtle">
                      {item.wipLimit ? t('workflow.wipBadge', { count: item.wipLimit }) : null}
                      {item.wipLimit && item.allowedNext?.length ? ' · ' : null}
                      {item.allowedNext?.length
                        ? t('workflow.goesTo', { names: item.allowedNext.map((id) => list.find((s) => s.id === id)?.name ?? '?').join(', ') })
                        : null}
                    </span>
                  )}
                </div>
                {item.category && <CategoryLabel category={item.category} className="hidden sm:inline-flex" />}
                <AppDropdown
                  items={[
                    { key: 'edit', label: t('common.edit'), icon: <Pencil />, onSelect: () => setEditing(item) },
                    ...(item.isDefault || !item.isActive || !lookupHasDefault(kind)
                      ? []
                      : [{ key: 'default', label: t('workflow.setDefault'), icon: <Star />, onSelect: () => patch(item, { isDefault: true }, t('workflow.madeDefault', { name: item.name })) }]),
                    ...(item.isDefault
                      ? []
                      : [
                          {
                            key: 'active',
                            label: item.isActive ? t('workflow.deactivate') : t('workflow.activate'),
                            icon: <Power />,
                            onSelect: () =>
                              patch(item, { isActive: !item.isActive }, t(item.isActive ? 'workflow.deactivated' : 'workflow.activated', { name: item.name })),
                          },
                          { type: 'separator' as const, key: 's' },
                          { key: 'delete', label: t('common.delete'), icon: <Trash2 />, tone: 'danger' as const, onSelect: () => setDeleting(item) },
                        ]),
                  ]}
                  trigger={
                    <button
                      type="button"
                      aria-label={t('workflow.actionsFor', { name: item.name })}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  }
                />
              </div>
            )}
          />
        </>
      )}

      <LookupFormDialog
        kind={kind}
        open={creating || !!editing}
        item={editing}
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
        title={t(`workflow.${kind}.deleteTitle`, { name: deleting?.name ?? '' })}
        description={t(`workflow.${kind}.deleteDescription`)}
        confirmLabel={t('common.delete')}
        loading={mutations.remove.isPending}
        onConfirm={() =>
          deleting &&
          mutations.remove.mutate(deleting.id, {
            onSuccess: () => {
              notify.success(t(`workflow.${kind}.deleted`, { name: deleting.name }))
              setDeleting(null)
            },
            onError,
          })
        }
      />
    </>
  )
}

interface Draft {
  key: string
  name: string
  description: string
  color: OptionColor
  category: StatusCategory
  isActive: boolean
  isDefault: boolean
  /** Só status (Kanban). */
  wipLimit: string
  allowedNext: string[]
}

function LookupFormDialog({ kind, open, item, onOpenChange }: { kind: LookupKind; open: boolean; item: LookupItem | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { create, update } = useLookupMutations(kind)
  const isEdit = !!item
  const blank: Draft = { key: '', name: '', description: '', color: 'gray', category: 'todo', isActive: true, isDefault: false, wipLimit: '', allowedNext: [] }
  const statuses = useLookups('status', true)
  const [draft, setDraft] = useState<Draft>(blank)
  const [keyTouched, setKeyTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  // Reinicia o rascunho ao abrir (ajuste durante a renderização, sem efeito).
  const signature = open ? (item?.id ?? 'new') : null
  if (signature !== openedFor) {
    setOpenedFor(signature)
    if (signature) {
      setDraft(
        item
          ? {
              key: item.key,
              name: item.name,
              description: item.description,
              color: item.color,
              category: item.category ?? 'todo',
              isActive: item.isActive,
              isDefault: item.isDefault,
              wipLimit: item.wipLimit ? String(item.wipLimit) : '',
              allowedNext: item.allowedNext ?? [],
            }
          : blank,
      )
      setKeyTouched(!!item)
      setErrors({})
    }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const pending = create.isPending || update.isPending
  // o padrão atual só deixa de ser padrão quando outro item é marcado
  const defaultLocked = !!item?.isDefault

  function submit() {
    const found: Record<string, string> = {}
    if (!draft.name.trim()) found.name = 'required'
    if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(draft.key)) found.key = 'invalid_format'
    if (draft.isDefault && !draft.isActive) found.is_active = 'default_must_be_active'
    const wip = draft.wipLimit.trim() === '' ? 0 : Number(draft.wipLimit)
    if (kind === 'status' && (!Number.isInteger(wip) || wip < 0 || wip > 999)) found.wip_limit = 'invalid_value'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const data = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      color: draft.color,
      isActive: draft.isActive,
      isDefault: draft.isDefault,
      ...(kind === 'status' ? { category: draft.category, wipLimit: wip, allowedNext: draft.allowedNext } : {}),
    }
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code.endsWith('_KEY_IN_USE')) return setErrors({ key: 'key_in_use' })
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') return setErrors(error.fieldErrors())
      notify.error(errorMessage(error))
    }
    const onSuccess = () => {
      notify.success(t(isEdit ? `workflow.${kind}.updated` : `workflow.${kind}.created`, { name: data.name }))
      onOpenChange(false)
    }
    if (item) update.mutate({ id: item.id, data }, { onSuccess, onError })
    else create.mutate({ ...data, key: draft.key }, { onSuccess, onError })
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(isEdit ? `workflow.${kind}.editTitle` : `workflow.${kind}.createTitle`)}
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
        <div className="flex min-h-12 items-center rounded-xl border border-border p-3">
          <LookupBadge item={{ name: draft.name || t('workflow.namePlaceholder'), color: draft.color, category: kind === 'status' ? draft.category : undefined }} className="text-sm" />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <AppTextField
            label={t('workflow.fields.name')}
            required
            autoComplete="off"
            maxLength={60}
            value={draft.name}
            error={errors.name}
            onChange={(event) => {
              const name = event.target.value
              setDraft((d) => ({ ...d, name, key: keyTouched ? d.key : normalizeTypeKey(name) }))
            }}
          />
          <AppTextField
            label={t('workflow.fields.key')}
            required
            autoComplete="off"
            disabled={isEdit}
            className="font-mono uppercase"
            value={draft.key}
            error={errors.key}
            hint={isEdit ? t('workflow.keyLocked') : undefined}
            onChange={(event) => {
              setKeyTouched(true)
              set('key', normalizeTypeKey(event.target.value))
            }}
          />
        </div>
        {kind === 'status' && (
          <AppSelect
            label={t('workflow.fields.category')}
            required
            value={draft.category}
            error={errors.category}
            hint={t(`workflow.categoryHints.${draft.category}`)}
            onValueChange={(value) => set('category', value as StatusCategory)}
            options={STATUS_CATEGORIES.map((category) => ({ value: category, label: <CategoryLabel category={category} className="text-sm text-fg" /> }))}
          />
        )}
        <AppTextField
          label={t('workflow.fields.description')}
          maxLength={255}
          value={draft.description}
          error={errors.description}
          onChange={(event) => set('description', event.target.value)}
        />
        <ColorPicker label={t('workflow.fields.color')} value={draft.color} onChange={(color) => set('color', color)} />
        {kind === 'status' && (
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <AppTextField
              label={t('workflow.fields.wipLimit')}
              inputMode="numeric"
              value={draft.wipLimit}
              error={errors.wip_limit}
              hint={t('workflow.wipHint')}
              onChange={(event) => set('wipLimit', event.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
            />
            <AppMultiSelect
              label={t('workflow.fields.allowedNext')}
              value={draft.allowedNext}
              error={errors.allowed_next}
              hint={t('workflow.allowedNextHint')}
              placeholder={t('workflow.anyStatus')}
              onValueChange={(ids) => set('allowedNext', ids)}
              options={(statuses.data ?? []).filter((s) => s.id !== item?.id).map((s) => ({ value: s.id, label: s.name }))}
            />
          </div>
        )}
        <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
          {lookupHasDefault(kind) && (
          <AppSwitch
            checked={draft.isDefault}
            disabled={defaultLocked}
            onCheckedChange={(isDefault) => setDraft((d) => ({ ...d, isDefault, isActive: isDefault ? true : d.isActive }))}
            label={t('workflow.fields.default')}
            description={defaultLocked ? t('workflow.defaultLockedHint') : t(`workflow.${kind}.defaultHint`)}
          />
          )}
          <AppSwitch
            checked={draft.isActive}
            disabled={draft.isDefault}
            onCheckedChange={(isActive) => set('isActive', isActive)}
            label={t('workflow.fields.active')}
            description={draft.isDefault ? t('workflow.activeLockedHint') : t('workflow.activeHint')}
          />
          {errors.is_active && <p className="text-xs font-medium text-danger">{t(`validation.${errors.is_active}`)}</p>}
          {errors.is_default && <p className="text-xs font-medium text-danger">{t(`validation.${errors.is_default}`)}</p>}
        </div>
      </form>
    </AppDialog>
  )
}
