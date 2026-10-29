/**
 * Preferências por pessoa (regras de negócio §27). Só chaves conhecidas, cada uma com o seu formato:
 *
 * - `project_filter.<tela>`: configurador do filtro de projetos daquela tela — `statuses` (status do
 *   projeto que aparecem; vazio = todos) e `members_only` (só os projetos de que a pessoa participa).
 *   Telas: kanban, planning (Planejamento), plan (Gestão de projetos), timeline, tasks, reports, executive.
 *
 * `normalizePreference(key, value)` → `{ value }` (formato limpo) ou `{ fields }` (erros por campo, com os
 * códigos da API). `value` nulo = voltar ao padrão.
 */

const { PROJECT_STATUS } = require('./project')

const PROJECT_FILTER_SCREENS = Object.freeze(['kanban', 'planning', 'plan', 'timeline', 'tasks', 'reports', 'executive'])
const PROJECT_FILTER_PREFIX = 'project_filter.'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isKnownKey(key) {
  return typeof key === 'string' && key.indexOf(PROJECT_FILTER_PREFIX) === 0 && PROJECT_FILTER_SCREENS.indexOf(key.slice(PROJECT_FILTER_PREFIX.length)) >= 0
}

function normalizeProjectFilter(value) {
  if (!isObject(value)) return { fields: { value: 'invalid_type' } }
  const fields = {}
  Object.keys(value).forEach((key) => {
    if (key !== 'statuses' && key !== 'members_only') fields[`value.${key}`] = 'unknown_field'
  })
  const statuses = value.statuses === undefined ? [] : value.statuses
  if (!Array.isArray(statuses) || statuses.some((s) => typeof s !== 'string')) fields['value.statuses'] = 'invalid_type'
  else if (statuses.some((s) => PROJECT_STATUS.indexOf(s) < 0)) fields['value.statuses'] = 'invalid_option'
  const membersOnly = value.members_only === undefined ? false : value.members_only
  if (typeof membersOnly !== 'boolean') fields['value.members_only'] = 'invalid_type'
  if (Object.keys(fields).length > 0) return { fields }
  // na ordem do fluxo, sem repetir
  return { value: { statuses: PROJECT_STATUS.filter((s) => statuses.indexOf(s) >= 0), members_only: membersOnly } }
}

function normalizePreference(key, value) {
  if (!isKnownKey(key)) return { fields: { key: 'invalid_option' } }
  if (value === null) return { value: null }
  return normalizeProjectFilter(value)
}

module.exports = { PROJECT_FILTER_SCREENS, PROJECT_FILTER_PREFIX, isKnownKey, normalizePreference }
