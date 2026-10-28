import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { formatDateTime, formatDay, formatNumber } from '@/core/utils/format'
import type { CustomField, FieldValue } from '@/domain/task-config'
import { AppBadge } from '@/presentation/components'
import { ColorDot } from './config-visuals'
import type { CustomFieldReferences } from './CustomFieldInput'

/** Valor de campo personalizado em modo leitura (detalhe da tarefa, cards). */
export function CustomFieldValue({
  field,
  value,
  references,
}: {
  field: Pick<CustomField, 'type' | 'options' | 'config'>
  value: FieldValue | undefined
  references?: CustomFieldReferences
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-subtle">—</span>
  }
  const option = (id: string) => field.options.find((o) => o.id === id)
  const person = (id: string) => references?.people?.find((p) => p.id === id)?.name ?? t('tasks.unknownPerson')

  switch (field.type) {
    case 'select': {
      const o = option(String(value))
      return o ? (
        <span className="inline-flex items-center gap-1.5">
          <ColorDot color={o.color} />
          {o.label}
        </span>
      ) : (
        <span className="text-subtle">—</span>
      )
    }
    case 'multiselect':
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((id) => {
            const o = option(id)
            return o ? (
              <AppBadge key={id}>
                <ColorDot color={o.color} /> {o.label}
              </AppBadge>
            ) : null
          })}
        </span>
      )
    case 'boolean':
      return <span>{value === true ? t('audit.yes') : t('audit.no')}</span>
    case 'number':
    case 'decimal':
      return <span className="tabular-nums">{formatNumber(Number(value), locale)}</span>
    case 'date':
      return <span>{formatDay(new Date(`${String(value)}T00:00:00Z`), locale)}</span>
    case 'datetime':
      return <span>{formatDateTime(new Date(String(value)), locale)}</span>
    case 'url':
      // defesa extra: o servidor já exige http(s); nunca renderizar outros esquemas (ex.: javascript:)
      if (!/^https?:\/\//i.test(String(value))) return <span className="break-words">{String(value)}</span>
      return (
        <a href={String(value)} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-primary-text hover:underline">
          <span className="truncate">{String(value)}</span>
          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
        </a>
      )
    case 'email':
      return (
        <a href={`mailto:${String(value)}`} className="text-primary-text hover:underline">
          {String(value)}
        </a>
      )
    case 'user':
      return <span>{person(String(value))}</span>
    case 'users':
      return <span>{(value as string[]).map(person).join(', ')}</span>
    case 'project': {
      const p = references?.projects?.find((x) => x.id === value)
      return <span>{p ? `${p.key} · ${p.name}` : '—'}</span>
    }
    case 'image':
    case 'file': {
      const items = (Array.isArray(value) ? value : [String(value)]).map((id) => references?.attachments?.find((a) => a.id === id)).filter((a) => !!a)
      if (items.length === 0) return <span className="text-subtle">—</span>
      if (field.type === 'image') {
        return (
          <span className="flex flex-wrap gap-2">
            {items.map((a) => (
              <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" title={a.name} className="block size-16 overflow-hidden rounded-lg border border-border">
                <img src={a.url} alt={a.name} loading="lazy" className="size-full object-cover" />
              </a>
            ))}
          </span>
        )
      }
      return (
        <span className="flex flex-col gap-0.5">
          {items.map((a) => (
            <a key={a.id} href={`${a.url}?download=1`} download={a.name} className="truncate text-primary-text hover:underline">
              {a.name}
            </a>
          ))}
        </span>
      )
    }
    case 'textarea':
      return <span className="whitespace-pre-wrap break-words">{String(value)}</span>
    default:
      return <span className="break-words">{String(value)}</span>
  }
}
