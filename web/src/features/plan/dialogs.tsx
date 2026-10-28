import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import { DEPENDENCY_RULES, PLAN_LIMITS, PLAN_STATUS_CATEGORIES, type DependencyRule, type Plan, type PlanGroup, type PlanItem, type PlanResource, type PlanStatus, type PlanStatusCategory } from '@/domain/plan'
import { groupTitle } from '@/domain/plan-view'
import type { OptionColor } from '@/domain/task-config'
import { AppButton, AppConfirmDialog, AppDialog, AppIconButton, AppSelect, AppTextField, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { ColorButton, ColorPicker } from '@/features/task-config/config-visuals'
import type { PlanMutations } from './queries'
import { ResourceChip, StatusBlock } from './cells'

/* ------------------------------------------------------------------ grupo */

export type GroupDialogState = { mode: 'create'; parent: PlanGroup | null } | { mode: 'edit'; group: PlanGroup } | null

export function GroupDialog({ state, mutations, onClose }: { state: GroupDialogState; mutations: PlanMutations; onClose: () => void }) {
  if (!state) return null
  return <GroupForm key={state.mode === 'edit' ? state.group.id : `new:${state.parent?.id ?? ''}`} state={state} mutations={mutations} onClose={onClose} />
}

function GroupForm({ state, mutations, onClose }: { state: Exclude<GroupDialogState, null>; mutations: PlanMutations; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const editing = state.mode === 'edit' ? state.group : null
  const parent = state.mode === 'create' ? state.parent : null
  const [name, setName] = useState(editing?.name ?? '')
  const [color, setColor] = useState<OptionColor>(editing?.color ?? parent?.color ?? 'blue')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pending = mutations.createGroup.isPending || mutations.updateGroup.isPending

  function submit() {
    if (!name.trim()) return setErrors({ name: 'required' })
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') return setErrors(error.fieldErrors())
      notify.error(errorMessage(error))
    }
    if (editing)
      mutations.updateGroup.mutate(
        { id: editing.id, input: { name: name.trim(), color } },
        {
          onSuccess: () => {
            notify.success(t('plan.group.updated'))
            onClose()
          },
          onError,
        },
      )
    else
      mutations.createGroup.mutate(
        { name: name.trim(), color, parentId: parent?.id ?? null },
        {
          onSuccess: (group) => {
            notify.success(t('plan.group.created', { name: group.name }))
            onClose()
          },
          onError,
        },
      )
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      size="md"
      closeOnOutsideClick={false}
      title={editing ? t('plan.group.editTitle') : parent ? t('plan.group.createSubTitle', { name: groupTitle(parent) }) : t('plan.group.createTitle')}
      description={t('plan.group.hint')}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {editing ? t('common.save') : t('plan.group.create')}
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
        <AppTextField
          label={t('plan.group.name')}
          required
          maxLength={PLAN_LIMITS.groupName}
          autoComplete="off"
          placeholder={t('plan.group.namePlaceholder')}
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <ColorPicker label={t('plan.group.color')} value={color} onChange={setColor} />
      </form>
    </AppDialog>
  )
}

/* ------------------------------------------------------------------ etiquetas (status e recursos) */

function NameInput({ value, label, maxLength, onSave }: { value: string; label: string; maxLength: number; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [synced, setSynced] = useState(value)
  if (synced !== value) {
    setSynced(value)
    setDraft(value)
  }
  const commit = () => {
    const name = draft.trim()
    if (!name) return setDraft(value)
    if (name !== value) onSave(name)
  }
  return (
    <input
      value={draft}
      aria-label={label}
      maxLength={maxLength}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      }}
      className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
    />
  )
}

function AddLabel({ placeholder, maxLength, onAdd, pending }: { placeholder: string; maxLength: number; onAdd: (name: string) => Promise<unknown>; pending: boolean }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const add = () => {
    if (!name.trim() || pending) return
    void onAdd(name.trim()).then(() => setName(''), () => undefined)
  }
  return (
    <div className="flex items-center gap-2 border-t border-border pt-3">
      <input
        value={name}
        aria-label={placeholder}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            add()
          }
        }}
        className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
      />
      <AppButton variant="secondary" leftIcon={<Plus />} onClick={add} loading={pending} disabled={!name.trim()}>
        {t('plan.labels.add')}
      </AppButton>
    </div>
  )
}

export function StatusLabelsDialog({ open, plan, mutations, onClose }: { open: boolean; plan: Plan; mutations: PlanMutations; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const [removing, setRemoving] = useState<PlanStatus | null>(null)
  const onError = (error: unknown) => notify.error(errorMessage(error))
  const used = (id: string) => plan.items.filter((i) => i.statusId === id).length
  const update = (status: PlanStatus, input: { name?: string; color?: OptionColor; category?: PlanStatusCategory }) =>
    mutations.updateStatus.mutate({ id: status.id, input }, { onError })

  return (
    <>
      <AppDialog open={open} onOpenChange={(next) => !next && onClose()} size="lg" title={t('plan.labels.statusTitle')} description={t('plan.labels.statusHint')}>
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {plan.statuses.map((status) => (
              <li key={status.id} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <ColorButton color={status.color} label={t('plan.labels.colorOf', { name: status.name })} onChange={(color) => update(status, { color })} />
                <NameInput value={status.name} label={t('plan.labels.nameOf', { name: status.name })} maxLength={PLAN_LIMITS.statusName} onSave={(name) => update(status, { name })} />
                <AppSelect
                  aria-label={t('plan.labels.categoryOf', { name: status.name })}
                  className="w-full sm:w-48"
                  value={status.category}
                  onValueChange={(value) => update(status, { category: value as PlanStatusCategory })}
                  options={PLAN_STATUS_CATEGORIES.map((c) => ({ value: c, label: t(`plan.categories.${c}`) }))}
                />
                <span className="hidden w-24 shrink-0 sm:block">
                  <StatusBlock status={status} className="min-h-7 rounded-md text-xs" />
                </span>
                <AppIconButton variant="danger" size="sm" icon={<Trash2 />} label={t('plan.labels.deleteOf', { name: status.name })} onClick={() => setRemoving(status)} />
              </li>
            ))}
          </ul>
          <AddLabel
            placeholder={t('plan.labels.newStatus')}
            maxLength={PLAN_LIMITS.statusName}
            pending={mutations.createStatus.isPending}
            onAdd={(name) => mutations.createStatus.mutateAsync({ name, color: 'gray', category: 'todo' }).catch((error: unknown) => {
              onError(error)
              throw error
            })}
          />
          <p className="text-xs text-muted">{t('plan.labels.categoryHint')}</p>
        </div>
      </AppDialog>
      <AppConfirmDialog
        open={!!removing}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={t('plan.labels.deleteTitle', { name: removing?.name ?? '' })}
        description={removing ? t('plan.labels.deleteStatusDescription', { count: used(removing.id) }) : undefined}
        confirmLabel={t('common.delete')}
        loading={mutations.deleteStatus.isPending}
        onConfirm={() =>
          removing &&
          mutations.deleteStatus.mutate(removing.id, {
            onSuccess: () => {
              notify.success(t('plan.labels.deleted', { name: removing.name }))
              setRemoving(null)
            },
            onError,
          })
        }
      />
    </>
  )
}

export function ResourceLabelsDialog({ open, plan, mutations, onClose }: { open: boolean; plan: Plan; mutations: PlanMutations; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const [removing, setRemoving] = useState<PlanResource | null>(null)
  const onError = (error: unknown) => notify.error(errorMessage(error))
  const used = (id: string) => plan.items.filter((i) => i.resourceIds.includes(id)).length
  const canEdit = plan.capabilities.edit
  const canDelete = plan.capabilities.manage

  return (
    <>
      <AppDialog open={open} onOpenChange={(next) => !next && onClose()} size="lg" title={t('plan.labels.resourceTitle')} description={t('plan.labels.resourceHint')}>
        <div className="flex flex-col gap-3">
          {plan.resources.length === 0 && <p className="text-sm text-muted">{t('plan.labels.noResources')}</p>}
          <ul className="flex flex-col gap-2">
            {plan.resources.map((resource) => (
              <li key={resource.id} className="flex items-center gap-2">
                {canEdit ? (
                  <>
                    <ColorButton
                      color={resource.color}
                      label={t('plan.labels.colorOf', { name: resource.name })}
                      onChange={(color) => mutations.updateResource.mutate({ id: resource.id, input: { color } }, { onError })}
                    />
                    <NameInput
                      value={resource.name}
                      label={t('plan.labels.nameOf', { name: resource.name })}
                      maxLength={PLAN_LIMITS.resourceName}
                      onSave={(name) => mutations.updateResource.mutate({ id: resource.id, input: { name } }, { onError })}
                    />
                  </>
                ) : (
                  <span className="flex-1">
                    <ResourceChip resource={resource} />
                  </span>
                )}
                <span className="w-24 shrink-0 text-right text-xs text-muted">{t('plan.labels.usedIn', { count: used(resource.id) })}</span>
                {canDelete && <AppIconButton variant="danger" size="sm" icon={<Trash2 />} label={t('plan.labels.deleteOf', { name: resource.name })} onClick={() => setRemoving(resource)} />}
              </li>
            ))}
          </ul>
          {canEdit && (
            <AddLabel
              placeholder={t('plan.labels.newResource')}
              maxLength={PLAN_LIMITS.resourceName}
              pending={mutations.createResource.isPending}
              onAdd={(name) => mutations.createResource.mutateAsync({ name }).catch((error: unknown) => {
                onError(error)
                throw error
              })}
            />
          )}
        </div>
      </AppDialog>
      <AppConfirmDialog
        open={!!removing}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={t('plan.labels.deleteTitle', { name: removing?.name ?? '' })}
        description={removing ? t('plan.labels.deleteResourceDescription', { count: used(removing.id) }) : undefined}
        confirmLabel={t('common.delete')}
        loading={mutations.deleteResource.isPending}
        onConfirm={() =>
          removing &&
          mutations.deleteResource.mutate(removing.id, {
            onSuccess: () => {
              notify.success(t('plan.labels.deleted', { name: removing.name }))
              setRemoving(null)
            },
            onError,
          })
        }
      />
    </>
  )
}

/* ------------------------------------------------------------------ mover elemento */

export function MoveItemDialog({ item, plan, mutations, onClose }: { item: PlanItem | null; plan: Plan; mutations: PlanMutations; onClose: () => void }) {
  if (!item) return null
  return <MoveItemForm key={item.id} item={item} plan={plan} mutations={mutations} onClose={onClose} />
}

function MoveItemForm({ item, plan, mutations, onClose }: { item: PlanItem; plan: Plan; mutations: PlanMutations; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const [groupId, setGroupId] = useState(item.groupId)
  const pending = mutations.updateItem.isPending
  const byId = new Map(plan.groups.map((g) => [g.id, g]))
  const options = plan.groups.map((g) => {
    const parent = g.parentId ? byId.get(g.parentId) : null
    return { value: g.id, label: parent ? `${groupTitle(parent)} | ${groupTitle(g)}` : groupTitle(g) }
  })
  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      size="md"
      title={t('plan.moveTitle', { name: item.name })}
      description={t('plan.moveHint')}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton
            disabled={groupId === item.groupId}
            loading={pending}
            onClick={() =>
              mutations.updateItem.mutate(
                { id: item.id, input: { groupId } },
                {
                  onSuccess: () => {
                    notify.success(t('plan.moved', { name: item.name }))
                    onClose()
                  },
                  onError: (error) => notify.error(errorMessage(error)),
                },
              )
            }
          >
            {t('plan.move')}
          </AppButton>
        </>
      }
    >
      <AppSelect label={t('plan.groupLabel')} value={groupId} onValueChange={setGroupId} options={options} />
    </AppDialog>
  )
}


/* ------------------------------------------------------------------ regra de dependência (gestor) */

export function DependencyRuleDialog({ open, plan, mutations, onClose }: { open: boolean; plan: Plan; mutations: PlanMutations; onClose: () => void }) {
  if (!open) return null
  return <DependencyRuleForm key={plan.settings.dependencyRule} plan={plan} mutations={mutations} onClose={onClose} />
}

function DependencyRuleForm({ plan, mutations, onClose }: { plan: Plan; mutations: PlanMutations; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const [rule, setRule] = useState<DependencyRule>(plan.settings.dependencyRule)
  const pending = mutations.updateSettings.isPending
  return (
    <AppDialog
      open
      onOpenChange={(next) => !next && !pending && onClose()}
      size="md"
      title={t('plan.dependencyRule.title')}
      description={t('plan.dependencyRule.description')}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton
            loading={pending}
            onClick={() =>
              mutations.updateSettings.mutate(rule, {
                onSuccess: () => {
                  notify.success(t('plan.dependencyRule.saved'))
                  onClose()
                },
                onError: (error) => notify.error(errorMessage(error)),
              })
            }
          >
            {t('common.save')}
          </AppButton>
        </>
      }
    >
      <div role="radiogroup" aria-label={t('plan.dependencyRule.title')} className="flex flex-col gap-2">
        {DEPENDENCY_RULES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rule === value}
            onClick={() => setRule(value)}
            className={cn('flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring', rule === value ? 'border-primary bg-primary-soft' : 'border-border')}
          >
            <span className="text-sm font-medium">{t(`plan.dependencyRule.${value}`)}</span>
            <span className="text-xs text-muted">{t(`plan.dependencyRule.${value}Hint`)}</span>
          </button>
        ))}
      </div>
    </AppDialog>
  )
}
