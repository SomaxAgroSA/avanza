import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { isAppError } from '@/core/errors/app-error'
import { cn } from '@/core/utils/cn'
import {
  FIELD_FLAGS,
  FIELD_TYPES,
  FIELD_TYPE_INFO,
  slugifyName,
  valueIssue,
  type CustomField,
  type FieldConfig,
  type FieldType,
  type FieldValue,
  type OptionColor,
} from '@/domain/task-config'
import {
  AppButton,
  AppCheckbox,
  AppDragHandle,
  AppDialog,
  AppIconButton,
  AppSelect,
  AppSortableList,
  AppSwitch,
  AppTextField,
  AppTextarea,
  notify,
} from '@/presentation/components'
import { useErrorMessage } from '@/presentation/common/use-error-message'
import { ColorButton } from './config-visuals'
import { FIELD_TYPE_ICONS } from './config-theme'
import { CustomFieldInput } from './CustomFieldInput'
import { useCustomFieldMutations } from './queries'

interface OptionDraft {
  key: string
  id?: string
  label: string
  color: OptionColor
  isActive: boolean
  isDefault: boolean
}

interface Draft {
  label: string
  name: string
  type: FieldType
  description: string
  config: Record<string, string>
  defaultValue: FieldValue
  searchable: boolean
  filterable: boolean
  sortable: boolean
  options: OptionDraft[]
  /** Seleção: "Permitir adicionar opções pela tarefa". */
  allowCreateOptions: boolean
}

type NumericConfigKey = 'max_length' | 'min' | 'max' | 'decimals'

let keySeq = 0
const newKey = () => `opt-${++keySeq}`

function toDraft(field?: CustomField | null): Draft {
  const config: Record<string, string> = {}
  Object.entries(field?.config ?? {}).forEach(([k, v]) => {
    if (k !== 'allow_create_options' && v !== undefined && v !== null) config[k] = String(v)
  })
  const defaults = Array.isArray(field?.defaultValue) ? field.defaultValue : [field?.defaultValue]
  return {
    label: field?.label ?? '',
    name: field?.name ?? '',
    type: field?.type ?? 'text',
    description: field?.description ?? '',
    config,
    defaultValue: field && !FIELD_TYPE_INFO[field.type].options ? field.defaultValue : null,
    searchable: field?.searchable ?? false,
    filterable: field?.filterable ?? false,
    sortable: field?.sortable ?? false,
    options: (field?.options ?? []).map((o) => ({
      key: o.id,
      id: o.id,
      label: o.label,
      color: o.color,
      isActive: o.isActive,
      isDefault: defaults.includes(o.id),
    })),
    allowCreateOptions: field?.config.allow_create_options === true,
  }
}

function toConfig(type: FieldType, config: Record<string, string>, allowCreateOptions = false): FieldConfig {
  const out: FieldConfig = {}
  const num = (key: NumericConfigKey) => {
    const raw = config[key]
    if (raw !== undefined && raw.trim() !== '') out[key] = Number(raw.replace(',', '.'))
  }
  if (type === 'text' || type === 'textarea') num('max_length')
  if (type === 'number' || type === 'decimal') {
    num('min')
    num('max')
  }
  if (type === 'decimal') num('decimals')
  if (FIELD_TYPE_INFO[type].options && allowCreateOptions) out.allow_create_options = true
  return out
}

export interface CustomFieldFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  field?: CustomField | null
  /** Chamado com o campo salvo (ex.: para já adicioná-lo a um tipo). */
  onSaved?: (field: CustomField) => void
}

/** Remonta o formulário a cada abertura (estado inicial sempre vem do campo atual). */
export function CustomFieldFormDialog(props: CustomFieldFormDialogProps) {
  return <CustomFieldForm key={props.open ? (props.field?.id ?? 'new') : 'closed'} {...props} />
}

function CustomFieldForm({ open, onOpenChange, field, onSaved }: CustomFieldFormDialogProps) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const { create, update } = useCustomFieldMutations()
  const isEdit = !!field
  const [draft, setDraft] = useState<Draft>(() => toDraft(field))
  const [nameTouched, setNameTouched] = useState(isEdit)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const info = FIELD_TYPE_INFO[draft.type]
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const setOption = (key: string, patch: Partial<OptionDraft>) =>
    setDraft((d) => ({
      ...d,
      options: d.options.map((o) => {
        if (o.key === key) return { ...o, ...patch }
        // seleção única: só uma opção pode ser o padrão
        if (patch.isDefault && d.type === 'select') return { ...o, isDefault: false }
        return o
      }),
    }))

  function validate(): Record<string, string> {
    const found: Record<string, string> = {}
    if (!draft.label.trim()) found.label = 'required'
    const name = (draft.name || slugifyName(draft.label)).trim()
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(name)) found.name = 'invalid_format'
    if (info.options) {
      if (draft.options.length === 0) found.options = 'required'
      else if (draft.options.some((o) => !o.label.trim())) found.options = 'option_label_required'
      else {
        const labels = draft.options.map((o) => o.label.trim().toLowerCase())
        if (new Set(labels).size !== labels.length) found.options = 'duplicate_option'
      }
    }
    if (info.defaultValue && !info.options) {
      const issue = valueIssue({ type: draft.type, config: toConfig(draft.type, draft.config), options: [] }, draft.defaultValue, false)
      if (issue) found.default_value = issue
    }
    return found
  }

  const pending = create.isPending || update.isPending

  function submit() {
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const payload = {
      label: draft.label.trim(),
      description: draft.description.trim(),
      config: toConfig(draft.type, draft.config, draft.allowCreateOptions),
      searchable: info.searchable && draft.searchable,
      filterable: info.filterable && draft.filterable,
      sortable: info.sortable && draft.sortable,
      ...(info.options
        ? { options: draft.options.map((o) => ({ id: o.id, label: o.label.trim(), color: o.color, isActive: o.isActive, isDefault: o.isDefault })) }
        : info.defaultValue
          ? { defaultValue: draft.defaultValue === '' ? null : draft.defaultValue }
          : {}),
    }
    const onError = (error: unknown) => {
      if (isAppError(error) && error.code === 'FIELD_NAME_IN_USE') return setErrors({ name: 'name_in_use' })
      if (isAppError(error) && error.code === 'VALIDATION_ERROR') return setErrors(error.fieldErrors())
      notify.error(errorMessage(error))
    }
    const onSuccess = (saved: CustomField) => {
      notify.success(isEdit ? t('fields.updated', { name: saved.label }) : t('fields.created', { name: saved.label }))
      onSaved?.(saved)
      onOpenChange(false)
    }
    if (field) update.mutate({ id: field.id, data: payload }, { onSuccess, onError })
    else create.mutate({ ...payload, type: draft.type, name: draft.name || slugifyName(draft.label) }, { onSuccess, onError })
  }

  const numberField = (key: NumericConfigKey, label: string, hint?: string) => (
    <AppTextField
      label={label}
      hint={hint}
      inputMode="decimal"
      value={draft.config[key] ?? ''}
      error={errors.config === key ? 'invalid_value' : undefined}
      onChange={(event) => set('config', { ...draft.config, [key]: event.target.value.replace(/[^0-9,.-]/g, '') })}
    />
  )

  // nova opção: entra logo abaixo de `after` (ou no fim) e já recebe o cursor
  const focusNext = useRef<string | null>(null)
  function addOption(after?: string) {
    const option = { key: newKey(), label: '', color: 'gray' as OptionColor, isActive: true, isDefault: false }
    const index = after ? draft.options.findIndex((o) => o.key === after) : -1
    const options = index >= 0 ? [...draft.options.slice(0, index + 1), option, ...draft.options.slice(index + 1)] : [...draft.options, option]
    set('options', options)
    focusNext.current = option.key
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      tall
      closeOnOutsideClick={false}
      title={isEdit ? t('fields.editTitle') : t('fields.createTitle')}
      description={isEdit ? `${field?.label} · ${field?.name}` : t('fields.createDescription')}
      footer={
        <>
          <AppButton variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </AppButton>
          <AppButton onClick={submit} loading={pending}>
            {isEdit ? t('common.save') : t('fields.create')}
          </AppButton>
        </>
      }
    >
      <form
        noValidate
        className="grid items-start gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <AppTextField
              label={t('fields.fields.label')}
              required
              autoComplete="off"
              value={draft.label}
              error={errors.label}
              onChange={(event) => {
                const label = event.target.value
                setDraft((d) => ({ ...d, label, name: nameTouched ? d.name : slugifyName(label) }))
              }}
            />
            <AppTextField
              label={t('fields.fields.name')}
              required
              autoComplete="off"
              disabled={isEdit}
              className="font-mono"
              value={draft.name}
              error={errors.name}
              hint={isEdit ? t('fields.nameLocked') : t('fields.nameHint')}
              onChange={(event) => {
                setNameTouched(true)
                set('name', event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))
              }}
            />
          </div>

          <AppSelect
            label={t('fields.fields.type')}
            required
            disabled={isEdit}
            hint={isEdit ? t('fields.typeLocked') : t(`fields.typeHints.${draft.type}`)}
            value={draft.type}
            error={errors.type}
            onValueChange={(type) =>
              setDraft((d) => ({
                ...d,
                type: type as FieldType,
                config: {},
                defaultValue: null,
                options:
                  FIELD_TYPE_INFO[type as FieldType].options && d.options.length === 0
                    ? [{ key: newKey(), label: '', color: 'gray', isActive: true, isDefault: false }]
                    : d.options,
              }))
            }
            options={FIELD_TYPES.map((type) => {
              const Icon = FIELD_TYPE_ICONS[type]
              return {
                value: type,
                label: (
                  <span className="inline-flex items-center gap-2">
                    <Icon className="size-4 text-subtle" aria-hidden />
                    {t(`fields.types.${type}`)}
                  </span>
                ),
              }
            })}
          />

          <AppTextarea
            label={t('fields.fields.description')}
            hint={t('fields.descriptionHint')}
            rows={2}
            value={draft.description}
            error={errors.description}
            onChange={(event) => set('description', event.target.value)}
          />

          {(draft.type === 'text' || draft.type === 'textarea') && (
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField('max_length', t('fields.config.maxLength'), t('fields.config.maxLengthHint', { max: draft.type === 'text' ? 255 : 10000 }))}
            </div>
          )}
          {(draft.type === 'number' || draft.type === 'decimal') && (
            <div className="grid gap-4 sm:grid-cols-3">
              {numberField('min', t('fields.config.min'))}
              {numberField('max', t('fields.config.max'))}
              {draft.type === 'decimal' && (
                <AppSelect
                  label={t('fields.config.decimals')}
                  value={draft.config.decimals ?? '2'}
                  onValueChange={(value) => set('config', { ...draft.config, decimals: value })}
                  options={[0, 1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))}
                />
              )}
            </div>
          )}
          {errors.config && (
            <p className="-mt-3 text-xs font-medium text-danger">
              {t(`fields.configErrors.${errors.config}`, { defaultValue: t('validation.invalid_format') })}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {info.options && (
            <section aria-labelledby="options-title" className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 id="options-title" className="text-sm font-medium text-fg">
                  {t('fields.optionsTitle')} <span className="text-danger">*</span>
                </h3>
                <span className="text-xs text-subtle">{draft.type === 'select' ? t('fields.defaultSingleHint') : t('fields.defaultMultiHint')}</span>
              </div>
              <AppSortableList
                items={draft.options}
                getId={(o) => o.key}
                getLabel={(o) => o.label || t('fields.untitledOption')}
                onReorder={(options) => set('options', options)}
                renderItem={(option, { handle }) => (
                  // em tela estreita os controles descem para a 2ª linha e o nome continua largo
                  <div className={cn('flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2', !option.isActive && 'opacity-60')}>
                    <AppDragHandle handle={handle} />
                    <ColorButton color={option.color} label={t('fields.optionColor')} onChange={(color) => setOption(option.key, { color })} />
                    <input
                      ref={(el) => {
                        if (el && focusNext.current === option.key) {
                          focusNext.current = null
                          el.focus()
                        }
                      }}
                      value={option.label}
                      onChange={(event) => setOption(option.key, { label: event.target.value })}
                      onKeyDown={(event) => {
                        // Enter cria a próxima opção logo abaixo (em vez de enviar o formulário)
                        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                        event.preventDefault()
                        addOption(option.key)
                      }}
                      placeholder={t('fields.optionPlaceholder')}
                      aria-label={t('fields.optionLabel')}
                      maxLength={60}
                      className="h-9 min-w-0 grow basis-40 rounded-md border border-border bg-surface px-2.5 text-sm text-fg shadow-xs placeholder:text-subtle hover:border-border-strong focus:border-primary focus:outline-2 focus:outline-offset-0 focus:outline-ring"
                    />
                    <div className="ml-auto flex items-center gap-2">
                      <AppCheckbox
                        checked={option.isDefault}
                        onCheckedChange={(checked) => setOption(option.key, { isDefault: checked })}
                        label={<span className="text-xs text-muted">{t('fields.default')}</span>}
                      />
                      <AppSwitch
                        size="sm"
                        checked={option.isActive}
                        onCheckedChange={(isActive) => setOption(option.key, { isActive, isDefault: isActive ? option.isDefault : false })}
                        aria-label={t('fields.optionActive', { name: option.label })}
                      />
                      <AppIconButton
                        size="sm"
                        variant="danger"
                        label={t('fields.removeOption')}
                        icon={<Trash2 />}
                        onClick={() =>
                          set(
                            'options',
                            draft.options.filter((o) => o.key !== option.key),
                          )
                        }
                      />
                    </div>
                  </div>
                )}
              />
              {errors.options && (
                <p className="text-xs font-medium text-danger">
                  {t(`fields.optionErrors.${errors.options}`, { defaultValue: t('validation.invalid_option') })}
                </p>
              )}
              <div className="flex flex-wrap items-center">
                <AppButton variant="ghost" size="sm" leftIcon={<Plus />} onClick={() => addOption()}>
                  {t('fields.addOption')}
                </AppButton>
                <span className="ml-2 text-xs text-subtle">{t('fields.optionEnterHint')}</span>
              </div>
              {isEdit && <p className="text-xs text-subtle">{t('fields.optionsEditHint')}</p>}
              <AppSwitch
                className="mt-2"
                checked={draft.allowCreateOptions}
                onCheckedChange={(checked) => set('allowCreateOptions', checked)}
                label={t('fields.allowCreateOptions')}
                description={t('fields.allowCreateOptionsHint')}
              />
            </section>
          )}

          {info.defaultValue && !info.options && (
            <div className="rounded-lg border border-dashed border-border p-4">
              <CustomFieldInput
                field={{
                  id: 'default',
                  name: 'default',
                  label: t('fields.fields.defaultValue'),
                  type: draft.type,
                  description: t('fields.defaultHint'),
                  config: toConfig(draft.type, draft.config),
                  options: [],
                }}
                value={draft.defaultValue}
                onChange={(value) => set('defaultValue', value)}
                error={errors.default_value}
              />
            </div>
          )}

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-fg">{t('fields.behavior')}</h3>
            {FIELD_FLAGS.map((flag) => (
              <AppSwitch
                key={flag}
                checked={info[flag] && draft[flag]}
                disabled={!info[flag]}
                onCheckedChange={(checked) => set(flag, checked)}
                label={t(`fields.flags.${flag}`)}
                description={info[flag] ? t(`fields.flagHints.${flag}`) : t('fields.flagNotSupported')}
              />
            ))}
          </section>
        </div>
      </form>
    </AppDialog>
  )
}
