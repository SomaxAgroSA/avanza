/**
 * Importação de elementos para o quadro (Gerenciamento de Projetos, GP-2).
 *
 * O navegador lê a planilha (CSV) e manda as linhas já separadas por coluna; aqui cada linha é
 * validada com as mesmas regras do elemento. Grupo, status e recursos vêm pelo **nome** (o caso de
 * uso resolve: existentes são usados; os que faltam são criados conforme a permissão). Linha com
 * `parent` é subelemento do elemento com esse nome no mesmo grupo. Tudo ou nada: qualquer linha com
 * problema cancela a importação e a resposta aponta a linha e o campo.
 */

const plan = require('./plan')

const MAX_IMPORT_ROWS = 500

const text = (value) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '')

/** `{ issues: { [índice]: { campo: código } } | { rows: código }, rows }` */
function importRows(input) {
  if (!Array.isArray(input) || input.length === 0) return { issues: { rows: 'required' }, rows: [] }
  if (input.length > MAX_IMPORT_ROWS) return { issues: { rows: 'too_many' }, rows: [] }
  const issues = {}
  const rows = input.map((raw, index) => {
    const source = raw && typeof raw === 'object' ? raw : {}
    const rowIssues = {}
    const group = text(source.group)
    if (!group) rowIssues.group = 'required'
    else if (group.length > plan.GROUP_NAME_MAX) rowIssues.group = 'too_long'
    const parent = text(source.parent) || null
    const status = text(source.status) || null
    if (status && status.length > plan.STATUS_NAME_MAX) rowIssues.status = 'too_long'

    const names = Array.isArray(source.resources) ? source.resources.map(text).filter(Boolean) : []
    const resources = names.filter((name, i) => names.findIndex((n) => plan.nameKey(n) === plan.nameKey(name)) === i)
    if (resources.some((name) => name.length > plan.RESOURCE_NAME_MAX)) rowIssues.resources = 'too_long'
    else if (resources.length > plan.MAX_RESOURCES) rowIssues.resources = 'too_many'

    const fields = {}
    ;['start_date', 'end_date', 'estimated_hours', 'actual_hours', 'duration_days', 'progress'].forEach((key) => {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') fields[key] = source[key]
    })
    const checked = plan.itemInput(Object.assign({ name: source.name }, fields), false)
    Object.assign(rowIssues, checked.issues)
    const dates = plan.datesIssue(checked.data.start_date || null, checked.data.end_date || null)
    if (dates) rowIssues.end_date = dates
    if (Object.keys(rowIssues).length > 0) issues[index] = rowIssues

    const data = Object.assign({}, checked.data)
    delete data.name
    return { index, group, parent, name: checked.data.name || text(source.name), status, resources, data }
  })
  return { issues, rows }
}

module.exports = { MAX_IMPORT_ROWS, importRows }
