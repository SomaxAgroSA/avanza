import type { HexColor } from './colors'
/**
 * Tipos de tarefa e campos personalizados — tipos e regras de apresentação.
 * Espelha backend/src/domain/custom-field.js (o backend continua sendo a autoridade).
 */

export const FIELD_TYPES = [
  'text', 'textarea', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multiselect',
  'user', 'users', 'project', 'url', 'email', 'phone', 'image', 'file',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export interface FieldTypeInfo {
  options: boolean
  defaultValue: boolean
  searchable: boolean
  filterable: boolean
  sortable: boolean
}

export const FIELD_TYPE_INFO: Record<FieldType, FieldTypeInfo> = {
  text: { options: false, defaultValue: true, searchable: true, filterable: true, sortable: true },
  textarea: { options: false, defaultValue: true, searchable: true, filterable: false, sortable: false },
  number: { options: false, defaultValue: true, searchable: false, filterable: true, sortable: true },
  decimal: { options: false, defaultValue: true, searchable: false, filterable: true, sortable: true },
  boolean: { options: false, defaultValue: true, searchable: false, filterable: true, sortable: true },
  date: { options: false, defaultValue: true, searchable: false, filterable: true, sortable: true },
  datetime: { options: false, defaultValue: true, searchable: false, filterable: true, sortable: true },
  select: { options: true, defaultValue: true, searchable: false, filterable: true, sortable: true },
  multiselect: { options: true, defaultValue: true, searchable: false, filterable: true, sortable: false },
  user: { options: false, defaultValue: false, searchable: false, filterable: true, sortable: false },
  users: { options: false, defaultValue: false, searchable: false, filterable: true, sortable: false },
  project: { options: false, defaultValue: false, searchable: false, filterable: true, sortable: false },
  url: { options: false, defaultValue: true, searchable: true, filterable: false, sortable: false },
  email: { options: false, defaultValue: true, searchable: true, filterable: false, sortable: false },
  phone: { options: false, defaultValue: true, searchable: true, filterable: false, sortable: false },
  image: { options: false, defaultValue: false, searchable: false, filterable: false, sortable: false },
  file: { options: false, defaultValue: false, searchable: false, filterable: false, sortable: false },
}

export const FIELD_FLAGS = ['searchable', 'filterable', 'sortable'] as const
export type FieldFlag = (typeof FIELD_FLAGS)[number]

export const OPTION_COLORS = ['gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink'] as const
export type PaletteColor = (typeof OPTION_COLORS)[number]
/** Cor da paleta ou livre ("#rrggbb") — domain/colors.ts. */
export type OptionColor = PaletteColor | HexColor

/** Tamanho máximo do rótulo de uma opção (mesmo limite do servidor). */
export const MAX_OPTION_LABEL = 60

/** Quem adiciona opção pelo formulário da tarefa (espelha backend/application/custom-fields.js). */
export const ADD_FIELD_OPTION_PERMISSIONS = ['settings.manage', 'tasks.create', 'tasks.edit'] as const

export const TASK_TYPE_ICONS = [
  'bug', 'code', 'sparkles', 'wrench', 'plus-square', 'plug', 'life-buoy', 'book', 'check-square',
  'flag', 'zap', 'shield', 'rocket', 'target', 'file-text', 'layers', 'search', 'settings',
] as const
export type TaskTypeIcon = (typeof TASK_TYPE_ICONS)[number]

export interface FieldConfig {
  max_length?: number
  min?: number
  max?: number
  decimals?: number
  /** Seleção: quem cria/edita tarefas pode adicionar opções pelo formulário da tarefa. */
  allow_create_options?: boolean
}

export interface FieldOption {
  id: string
  label: string
  color: OptionColor
  order: number
  isActive: boolean
}

export type FieldValue = string | number | boolean | string[] | null

export interface CustomField {
  id: string
  name: string
  label: string
  type: FieldType
  description: string
  config: FieldConfig
  defaultValue: FieldValue
  searchable: boolean
  filterable: boolean
  sortable: boolean
  options: FieldOption[]
  usedBy: Array<{ id: string; key: string; name: string }>
  createdAt: Date | null
  updatedAt: Date | null
}

/** Idiomas dos cadastros traduzidos: o original é pt-BR; en/es são opcionais (vazio = usa o original). */
export const CONTENT_LOCALES = ['pt-BR', 'en', 'es'] as const
export type ContentLocale = (typeof CONTENT_LOCALES)[number]
export const TRANSLATED_LOCALES = ['en', 'es'] as const
export type TranslatedLocale = (typeof TRANSLATED_LOCALES)[number]

export interface TypeTexts {
  name: string
  description: string
}

export interface TaskType {
  id: string
  key: string
  /** No idioma da tela (tradução, ou o original quando não há). */
  name: string
  description: string
  /** Todas as versões para edição: pt-BR (original) + en/es ('' = sem tradução). */
  translations: Record<ContentLocale, TypeTexts>
  icon: TaskTypeIcon
  color: OptionColor
  order: number
  isActive: boolean
  fieldCount: number
  createdAt: Date | null
  updatedAt: Date | null
}

export interface TaskTypeField {
  field: CustomField
  order: number
  /** Obrigatório em todos os status. */
  required: boolean
  visible: boolean
  showOnCard: boolean
  /** Status em que o campo passa a ser exigido (além de `required`). */
  requiredStatusIds: string[]
}

/**
 * Campo exigido no status (diretriz §9 — espelha backend/domain/task.js `requiredIn`): obrigatório
 * sempre ou só nos status marcados no tipo. Campo oculto nunca é exigido.
 */
export function isRequiredIn(link: Pick<TaskTypeField, 'required' | 'visible' | 'requiredStatusIds'>, statusId: string | null | undefined): boolean {
  if (!link.visible) return false
  if (link.required) return true
  return !!statusId && link.requiredStatusIds.includes(statusId)
}

/** Campo de seleção que aceita opção nova criada no formulário da tarefa (espelha domain/custom-field.js). */
export function acceptsNewOptions(field: Pick<CustomField, 'type' | 'config'>): boolean {
  return FIELD_TYPE_INFO[field.type].options && field.config.allow_create_options === true
}

/** Campo `fieldId` com a opção incluída (ou atualizada, se já existia), na ordem das opções. */
export function withFieldOption<T extends Pick<CustomField, 'id' | 'options'>>(field: T, fieldId: string, option: FieldOption): T {
  if (field.id !== fieldId) return field
  const others = field.options.filter((o) => o.id !== option.id)
  return { ...field, options: [...others, option].sort((a, b) => a.order - b.order) }
}

export interface TaskTypeDetail extends TaskType {
  fields: TaskTypeField[]
}

/** "Passos para reprodução" -> "passos_para_reproducao" */
export function slugifyName(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[_0-9]+|_+$/g, '')
    .slice(0, 40)
}

export function normalizeTypeKey(key: string): string {
  return key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i
const PHONE = /^\+?[0-9 ().-]{7,20}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

export function isEmptyValue(value: FieldValue | undefined): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)
}

/**
 * Valida o valor de um campo para feedback imediato no formulário.
 * Retorna o código de erro (validation.*) ou null. O backend revalida tudo.
 */
export function valueIssue(field: Pick<CustomField, 'type' | 'config' | 'options'>, value: FieldValue | undefined, required: boolean): string | null {
  if (isEmptyValue(value)) return required ? 'required' : null
  const config = field.config
  switch (field.type) {
    case 'text':
    case 'textarea':
      return String(value).trim().length > (config.max_length ?? (field.type === 'text' ? 255 : 10000)) ? 'too_long' : null
    case 'number':
    case 'decimal': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
      if (!Number.isFinite(n)) return 'invalid_type'
      if (field.type === 'number' && !Number.isInteger(n)) return 'not_integer'
      if (config.min !== undefined && n < config.min) return 'too_small'
      if (config.max !== undefined && n > config.max) return 'too_large'
      return null
    }
    case 'date':
      return typeof value === 'string' && DAY.test(value) ? null : 'invalid_date'
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) ? null : 'invalid_date'
    case 'url':
      return URL_PATTERN.test(String(value).trim()) ? null : 'invalid_url'
    case 'email':
      return EMAIL.test(String(value).trim()) ? null : 'invalid_email'
    case 'phone': {
      const text = String(value).trim()
      return PHONE.test(text) && text.replace(/[^0-9]/g, '').length >= 7 ? null : 'invalid_phone'
    }
    case 'select':
      return field.options.some((o) => o.id === value && o.isActive) ? null : 'invalid_option'
    case 'multiselect':
      return Array.isArray(value) && value.every((v) => field.options.some((o) => o.id === v && o.isActive)) ? null : 'invalid_option'
    default:
      return null
  }
}
