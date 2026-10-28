import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CheckSquare, Hash, Link2, ListChecks, Plus, Trash2, Type, User } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { OPTION_COLORS, type OptionColor } from '@/domain/task-config'
import { COLUMN_LIMITS, COLUMN_TYPES, type ColumnOption, type ColumnType, type ColumnTypePreview, type PlanColumn, type PlanColumnInput } from '@/domain/plan-columns'
import type { Plan } from '@/domain/plan'
import { AppButton, AppConfirmDialog, AppDialog, AppIconButton, AppTextField, notify } from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { useRepositories } from '@/presentation/common/repositories-context'
import { cn } from '@/core/utils/cn'
import { ColorButton } from '@/features/task-config/config-visuals'
import type { PlanMutations } from './queries'

const TYPE_ICONS: Record<ColumnType, ReactNode> = {
  text: <Type />,
  number: <Hash />,
  date: <CalendarDays />,
  checkbox: <CheckSquare />,
  dropdown: <ListChecks />,
  people: <User />,
  link: <Link2 />,
}

export type ColumnDialogState = { mode: 'create'; after: string | null } | { mode: 'edit'; column: PlanColumn } | null

/** Escolha do tipo (botões com ícone; um selecionado). */
function TypePicker({ value, onChange, exclude }: { value: ColumnType | null; onChange: (type: ColumnType) => void; exclude?: ColumnType }) {
  const { t } = useTranslation()
  return (
    <div role="radiogroup" aria-label={t('plan.customColumns.type')} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {COLUMN_TYPES.filter((type) => type !== exclude).map((type) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={value === type}
          onClick={() => onChange(type)}
          className={cn(
            'flex flex-col items-start gap-1 rounded-lg border border-border p-2.5 text-left text-sm transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4',
            value === type ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'bg-surface text-fg',
          )}
        >
          <span className="flex items-center gap-1.5 font-medium">
            <span aria-hidden className="flex">
              {TYPE_ICONS[type]}
            </span>
            {t(`plan.customColumns.types.${type}`)}
          </span>
          <span className="text-xs text-muted">{t(`plan.customColumns.typeHints.${type}`)}</span>
        </button>
      ))}
    </div>
  )
}

/** Opções da lista: nome e cor; adicionar e tirar. */
function OptionsEditor({ options, onChange }: { options: ColumnOption[]; onChange: (options: ColumnOption[]) => void }) {
  const { t } = useTranslation()
  const update = (index: number, patch: Partial<ColumnOption>) => onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)))
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-fg">{t('plan.customColumns.options')}</legend>
      {options.map((option, index) => (
        <div key={option.id} className="flex items-center gap-2">
          <ColorButton color={option.color} label={t('plan.customColumns.optionColor', { name: option.name || index + 1 })} onChange={(color) => update(index, { color })} />
          <AppTextField
            aria-label={t('plan.customColumns.optionName', { index: index + 1 })}
            value={option.name}
            maxLength={COLUMN_LIMITS.optionName}
            onChange={(event) => update(index, { name: event.target.value })}
            fieldClassName="flex-1"
          />
          <AppIconButton size="sm" variant="ghost" icon={<Trash2 />} label={t('plan.customColumns.removeOption', { name: option.name || index + 1 })} onClick={() => onChange(options.filter((_, i) => i !== index))} />
        </div>
      ))}
      {options.length < COLUMN_LIMITS.options && (
        <AppButton
          variant="ghost"
          size="sm"
          leftIcon={<Plus />}
          className="self-start"
          onClick={() => onChange([...options, { id: `new-${Date.now()}-${options.length}`, name: '', color: OPTION_COLORS[options.length % OPTION_COLORS.length] as OptionColor }])}
        >
          {t('plan.customColumns.addOption')}
        </AppButton>
      )}
    </fieldset>
  )
}

/** Corpo enviado ao servidor (opções novas vão sem id). */
function settingsBody(type: ColumnType, options: ColumnOption[], unit: string): PlanColumnInput['settings'] {
  if (type === 'dropdown') return { options: options.filter((o) => o.name.trim()).map((o) => ({ ...(o.id.startsWith('new-') ? {} : { id: o.id }), name: o.name.trim(), color: o.color }) as ColumnOption) }
  if (type === 'number') return unit.trim() ? { unit: unit.trim() } : {}
  return {}
}

/** Adicionar coluna (nome + tipo) ou editar (nome, opções da lista, unidade do número). */
export function ColumnDialog({ state, plan, mutations, onClose, onCreated }: { state: ColumnDialogState; plan: Plan; mutations: PlanMutations; onClose: () => void; onCreated: (column: PlanColumn, after: string | null) => void }) {
  if (!state) return null
  return <ColumnForm key={state.mode === 'edit' ? state.column.id : `new:${state.after ?? ''}`} state={state} plan={plan} mutations={mutations} onClose={onClose} onCreated={onCreated} />
}

function ColumnForm({ state, plan, mutations, onClose, onCreated }: { state: Exclude<ColumnDialogState, null>; plan: Plan; mutations: PlanMutations; onClose: () => void; onCreated: (column: PlanColumn, after: string | null) => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const editing = state.mode === 'edit' ? state.column : null
  const [name, setName] = useState(editing?.name ?? '')
  const [type, setType] = useState<ColumnType | null>(editing?.type ?? null)
  const [options, setOptions] = useState<ColumnOption[]>(editing?.settings.options ?? [])
  const [unit, setUnit] = useState(editing?.settings.unit ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pending = mutations.createColumn.isPending || mutations.updateColumn.isPending
  const used = editing && type === 'dropdown' ? new Set(plan.items.map((i) => i.custom[editing.id]).filter(Boolean)) : new Set()
  const removedInUse = editing && type === 'dropdown' ? (editing.settings.options ?? []).filter((o) => used.has(o.id) && !options.some((x) => x.id === o.id)).length : 0

  function submit() {
    const missing: Record<string, string> = {}
    if (!name.trim()) missing.name = 'required'
    if (!type) missing.type = 'required'
    if (Object.keys(missing).length || !type) return setErrors(missing)
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') {
        const fields = error.fieldErrors()
        if (fields.columns) return notify.error(t('plan.customColumns.tooMany', { max: COLUMN_LIMITS.columns }))
        return setErrors(fields)
      }
      notify.error(errorMessage(error))
    }
    const settings = settingsBody(type, options, unit)
    if (editing)
      mutations.updateColumn.mutate(
        { id: editing.id, input: { name: name.trim(), settings } },
        {
          onSuccess: () => {
            notify.success(t('plan.customColumns.updated', { name: name.trim() }))
            onClose()
          },
          onError,
        },
      )
    else
      mutations.createColumn.mutate(
        { name: name.trim(), type, settings },
        {
          onSuccess: (column) => {
            notify.success(t('plan.customColumns.created', { name: column.name }))
            onCreated(column, state.mode === 'create' ? state.after : null)
            onClose()
          },
          onError,
        },
      )
  }

  const fieldError = (key: string) => (errors[key] ? t(`plan.customColumns.issues.${errors[key]}`, { defaultValue: t(`validation.${errors[key]}`) }) : undefined)

  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      size="lg"
      closeOnOutsideClick={false}
      title={editing ? t('plan.customColumns.editTitle', { name: editing.name }) : t('plan.customColumns.createTitle')}
      description={t('plan.customColumns.hint')}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {editing ? t('common.save') : t('plan.customColumns.create')}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <AppTextField label={t('plan.customColumns.name')} required value={name} maxLength={COLUMN_LIMITS.name} onChange={(event) => setName(event.target.value)} error={fieldError('name')} />
        {!editing && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">{t('plan.customColumns.type')}</span>
            <TypePicker value={type} onChange={setType} />
            {errors.type && <p className="text-xs text-danger">{fieldError('type')}</p>}
          </div>
        )}
        {type === 'dropdown' && <OptionsEditor options={options} onChange={setOptions} />}
        {removedInUse > 0 && <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-soft-fg">{t('plan.customColumns.optionsInUse', { count: removedInUse })}</p>}
        {type === 'number' && <AppTextField label={t('plan.customColumns.unit')} hint={t('plan.customColumns.unitHint')} value={unit} maxLength={COLUMN_LIMITS.unit} onChange={(event) => setUnit(event.target.value)} fieldClassName="sm:w-48" />}
        {errors.settings && <p className="text-xs text-danger">{fieldError('settings')}</p>}
      </div>
    </AppDialog>
  )
}

/** Alterar o tipo: prévia do servidor (quantos valores convertem e quantos se perdem) antes de confirmar. */
export function ColumnTypeDialog({ column, mutations, onClose }: { column: PlanColumn | null; mutations: PlanMutations; onClose: () => void }) {
  if (!column) return null
  return <TypeForm key={column.id} column={column} mutations={mutations} onClose={onClose} />
}

function TypeForm({ column, mutations, onClose }: { column: PlanColumn; mutations: PlanMutations; onClose: () => void }) {
  const { t } = useTranslation()
  const { plan } = useRepositories()
  const errorMessage = useErrorMessage()
  const [type, setType] = useState<ColumnType | null>(null)
  const [preview, setPreview] = useState<{ type: ColumnType; value: ColumnTypePreview } | null>(null)

  useEffect(() => {
    if (!type) return
    let alive = true
    plan
      .previewColumnType(column.id, { type })
      .then((value) => alive && setPreview({ type, value }))
      .catch((error: unknown) => alive && notify.error(errorMessage(error)))
    return () => {
      alive = false
    }
  }, [type, column.id, plan, errorMessage])

  const current = preview && preview.type === type ? preview.value : null
  return (
    <AppDialog
      open
      onOpenChange={(open) => !open && !mutations.changeColumnType.isPending && onClose()}
      size="lg"
      closeOnOutsideClick={false}
      title={t('plan.customColumns.changeTypeTitle', { name: column.name })}
      description={t('plan.customColumns.changeTypeHint', { type: t(`plan.customColumns.types.${column.type}`) })}
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={mutations.changeColumnType.isPending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton
            disabled={!type || !current}
            loading={mutations.changeColumnType.isPending}
            onClick={() =>
              type &&
              mutations.changeColumnType.mutate(
                { id: column.id, input: { type } },
                {
                  onSuccess: () => {
                    notify.success(t('plan.customColumns.typeChanged', { name: column.name, type: t(`plan.customColumns.types.${type}`) }))
                    onClose()
                  },
                  onError: (error) => notify.error(errorMessage(error)),
                },
              )
            }
          >
            {t('plan.customColumns.changeType')}
          </AppButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TypePicker value={type} onChange={setType} exclude={column.type} />
        {type && (
          <p role="status" className={cn('rounded-lg px-3 py-2 text-sm', current && current.lost > 0 ? 'bg-warning-soft text-warning-soft-fg' : 'bg-surface-2 text-muted')}>
            {!current
              ? t('common.loading')
              : current.lost > 0
                ? t('plan.customColumns.previewLost', { converted: current.converted, count: current.lost })
                : t('plan.customColumns.previewOk', { count: current.converted })}
          </p>
        )}
      </div>
    </AppDialog>
  )
}

/** Excluir coluna (com a quantidade de células preenchidas). */
export function DeleteColumnConfirm({ column, plan, mutations, onClose }: { column: PlanColumn | null; plan: Plan; mutations: PlanMutations; onClose: () => void }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const filled = column ? plan.items.filter((i) => i.custom[column.id] !== undefined).length : 0
  return (
    <AppConfirmDialog
      open={!!column}
      onOpenChange={(open) => !open && onClose()}
      title={t('plan.customColumns.deleteTitle', { name: column?.name ?? '' })}
      description={t('plan.customColumns.deleteDescription', { count: filled })}
      confirmLabel={t('common.delete')}
      loading={mutations.deleteColumn.isPending}
      onConfirm={() =>
        column &&
        mutations.deleteColumn.mutate(column.id, {
          onSuccess: () => {
            notify.success(t('plan.customColumns.deleted', { name: column.name }))
            onClose()
          },
          onError: (error) => notify.error(errorMessage(error)),
        })
      }
    />
  )
}
