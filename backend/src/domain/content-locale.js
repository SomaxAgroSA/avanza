/**
 * Cadastros traduzidos (pedido do usuário em 2026-09-30; hoje: tipos de tarefa).
 *
 * O texto gravado no próprio cadastro é o **original em pt-BR** (editável como sempre). Cada item pode
 * ter `translations = { en: { name, description }, es: {…} }`; o que faltar usa o original. O idioma
 * vem da requisição (Accept-Language enviado pelo app, que acompanha o idioma escolhido na tela).
 */

const BASE_LOCALE = 'pt-BR'
const TRANSLATED_LOCALES = Object.freeze(['en', 'es'])
const LOCALES = Object.freeze([BASE_LOCALE].concat(TRANSLATED_LOCALES))

/** Primeiro idioma suportado do Accept-Language ("es-ES,es;q=0.9" → "es"); padrão pt-BR. */
function resolveLocale(header) {
  const parts = String(header || '')
    .split(',')
    .map((part) => part.split(';')[0].trim().toLowerCase())
    .filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const lang = parts[i].split('-')[0]
    if (lang === 'pt') return BASE_LOCALE
    if (TRANSLATED_LOCALES.indexOf(lang) >= 0) return lang
  }
  return BASE_LOCALE
}

/** Campos no idioma pedido; tradução vazia ou ausente usa o original. */
function localize(entity, locale, fields) {
  const version = locale && locale !== BASE_LOCALE && entity.translations ? entity.translations[locale] || {} : {}
  const out = {}
  fields.forEach((field) => {
    const translated = version[field]
    out[field] = typeof translated === 'string' && translated.trim() ? translated : entity[field] || ''
  })
  return out
}

/** Todas as versões para a tela de edição: original (pt-BR) + en/es ('' = sem tradução). */
function allVersions(entity, fields) {
  const out = {}
  LOCALES.forEach((locale) => {
    const source = locale === BASE_LOCALE ? entity : (entity.translations || {})[locale] || {}
    out[locale] = {}
    fields.forEach((field) => {
      out[locale][field] = typeof source[field] === 'string' ? source[field] : ''
    })
  })
  return out
}

/**
 * Valida `translations` vindo da API: só en/es, só os campos de `limits` (campo → tamanho máximo),
 * textos aparados; vazios são descartados. Retorna { value } ou { error }.
 */
function normalizeTranslations(raw, limits) {
  if (raw === undefined || raw === null) return { value: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'invalid_type' }
  const value = {}
  const locales = Object.keys(raw)
  for (let i = 0; i < locales.length; i++) {
    const locale = locales[i]
    if (TRANSLATED_LOCALES.indexOf(locale) < 0) return { error: 'invalid_locale' }
    const version = raw[locale]
    if (version === null || version === undefined) continue
    if (typeof version !== 'object' || Array.isArray(version)) return { error: 'invalid_type' }
    const fields = Object.keys(version)
    const clean = {}
    for (let j = 0; j < fields.length; j++) {
      const field = fields[j]
      if (!limits[field]) return { error: 'invalid_type' }
      const text = version[field]
      if (text === null || text === undefined) continue
      if (typeof text !== 'string') return { error: 'invalid_type' }
      const trimmed = text.trim()
      if (trimmed.length > limits[field]) return { error: 'too_long' }
      if (trimmed) clean[field] = trimmed
    }
    if (Object.keys(clean).length > 0) value[locale] = clean
  }
  return { value }
}

module.exports = { BASE_LOCALE, TRANSLATED_LOCALES, LOCALES, resolveLocale, localize, allVersions, normalizeTranslations }
