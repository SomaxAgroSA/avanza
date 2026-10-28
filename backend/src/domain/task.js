/**
 * Regras de negócio de tarefas.
 *
 * Acesso = permissão global (RBAC) E acesso ao projeto da tarefa (ver domain/project.js):
 * - ver: quem enxerga o projeto e tem `tasks.view`; os demais recebem TASK_NOT_FOUND (anti-IDOR);
 * - criar/editar/atribuir: colaboradores do projeto (dono, gestor, membro ou `projects.view_all`);
 *   o papel "leitor" do projeto só consulta;
 * - excluir: `tasks.delete` + gestor do projeto (ou `projects.view_all`) ou o autor da tarefa.
 * Projeto arquivado fica somente leitura.
 */

const { extractMentions, plainText } = require('./mentions')
const { appError } = require('../core/errors')
const rbac = require('./rbac')
const cf = require('./custom-field')
const workflow = require('./workflow')

const ACTION_PERMISSION = {
  view: 'tasks.view',
  create: 'tasks.create',
  edit: 'tasks.edit',
  assign: 'tasks.assign',
  delete: 'tasks.delete',
  // relacionar tarefas e fazer fork (Fase 7)
  link: 'tasks.link',
  fork: 'tasks.fork',
}

function isContributor(access) {
  return access.viewAll || access.isOwner || access.role === 'manager' || access.role === 'member'
}

/** `task` só é necessário para `delete` ({ creatorId }). */
function assertTaskAccess(access, project, action, task) {
  const principal = access.principal
  if (!access.canView || !rbac.can(principal, 'tasks.view')) throw appError('TASK_NOT_FOUND')
  if (action === 'view') return
  const permission = ACTION_PERMISSION[action]
  if (!permission || !rbac.can(principal, permission) || !isContributor(access)) throw appError('FORBIDDEN')
  if (action === 'delete' && !(access.isManager || (task && principal && task.creatorId === principal.userId))) throw appError('FORBIDDEN')
  if (project.archivedAt) throw appError('PROJECT_ARCHIVED')
}

function allowed(access, project, action, task) {
  try {
    assertTaskAccess(access, project, action, task)
    return true
  } catch (_) {
    return false
  }
}

/** O que o usuário atual pode fazer com a tarefa (a interface habilita as ações). */
function taskCapabilities(access, project, task) {
  let comment = true
  try {
    assertCommentAccess(access, project, 'create')
  } catch (_) {
    comment = false
  }
  return {
    edit: allowed(access, project, 'edit', task),
    delete: allowed(access, project, 'delete', task),
    assign: allowed(access, project, 'assign', task),
    link: allowed(access, project, 'link', task),
    fork: allowed(access, project, 'fork', task),
    comment,
  }
}

/** Pode ser responsável: dono ou membro do projeto que não seja só leitor. */
function canBeAssignee(project, membership, userId) {
  return project.ownerId === userId || (!!membership && membership.role !== 'viewer')
}

function taskCode(projectKey, number) {
  return `${projectKey}-${number}`
}

/**
 * Datas derivadas da categoria do status:
 * - `started_at`: primeira vez em andamento (ou já encerrada sem ter passado por lá); nunca é apagada;
 * - `completed_at`: ao entrar em concluída/cancelada; limpa ao reabrir.
 */
function statusDates(current, fromCategory, toCategory, now) {
  let startedAt = current.startedAt || null
  let completedAt = current.completedAt || null
  const closed = workflow.isClosedCategory(toCategory)
  if (!startedAt && (toCategory === 'in_progress' || closed)) startedAt = now
  if (closed && !workflow.isClosedCategory(fromCategory)) completedAt = now
  if (!closed) completedAt = null
  return { startedAt, completedAt }
}

function sameValue(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b)
}

/**
 * Campo exigido no status (diretriz §9): obrigatório sempre (`required`) ou só nos status marcados no tipo
 * (`required_status_ids`). Campo oculto nunca é exigido.
 */
function requiredIn(link, statusId) {
  if (!link || link.visible === false) return false
  if (link.required) return true
  return !!statusId && Array.isArray(link.required_status_ids) && link.required_status_ids.indexOf(statusId) >= 0
}

/**
 * Valida os valores de campos personalizados de uma tarefa.
 * - `links`: campos do tipo ({ field (DTO com id, name, type, config, options), required, visible });
 * - `raw`: valores enviados, por nome técnico do campo (ausente = mantém o atual);
 * - `current`: valores salvos, por ID do campo.
 * - `statusId`: status em que a tarefa vai ficar — soma os campos exigidos nesse status.
 * Retorna { values (por ID, já normalizados; null = vazio), errors (por nome) }.
 * Valores que não mudaram não são revalidados (ex.: opção desativada depois de escolhida).
 */
function validateCustomValues(links, raw, current, statusId) {
  const input = raw || {}
  const saved = current || {}
  const values = {}
  const errors = {}
  const byName = {}
  links.forEach((link) => {
    byName[link.field.name] = link
  })
  Object.keys(input).forEach((name) => {
    if (!byName[name]) errors[name] = 'unknown_field'
  })

  links.forEach((link) => {
    const field = link.field
    const provided = Object.prototype.hasOwnProperty.call(input, field.name)
    const previous = saved[field.id] === undefined ? null : saved[field.id]
    let value = previous
    if (provided && !sameValue(input[field.name], previous)) {
      const result = cf.validateValue(field, input[field.name])
      if (result.error) {
        errors[field.name] = result.error
        return
      }
      value = result.value
    }
    if (requiredIn(link, statusId) && cf.isEmptyValue(value)) {
      errors[field.name] = 'required'
      return
    }
    if (!cf.isEmptyValue(value)) values[field.id] = value
  })
  return { values, errors }
}

// ---------------------------------------------------------------- checklist

const MAX_CHECKLIST = 100
const MAX_ITEM_TEXT = 300

/**
 * Normaliza o checklist enviado: [{ id?, text, done? }]. `newId()` gera IDs para itens novos
 * (ou com ID repetido). Retorna { value } ou { error }.
 */
function normalizeChecklist(raw, newId) {
  if (!Array.isArray(raw)) return { error: 'invalid_type' }
  if (raw.length > MAX_CHECKLIST) return { error: 'too_many' }
  const seen = []
  const items = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] && typeof raw[i] === 'object' ? raw[i] : null
    if (!item || typeof item.text !== 'string') return { error: 'invalid_type' }
    const text = item.text.trim()
    if (!text) return { error: 'item_text_required' }
    if (text.length > MAX_ITEM_TEXT) return { error: 'too_long' }
    if (item.done !== undefined && typeof item.done !== 'boolean') return { error: 'invalid_type' }
    let id = typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(item.id) ? item.id : ''
    if (!id || seen.indexOf(id) >= 0) id = newId()
    seen.push(id)
    items.push({ id, text, done: item.done === true })
  }
  return { value: items }
}

/** Checklist legível para o histórico ("✓ feito", "○ pendente"). */
function checklistSummary(items) {
  return (items || []).map((item) => `${item.done ? '✓' : '○'} ${item.text}`)
}

// ---------------------------------------------------------------- comentários

/**
 * Comentários (regra do produto, diretriz §18): qualquer pessoa com acesso ao projeto comenta,
 * inclusive o papel "leitor"; só o autor edita; o autor ou o gestor do projeto exclui.
 * Comentário excluído (lógico) se comporta como inexistente para edição/exclusão.
 */
function assertCommentAccess(access, project, action, comment) {
  const principal = access.principal
  if (!access.canView || !rbac.can(principal, 'tasks.view')) throw appError('TASK_NOT_FOUND')
  if (comment && comment.deletedAt) throw appError('COMMENT_NOT_FOUND')
  const isAuthor = !!comment && !!principal && comment.userId === principal.userId
  if (action === 'edit' && !isAuthor) throw appError('FORBIDDEN')
  if (action === 'delete' && !isAuthor && !access.isManager) throw appError('FORBIDDEN')
  if (project.archivedAt) throw appError('PROJECT_ARCHIVED')
}

function commentCapabilities(access, project, comment) {
  const can = (action) => {
    try {
      assertCommentAccess(access, project, action, comment)
      return true
    } catch (_) {
      return false
    }
  }
  return { edit: can('edit'), delete: can('delete') }
}

// ---------------------------------------------------------------- menções (domain/mentions.js)

// ---------------------------------------------------------------- tags

/** Chave de unicidade da tag: minúsculas, sem acentos e espaços nas pontas. */
function tagKey(name) {
  return String(name || '')
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function tagNameIssue(name) {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!value) return 'required'
  return value.length > 40 ? 'too_long' : null
}

module.exports = {
  normalizeChecklist,
  checklistSummary,
  assertCommentAccess,
  commentCapabilities,
  extractMentions,
  plainText,
  tagKey,
  tagNameIssue,
  assertTaskAccess,
  taskCapabilities,
  canBeAssignee,
  taskCode,
  statusDates,
  requiredIn,
  validateCustomValues,
}
