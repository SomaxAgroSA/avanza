/**
 * Formatação dependente de idioma (Intl). Sempre recebe o idioma atual explicitamente.
 */

export function formatDateTime(date: Date | null | undefined, locale: string): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/**
 * Data e hora curtas no fuso de quem olha (prazos com hora, abertura): "21/11 17:00"; fora do ano de
 * `now`, com o ano ("04/01/27 09:30").
 */
export function formatShortDateTime(date: Date | null | undefined, locale: string, now: Date = new Date()): string {
  if (!date) return '—'
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', ...(sameYear ? {} : { year: '2-digit' }), hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

export function formatDate(date: Date | null | undefined, locale: string): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

/**
 * Datas "somente dia" (ex.: prazo de projeto) chegam como meia-noite UTC.
 * Formatar em UTC evita mostrar o dia anterior em fusos negativos (ex.: Brasil).
 */
export function formatDay(date: Date | null | undefined, locale: string): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

/** Date -> "AAAA-MM-DD" (valor de <input type="date">), em UTC. */
export function toDayInput(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : ''
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value)
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/** "há 5 minutos", "em 2 dias"... */
export function formatRelative(date: Date | null | undefined, locale: string, now: Date = new Date()): string {
  if (!date) return '—'
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(0, 'minute')
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}
