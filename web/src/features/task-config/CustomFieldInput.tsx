import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Image as ImageIcon, Lock, Upload, X } from 'lucide-react'
import { formatBytes } from '@/domain/attachments'
import { acceptsNewOptions, type CustomField, type FieldValue } from '@/domain/task-config'
import {
  AppButton,
  AppDatePicker,
  AppFormField,
  AppIconButton,
  AppMultiSelect,
  AppSelect,
  AppSwitch,
  AppTextField,
  AppTextarea,
  AppTimeField,
  type CreateOptionHandler,
} from '@/presentation/components'
import { ColorDot } from './config-visuals'
import type { FieldOptionCreator } from './use-field-option-creator'

export interface CustomFieldInputProps {
  field: Pick<CustomField, 'id' | 'name' | 'label' | 'type' | 'description' | 'config' | 'options'>
  value: FieldValue | undefined
  onChange: (value: FieldValue) => void
  required?: boolean
  /** Código de erro (validation.*) */
  error?: string | null | undefined
  disabled?: boolean
  /** Opções dos campos de pessoas e projeto (na tarefa: membros do projeto). Sem isso, ficam indisponíveis. */
  references?: CustomFieldReferences
}

export interface CustomFieldReferences {
  people?: Array<{ id: string; name: string }>
  projects?: Array<{ id: string; key: string; name: string }>
  /** Anexos da tarefa (campos de imagem/arquivo escolhem entre eles). */
  attachments?: Array<{ id: string; name: string; kind: 'image' | 'document'; url: string }>
  /**
   * Envio direto no campo de imagem/arquivo (tarefa já criada): anexa os arquivos à tarefa ligados ao
   * campo e devolve os ids aceitos. Sem isso, o campo só escolhe entre os anexos que já existem.
   */
  uploadFiles?: (files: File[], fieldName: string, imagesOnly: boolean) => Promise<string[]>
  /**
   * Criação da tarefa (ela ainda não existe): os arquivos escolhidos nos campos de imagem/arquivo
   * ficam no formulário e são enviados logo depois de criar. Tem precedência sobre `attachments`.
   */
  heldFiles?: HeldFieldFiles
  /** "Adicionar opção" nos campos de seleção que permitem (`config.allow_create_options`). */
  createOption?: FieldOptionCreator | undefined
}

/** Arquivos escolhidos por campo (nome técnico) antes de a tarefa existir. */
export interface HeldFieldFiles {
  files: Record<string, File[]>
  add: (fieldName: string, files: File[], imagesOnly: boolean) => void
  remove: (fieldName: string, index: number) => void
}

const NONE = '__none__'

/**
 * Renderizador dinâmico de campo personalizado: escolhe o componente do design system
 * conforme o tipo do campo. Usado na pré-visualização dos tipos e no formulário de tarefas.
 */
export function CustomFieldInput({ field, value, onChange, required, error, disabled, references }: CustomFieldInputProps) {
  const { t } = useTranslation()
  const common = { label: field.label, hint: field.description || undefined, required, error: error ?? undefined, disabled }
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  const createOption = references?.createOption
  // "Adicionar “texto”" na busca da seleção: cria a opção e devolve o id dela (já escolhida)
  const onCreateOption: CreateOptionHandler | undefined =
    createOption && acceptsNewOptions(field) ? async (label) => (await createOption(field, label))?.id : undefined

  switch (field.type) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
      return (
        <AppTextField
          {...common}
          type={field.type === 'text' ? 'text' : field.type === 'phone' ? 'tel' : field.type}
          maxLength={field.type === 'text' ? field.config.max_length : undefined}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'textarea':
      return <AppTextarea {...common} rows={3} maxLength={field.config.max_length} value={text} onChange={(event) => onChange(event.target.value)} />
    case 'number':
    case 'decimal':
      return (
        <AppTextField
          {...common}
          inputMode={field.type === 'number' ? 'numeric' : 'decimal'}
          value={text}
          onChange={(event) => onChange(event.target.value.replace(/[^0-9,.-]/g, ''))}
          hint={common.hint ?? rangeHint(t, field.config)}
        />
      )
    case 'boolean':
      return (
        <AppFormField hint={common.hint} error={common.error}>
          {() => <AppSwitch checked={value === true} onCheckedChange={onChange} label={field.label} disabled={disabled} />}
        </AppFormField>
      )
    case 'date':
      return <AppDatePicker {...common} value={text} onValueChange={onChange} />
    case 'datetime': {
      const [datePart = '', timePart = ''] = text.split('T')
      const compose = (date: string, time: string) => onChange(date ? `${date}T${time || '00:00'}` : '')
      return (
        <div className="grid grid-cols-[1fr_7.5rem] gap-2">
          <AppDatePicker {...common} value={datePart} onValueChange={(date) => compose(date, timePart.slice(0, 5))} />
          <AppTimeField label={t('fields.time')} value={timePart.slice(0, 5)} onValueChange={(time) => compose(datePart, time)} disabled={disabled || !datePart} />
        </div>
      )
    }
    case 'select': {
      const options = field.options.filter((o) => o.isActive || o.id === value)
      return (
        <AppSelect
          {...common}
          value={text || (required ? undefined : NONE)}
          placeholder={t('fields.selectPlaceholder')}
          onValueChange={(next) => onChange(next === NONE ? null : next)}
          onCreateOption={onCreateOption}
          options={[
            ...(required ? [] : [{ value: NONE, label: t('fields.none') }]),
            ...options.map((o) => ({ value: o.id, label: o.label, prefix: <ColorDot color={o.color} /> })),
          ]}
        />
      )
    }
    case 'multiselect':
      return (
        <AppMultiSelect
          {...common}
          value={Array.isArray(value) ? value : []}
          onValueChange={onChange}
          onCreateOption={onCreateOption}
          options={field.options.filter((o) => o.isActive).map((o) => ({ value: o.id, label: o.label, prefix: <ColorDot color={o.color} /> }))}
        />
      )
    case 'user':
    case 'project': {
      const choices =
        field.type === 'user'
          ? references?.people?.map((p) => ({ value: p.id, label: p.name }))
          : references?.projects?.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` }))
      if (!choices) break
      return (
        <AppSelect
          {...common}
          value={text || (required ? undefined : NONE)}
          placeholder={t('fields.selectPlaceholder')}
          onValueChange={(next) => onChange(next === NONE ? null : next)}
          options={[...(required ? [] : [{ value: NONE, label: t('fields.none') }]), ...choices]}
        />
      )
    }
    case 'users':
      if (!references?.people) break
      return (
        <AppMultiSelect
          {...common}
          value={Array.isArray(value) ? value : []}
          onValueChange={onChange}
          options={references.people.map((p) => ({ value: p.id, label: p.name }))}
        />
      )
    case 'image':
    case 'file': {
      const image = field.type === 'image'
      if (references?.heldFiles) return <HeldFilesInput {...common} fieldName={field.name} image={image} held={references.heldFiles} />
      if (!references?.attachments) break
      const choices = references.attachments.filter((a) => field.type === 'file' || a.kind === 'image')
      const selected = Array.isArray(value) ? value : []
      const multiselect = (
        <AppMultiSelect
          {...common}
          hint={common.hint ?? t(references.uploadFiles ? 'fields.attachmentUploadHint' : 'fields.attachmentHint')}
          value={selected}
          onValueChange={onChange}
          placeholder={choices.length === 0 ? t('fields.noAttachments') : undefined}
          options={choices.map((a) => ({ value: a.id, label: a.name }))}
        />
      )
      const uploadFiles = references.uploadFiles
      if (!uploadFiles) return multiselect
      return (
        <div className="grid gap-2">
          {multiselect}
          <FilePickButton
            image={image}
            disabled={disabled}
            onPick={async (files) => {
              const ids = await uploadFiles(files, field.name, image)
              if (ids.length > 0) onChange([...selected, ...ids.filter((id) => !selected.includes(id))])
            }}
          />
        </div>
      )
    }
    default:
      break
  }
  return <Deferred label={field.label} hint={common.hint} required={required} message={t(`fields.deferred.${field.type}`)} />
}

function rangeHint(t: (key: string, options?: Record<string, unknown>) => string, config: CustomField['config']): string | undefined {
  if (config.min !== undefined && config.max !== undefined) return t('fields.range', { min: config.min, max: config.max })
  if (config.min !== undefined) return t('fields.min', { min: config.min })
  if (config.max !== undefined) return t('fields.max', { max: config.max })
  return undefined
}

/** Botão "Enviar arquivo/imagem" do campo: abre o seletor e entrega os arquivos escolhidos (fica ocupado até terminar). */
function FilePickButton({ image, disabled, onPick }: { image: boolean; disabled?: boolean | undefined; onPick: (files: File[]) => Promise<void> | void }) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function pick(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length === 0) return
    setBusy(true)
    try {
      await onPick(files)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div>
      <input ref={input} type="file" multiple hidden accept={image ? 'image/*' : undefined} onChange={(e) => void pick(e.target.files)} />
      <AppButton type="button" size="sm" variant="secondary" loading={busy} disabled={disabled} leftIcon={<Upload aria-hidden />} onClick={() => input.current?.click()}>
        {t(image ? 'fields.uploadImage' : 'fields.uploadFile')}
      </AppButton>
    </div>
  )
}

/** Campo de imagem/arquivo na criação da tarefa: lista os arquivos escolhidos (cada um sai pelo X). */
function HeldFilesInput({
  fieldName,
  image,
  held,
  label,
  hint,
  required,
  error,
  disabled,
}: {
  fieldName: string
  image: boolean
  held: HeldFieldFiles
  label: string
  hint?: ReactNode
  required?: boolean | undefined
  error?: string | undefined
  disabled?: boolean | undefined
}) {
  const { t, i18n } = useTranslation()
  const files = held.files[fieldName] ?? []
  const Icon = image ? ImageIcon : FileText
  return (
    <AppFormField label={label} hint={hint ?? t('fields.heldFilesHint')} required={required} error={error}>
      {({ id, describedBy }) => (
        <div id={id} aria-describedby={describedBy} className="flex flex-col gap-2">
          {files.length > 0 && (
            <ul className="flex flex-col gap-1">
              {files.map((file, index) => (
                <li key={`${index}:${file.name}`} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 py-1 pl-2 pr-1 text-sm text-fg">
                  <Icon className="size-4 shrink-0 text-subtle" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-subtle tabular-nums">{formatBytes(file.size, i18n.language)}</span>
                  <AppIconButton
                    size="sm"
                    label={t('fields.removeHeldFile', { name: file.name })}
                    icon={<X />}
                    disabled={disabled}
                    onClick={() => held.remove(fieldName, index)}
                  />
                </li>
              ))}
            </ul>
          )}
          <FilePickButton image={image} disabled={disabled} onPick={(picked) => held.add(fieldName, picked, image)} />
        </div>
      )}
    </AppFormField>
  )
}

/** Tipos cujo preenchimento depende de módulos das próximas fases (pessoas, projetos, anexos). */
function Deferred({ label, hint, required, message }: { label: string; hint?: ReactNode; required?: boolean; message: string }) {
  return (
    <AppFormField label={label} hint={hint} required={required}>
      {({ id }) => (
        <div id={id} className="flex h-9 items-center gap-2 rounded-md border border-dashed border-border bg-surface-2 px-3 text-sm text-subtle">
          <Lock className="size-3.5" aria-hidden />
          {message}
        </div>
      )}
    </AppFormField>
  )
}
