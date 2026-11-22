/**
 * Configurador geral da plataforma (regras de negócio §15): retenção do histórico, bloqueio de login,
 * política de senha e identidade (nome, logo e ícone do navegador). Também guarda as "Dependências por
 * área" (§42, `dependency_areas`; a área TI ainda espelha a lista antiga `it_people`), editadas por rotas
 * próprias com `settings.manage`, o interruptor do Panorama (§26.2, `panorama_enabled`) e os nomes das
 * colunas das tabelas para todos (§44, `table_column_labels`: { tabela: { coluna: nome } }, um texto só para
 * os três idiomas), com rota própria.
 *
 * - Os padrões são os valores que antes ficavam fixos no código; valem até alguém mudar.
 * - Limites seguros: ninguém desliga uma proteção por engano (ex.: no mínimo 3 tentativas, senha de 8+).
 * - Letras e números na senha são sempre exigidos (piso); maiúsculas/minúsculas e símbolo são opcionais.
 */

const { PASSWORD_MAX } = require('./user')

/** Meses de permanência do histórico de auditoria; 0 = manter sempre. */
const RETENTION_MONTHS = Object.freeze([1, 3, 6, 12, 24, 0])

const DEFAULTS = Object.freeze({
  audit_retention_months: 3,
  lockout_threshold: 5,
  lockout_base_minutes: 5,
  lockout_max_minutes: 60,
  password_min_length: 10,
  password_require_mixed_case: false,
  password_require_symbol: false,
  platform_name: 'Avanza',
  /** Pessoas de TI (§42, lista antiga): a área TI enquanto `dependency_areas` não existe; depois, o espelho dela. */
  it_people: Object.freeze([]),
  /** Dependências por área (§42): [{ key, name, user_ids }]; null = ainda não configurada (vale `it_people`). */
  dependency_areas: null,
  /** Panorama (§26.2): desligado, some do menu de todos e o painel (GET /executive) não responde. */
  panorama_enabled: true,
  /** Nomes das colunas das tabelas para todos (§44): { tabela: { coluna: nome } }; vazio = os nomes do sistema. */
  table_column_labels: Object.freeze({}),
})

const LIMITS = Object.freeze({
  lockout_threshold: Object.freeze({ min: 3, max: 20 }),
  lockout_base_minutes: Object.freeze({ min: 1, max: 60 }),
  lockout_max_minutes: Object.freeze({ min: 1, max: 1440 }),
  password_min_length: Object.freeze({ min: 8, max: 64 }),
})
const NAME_MAX = 40
const IT_PEOPLE_MAX = 50
const ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/
const DEPENDENCY_AREAS_MAX = 20
const AREA_NAME_MAX = 40
const AREA_KEY_PATTERN = /^[a-z0-9_-]{1,32}$/
/** A área TI existe sempre: o Responsável TI de cada projeto pertence a ela (pode ser renomeada, não removida). */
const TI_AREA_KEY = 'ti'
const TI_AREA_NAME = 'TI'
/** Nomes das colunas (§44): id seguro da tabela e da coluna; nome até 40; tetos para o valor não crescer sem fim. */
const COLUMN_LABEL_MAX = 40
const COLUMN_LABELS_PER_TABLE_MAX = 80
const COLUMN_LABEL_TABLES_MAX = 100
const TABLE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

const INTEGER_KEYS = ['lockout_threshold', 'lockout_base_minutes', 'lockout_max_minutes', 'password_min_length']
const BOOLEAN_KEYS = ['password_require_mixed_case', 'password_require_symbol', 'panorama_enabled']
const KEYS = Object.keys(DEFAULTS)

/** Problema de um valor (null = válido). */
function valueIssue(key, value) {
  if (key === 'audit_retention_months') return RETENTION_MONTHS.indexOf(value) >= 0 ? null : 'invalid_option'
  if (INTEGER_KEYS.indexOf(key) >= 0) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'invalid_type'
    if (value < LIMITS[key].min) return 'too_small'
    return value > LIMITS[key].max ? 'too_large' : null
  }
  if (BOOLEAN_KEYS.indexOf(key) >= 0) return typeof value === 'boolean' ? null : 'invalid_type'
  if (key === 'platform_name') {
    if (typeof value !== 'string') return 'invalid_type'
    const name = value.trim()
    if (!name) return 'required'
    return name.length > NAME_MAX ? 'too_long' : null
  }
  if (key === 'it_people') {
    if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && ID_PATTERN.test(id))) return 'invalid_type'
    return value.length > IT_PEOPLE_MAX ? 'too_many' : null
  }
  if (key === 'dependency_areas') {
    if (!Array.isArray(value) || !value.every((a) => a && typeof a === 'object' && typeof a.key === 'string')) return 'invalid_type'
    // guardada: a TI pode faltar (resolveDependencyAreas a recoloca no topo)
    return validateDependencyAreas(value, { requireTi: false }).fields.areas || null
  }
  if (key === 'table_column_labels') return columnLabelsIssue(value)
  return 'unknown_field'
}

function clean(key, value) {
  if (key === 'it_people') return value.filter((id, i, all) => all.indexOf(id) === i)
  if (key === 'dependency_areas') return validateDependencyAreas(value, { requireTi: false }).areas
  if (key === 'table_column_labels') return cleanColumnLabels(value)
  return key === 'platform_name' ? value.trim() : value
}

// ------------------------------------------------------------------ nomes das colunas para todos (§44)

const isPlainObject = (value) => isObject(value) && !Array.isArray(value)

/** Mesmas chaves em ordem alfabética (o histórico e a comparação não dependem da ordem de chegada). */
function sortedKeys(source, map) {
  return Object.keys(source)
    .sort()
    .reduce((acc, key) => Object.assign(acc, { [key]: map(source[key]) }), {})
}

/**
 * Nomes de uma tabela `{ coluna: nome }` → { tableId, labels, fields }. `fields.table_id`: required,
 * invalid_format; `fields.labels`: invalid_type, invalid_format (id de coluna), too_long (> 40), too_many.
 * Nome vazio (ou só espaços) sai: a coluna volta ao nome do sistema.
 */
function validateTableColumnLabels(tableId, labels) {
  const fail = (field, code) => ({ tableId: '', labels: {}, fields: { [field]: code } })
  if (tableId === undefined || tableId === null || tableId === '') return fail('table_id', 'required')
  if (typeof tableId !== 'string' || !TABLE_ID_PATTERN.test(tableId)) return fail('table_id', 'invalid_format')
  if (!isPlainObject(labels)) return fail('labels', 'invalid_type')
  const out = {}
  for (const column of Object.keys(labels)) {
    if (!TABLE_ID_PATTERN.test(column)) return fail('labels', 'invalid_format')
    const value = labels[column]
    if (typeof value !== 'string') return fail('labels', 'invalid_type')
    const name = value.trim()
    if (name.length > COLUMN_LABEL_MAX) return fail('labels', 'too_long')
    if (name) out[column] = name
  }
  if (Object.keys(out).length > COLUMN_LABELS_PER_TABLE_MAX) return fail('labels', 'too_many')
  return { tableId, labels: sortedKeys(out, (name) => name), fields: {} }
}

function columnLabelsIssue(value) {
  if (!isPlainObject(value)) return 'invalid_type'
  const tables = Object.keys(value)
  if (tables.length > COLUMN_LABEL_TABLES_MAX) return 'too_many'
  const bad = tables.map((table) => validateTableColumnLabels(table, value[table]).fields).find((fields) => Object.keys(fields).length > 0)
  return bad ? bad.table_id || bad.labels : null
}

function cleanColumnLabels(value) {
  const out = {}
  Object.keys(value).forEach((table) => {
    const labels = validateTableColumnLabels(table, value[table]).labels
    if (Object.keys(labels).length > 0) out[table] = labels
  })
  return sortedKeys(out, (labels) => labels)
}

/**
 * Valores com os nomes de uma tabela trocados (`labels` já validados; vazio tira a tabela do mapa);
 * null quando a tabela é nova e já há 100 tabelas com nomes próprios.
 */
function withTableColumnLabels(values, tableId, labels) {
  const current = normalizeSettings(values)
  const map = Object.assign({}, current.table_column_labels)
  if (!map[tableId] && Object.keys(labels).length > 0 && Object.keys(map).length >= COLUMN_LABEL_TABLES_MAX) return null
  if (Object.keys(labels).length > 0) map[tableId] = labels
  else delete map[tableId]
  return Object.assign({}, current, { table_column_labels: sortedKeys(map, (l) => l) })
}

// ------------------------------------------------------------------ Dependências por área (§42)

/** Chave estável a partir do nome: "Finanças e Contabilidade" → "financas-e-contabilidade". */
function slugOf(name) {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
    .replace(/-+$/g, '')
  return slug || 'area'
}

/**
 * Lista inteira de áreas (`[{ key?, name, user_ids }]`, na ordem da tela) → { areas, fields }.
 * `fields.areas` (o primeiro problema): invalid_type, too_many, ti_required, name_required, name_too_long,
 * duplicate_name, too_many_people, duplicate_person. Área nova sem `key` ganha uma pelo nome (com sufixo -2,
 * -3… se repetir); a TI (`key: 'ti'`) é obrigatória; uma pessoa fica em uma área só.
 */
function validateDependencyAreas(list, options) {
  const requireTi = !options || options.requireTi !== false
  const fail = (code) => ({ areas: [], fields: { areas: code } })
  if (!Array.isArray(list)) return fail('invalid_type')
  if (list.length > DEPENDENCY_AREAS_MAX) return fail('too_many')
  const shaped = []
  for (const item of list) {
    if (!item || typeof item !== 'object') return fail('invalid_type')
    if (item.key !== undefined && item.key !== null && (typeof item.key !== 'string' || !AREA_KEY_PATTERN.test(item.key))) return fail('invalid_type')
    if (typeof item.name !== 'string') return fail(item.name === undefined || item.name === null ? 'name_required' : 'invalid_type')
    const ids = item.user_ids === undefined ? [] : item.user_ids
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && ID_PATTERN.test(id))) return fail('invalid_type')
    const name = item.name.trim()
    if (!name) return fail('name_required')
    if (name.length > AREA_NAME_MAX) return fail('name_too_long')
    const unique = ids.filter((id, i, all) => all.indexOf(id) === i)
    if (unique.length > IT_PEOPLE_MAX) return fail('too_many_people')
    shaped.push({ key: item.key || null, name, user_ids: unique })
  }
  if (requireTi && !shaped.some((a) => a.key === TI_AREA_KEY)) return fail('ti_required')
  const names = shaped.map((a) => a.name.toLocaleLowerCase('pt-BR'))
  if (names.some((n, i) => names.indexOf(n) !== i)) return fail('duplicate_name')
  const keys = shaped.filter((a) => a.key).map((a) => a.key)
  if (keys.some((k, i) => keys.indexOf(k) !== i)) return fail('duplicate_name')
  const people = shaped.reduce((all, a) => all.concat(a.user_ids), [])
  if (people.some((id, i) => people.indexOf(id) !== i)) return fail('duplicate_person')
  shaped.forEach((a) => {
    if (a.key) return
    const base = slugOf(a.name)
    let key = base
    for (let n = 2; keys.indexOf(key) >= 0; n++) key = `${base}-${n}`
    keys.push(key)
    a.key = key
  })
  return { areas: shaped, fields: {} }
}

/**
 * Áreas vigentes (valores já normalizados): a lista nova quando existe (com a TI no topo se faltar) ou,
 * antes de alguém salvar a tela nova, só a TI com as Pessoas de TI antigas (`it_people`).
 */
function resolveDependencyAreas(values) {
  const v = values || {}
  const legacy = { key: TI_AREA_KEY, name: TI_AREA_NAME, user_ids: (v.it_people || []).slice() }
  if (!Array.isArray(v.dependency_areas)) return [legacy]
  const areas = v.dependency_areas.map((a) => ({ key: a.key, name: a.name, user_ids: a.user_ids.slice() }))
  return areas.some((a) => a.key === TI_AREA_KEY) ? areas : [legacy].concat(areas)
}

const isObject = (value) => !!value && typeof value === 'object'
const same = (a, b) => (isObject(a) || isObject(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b)

/** Configurações guardadas → valores completos (o que faltar ou estiver inválido volta ao padrão). */
function normalizeSettings(stored) {
  const source = stored && typeof stored === 'object' ? stored : {}
  const out = {}
  KEYS.forEach((key) => {
    const value = source[key]
    out[key] = value !== undefined && valueIssue(key, value) === null ? clean(key, value) : DEFAULTS[key]
  })
  return out
}

/**
 * Alteração parcial sobre os valores atuais. Retorna { values, fields } — `fields` vazio = válido.
 * O teto do bloqueio é conferido contra o tempo inicial resultante (atual ou novo).
 */
function validateSettings(patch, current) {
  const fields = {}
  const values = Object.assign({}, normalizeSettings(current))
  Object.keys(patch || {}).forEach((key) => {
    const issue = valueIssue(key, patch[key])
    if (issue) fields[key] = issue
    else values[key] = clean(key, patch[key])
  })
  if (!fields.lockout_max_minutes && !fields.lockout_base_minutes && values.lockout_max_minutes < values.lockout_base_minutes) {
    fields.lockout_max_minutes = 'below_base'
  }
  return { values, fields }
}

/** { old, new } só com as chaves que mudaram (para o histórico); null se nada mudou. */
function diffSettings(before, after) {
  const changed = KEYS.filter((key) => !same(before[key], after[key]))
  if (changed.length === 0) return null
  const pick = (source) => changed.reduce((acc, key) => Object.assign(acc, { [key]: source[key] }), {})
  return { old: pick(before), new: pick(after) }
}

/** Data de corte do histórico (registros anteriores saem); null = manter sempre. */
function retentionCutoff(months, now) {
  if (!months) return null
  const cutoff = new Date(now.getTime())
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
  return cutoff
}

/** A mudança apaga mais do que antes? ("manter sempre" é o prazo mais longo.) */
function isShorterRetention(before, after) {
  const span = (months) => (months === 0 ? Infinity : months)
  return span(after) < span(before)
}

function passwordPolicy(values) {
  const v = normalizeSettings(values)
  return {
    min_length: v.password_min_length,
    max_length: PASSWORD_MAX,
    require_letters_numbers: true,
    require_mixed_case: v.password_require_mixed_case,
    require_symbol: v.password_require_symbol,
  }
}

function lockoutPolicy(values) {
  const v = normalizeSettings(values)
  return { threshold: v.lockout_threshold, baseMinutes: v.lockout_base_minutes, maxMinutes: v.lockout_max_minutes }
}

// ------------------------------------------------------------------ identidade (logo e ícone)

const BRANDING_SLOTS = Object.freeze(['logo_light', 'logo_dark', 'favicon'])
const BRANDING_MAX_BYTES = 1024 * 1024

/** extensão → { mime, family }; ICO só serve de ícone do navegador. */
const BRANDING_TYPES = {
  png: { mime: 'image/png', family: 'png' },
  jpg: { mime: 'image/jpeg', family: 'jpeg' },
  jpeg: { mime: 'image/jpeg', family: 'jpeg' },
  webp: { mime: 'image/webp', family: 'webp' },
  svg: { mime: 'image/svg+xml', family: 'svg' },
  ico: { mime: 'image/x-icon', family: 'ico', faviconOnly: true },
}
const BRANDING_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'])

function startsWith(bytes, signature, offset) {
  const at = offset || 0
  if (bytes.length < at + signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[at + i] !== signature[i]) return false
  }
  return true
}
const ascii = (text) => text.split('').map((c) => c.charCodeAt(0))

function bytesToText(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

/**
 * SVG aceito só sem nada ativo: script, atributos de evento, foreignObject/iframe/embed/object,
 * DOCTYPE/ENTITY, links javascript: e referências externas (só âncoras internas e data:image).
 * O arquivo também é servido com CSP sandbox e nosniff (segunda barreira).
 */
const SVG_FORBIDDEN = [
  /<\s*script/i,
  /\son[a-z]+\s*=/i,
  /<\s*(foreignObject|iframe|embed|object|audio|video)/i,
  /<!\s*(DOCTYPE|ENTITY)/i,
  /javascript\s*:/i,
  /(?:href|src)\s*=\s*["']?\s*(?!#|data:image\/)[a-z][a-z0-9+.-]*:/i,
  /url\(\s*["']?\s*(?!#|data:image\/)[a-z][a-z0-9+.-]*:/i,
  /@import/i,
]

function svgIssue(bytes) {
  const text = bytesToText(bytes)
  if (!/<svg[\s>]/i.test(text)) return 'type_mismatch'
  return SVG_FORBIDDEN.some((pattern) => pattern.test(text)) ? 'unsafe_svg' : null
}

function sniffFamily(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp'
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'ico'
  return null
}

/**
 * Classifica o arquivo de identidade pelo lugar, pelo nome e pelo conteúdo (SVG: o arquivo inteiro).
 * Retorna { mime, ext } ou { error: 'invalid_slot' | 'unsupported_type' | 'type_mismatch' | 'unsafe_svg' }.
 */
function classifyBranding(slot, name, bytes) {
  if (BRANDING_SLOTS.indexOf(slot) < 0) return { error: 'invalid_slot' }
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(String(name || ''))
  const ext = match ? match[1].toLowerCase() : ''
  const type = BRANDING_TYPES[ext]
  if (!type || (type.faviconOnly && slot !== 'favicon')) return { error: 'unsupported_type' }
  const content = bytes || []
  if (type.family === 'svg') {
    const issue = svgIssue(content)
    return issue ? { error: issue } : { mime: type.mime, ext }
  }
  return sniffFamily(content) === type.family ? { mime: type.mime, ext } : { error: 'type_mismatch' }
}

function brandingSizeIssue(size) {
  if (!size || size <= 0) return 'empty_file'
  return size > BRANDING_MAX_BYTES ? 'file_too_large' : null
}

module.exports = {
  RETENTION_MONTHS,
  DEFAULTS,
  LIMITS,
  NAME_MAX,
  IT_PEOPLE_MAX,
  DEPENDENCY_AREAS_MAX,
  AREA_NAME_MAX,
  TI_AREA_KEY,
  TI_AREA_NAME,
  COLUMN_LABEL_MAX,
  COLUMN_LABELS_PER_TABLE_MAX,
  COLUMN_LABEL_TABLES_MAX,
  validateTableColumnLabels,
  withTableColumnLabels,
  validateDependencyAreas,
  resolveDependencyAreas,
  BRANDING_SLOTS,
  BRANDING_MAX_BYTES,
  BRANDING_MIME_TYPES,
  normalizeSettings,
  validateSettings,
  diffSettings,
  retentionCutoff,
  isShorterRetention,
  passwordPolicy,
  lockoutPolicy,
  classifyBranding,
  brandingSizeIssue,
}
