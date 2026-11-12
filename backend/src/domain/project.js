/**
 * Regras de negócio de projetos.
 *
 * Acesso a um projeto = permissão global (RBAC) E vínculo com o projeto:
 * - enxerga: membro, dono ou quem tem `projects.view_all`;
 * - administra (editar, membros, arquivar): gestor do projeto (o dono é gestor) ou `projects.view_all`;
 * - transfere a posse / exclui: dono ou `projects.view_all`; excluir só projeto arquivado.
 * Quem não enxerga recebe PROJECT_NOT_FOUND (não confirma a existência — proteção contra IDOR).
 *
 * Responsável TI (papel `it`, regras §33): membro "limitado" — fora de tudo por padrão (`canView` falso),
 * só o resumo do projeto (`brief`), a ficha se o perfil tiver a seção e as tarefas visíveis a ele
 * (domain/task.js#scopedAccess). Dono, gestor e `projects.view_all` nunca ficam limitados.
 * Seções do projeto (regras §35): o perfil decide o que a pessoa vê dentro de cada projeto
 * (`projects.charter|history|members|report`); o dono vê todas.
 */

const { appError } = require('../core/errors')
const rbac = require('./rbac')

const PROJECT_STATUS = Object.freeze(['planning', 'active', 'paused', 'completed', 'cancelled'])
const PROJECT_PRIORITY = Object.freeze(['low', 'medium', 'high', 'critical'])
/**
 * Visões da lista de projetos: all, mine, archived e as duas por andamento (só projetos abertos) —
 * ongoing = em andamento (planejamento, em curso, pausado); finished = terminados (concluído, cancelado).
 */
const PROJECT_VIEWS = Object.freeze(['all', 'mine', 'ongoing', 'finished', 'archived'])
const VIEW_STATUSES = Object.freeze({
  ongoing: Object.freeze(['planning', 'active', 'paused']),
  finished: Object.freeze(['completed', 'cancelled']),
})
/** `it` = Responsável TI (§33): só vê o resumo do projeto e as tarefas atribuídas a ele ou marcadas para TI. */
const MEMBER_ROLES = Object.freeze(['manager', 'member', 'viewer', 'it'])
/** Seções do projeto liberadas pelo perfil (§35); a visão geral sempre aparece. */
const PROJECT_SECTIONS = Object.freeze(['charter', 'history', 'members', 'report'])
const PROJECT_ICONS = Object.freeze([
  'folder', 'rocket', 'briefcase', 'code', 'database', 'globe', 'shield', 'users', 'chart', 'settings',
  'layers', 'zap', 'star', 'box', 'truck', 'building', 'cpu', 'headphones', 'book', 'target',
])
const PROJECT_COVERS = Object.freeze(['violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'slate'])

/**
 * Cor de projeto única (regras §24): cada projeto principal tem a sua cor, e o subprojeto usa a cor e o
 * ícone do pai. Ordem em que as cores livres são sugeridas: os nomes da paleta e depois tons escuros bem
 * separados (o ícone é branco sobre a cor). Acabando a lista, um tom gerado pelo ângulo áureo.
 */
const COVER_SEQUENCE = Object.freeze(PROJECT_COVERS.concat([
  '#be185d', '#0369a1', '#7e22ce', '#a16207', '#047857', '#9a3412', '#4338ca', '#0e7490', '#a21caf', '#365314',
  '#1e3a8a', '#7f1d1d', '#155e75', '#581c87', '#854d0e', '#166534', '#9d174d', '#3730a3', '#78350f', '#334155',
  '#0f766e', '#c2410c', '#6d28d9', '#14532d', '#831843', '#0c4a6e', '#b45309', '#1d4ed8', '#be123c', '#4d7c0f',
]))

function hslHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** Primeira cor que nenhum outro projeto usa (`used`: cores dos outros projetos, sem o próprio e seus subprojetos). */
function freeCover(used) {
  const taken = new Set((used || []).filter(Boolean).map((c) => String(c).toLowerCase()))
  for (const cover of COVER_SEQUENCE) if (!taken.has(cover)) return cover
  for (let i = 0; i < 1000; i++) {
    const hex = hslHex((i * 137.508) % 360, 0.6, 0.32 + (i % 3) * 0.04)
    if (!taken.has(hex)) return hex
  }
  return COVER_SEQUENCE[0]
}

/** A cor já é de outro projeto? */
function coverInUse(cover, used) {
  return !!cover && (used || []).some((c) => c && String(c).toLowerCase() === String(cover).toLowerCase())
}

const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

function normalizeKey(key) {
  return String(key || '').trim().toUpperCase()
}

function keyIssue(key) {
  return KEY_PATTERN.test(key) ? null : 'invalid_format'
}

function datesIssue(start, due) {
  if (start && due && due.getTime() < start.getTime()) return 'due_before_start'
  return null
}

/** Calcula o vínculo do principal com o projeto. `membership` = { role } ou null. */
function resolveAccess(principal, project, membership) {
  const viewAll = rbac.can(principal, 'projects.view_all')
  const isOwner = !!principal && project.ownerId === principal.userId
  const memberRole = membership ? membership.role : null
  // Responsável TI: fora de tudo por padrão (canView = false); só o resumo e o que é dele
  const limited = !viewAll && !isOwner && memberRole === 'it' && rbac.can(principal, 'projects.view')
  return {
    principal,
    viewAll,
    isOwner,
    role: isOwner ? 'owner' : memberRole,
    isManager: isOwner || memberRole === 'manager' || viewAll,
    limited,
    canView: rbac.can(principal, 'projects.view') && (viewAll || isOwner || (!!membership && !limited)),
    get canEdit() {
      return this.canView && rbac.can(principal, 'projects.edit') && this.isManager && !project.archivedAt
    },
  }
}

/**
 * Projeto pai (§34), um só nível: devolve o motivo de recusa ou null.
 * `project` = projeto que recebe o pai (null na criação); `parent` = o pai escolhido, só se a pessoa
 * pode editá-lo (senão null); `hasChildren` = o projeto já é pai de alguém.
 */
function parentIssue(project, parent, hasChildren) {
  if (!parent) return 'invalid_option'
  if (project && parent.id === project.id) return 'self'
  if (parent.parentId) return 'parent_is_child'
  if (hasChildren) return 'has_children'
  if (parent.archivedAt) return 'parent_archived'
  return null
}

/**
 * Quem vê o projeto vê a seção se o perfil tem `projects.<seção>`; o dono do projeto sempre vê tudo.
 * O Responsável TI (§33) só pode ganhar a ficha, se o perfil dele tiver `projects.charter`.
 */
function canSeeSection(access, section) {
  if (PROJECT_SECTIONS.indexOf(section) < 0) return false
  if (access.limited) return section === 'charter' && rbac.can(access.principal, 'projects.charter')
  return !!access.canView && (access.isOwner || rbac.can(access.principal, `projects.${section}`))
}

/**
 * Verifica se a ação é permitida; lança o erro adequado caso contrário.
 * Ações: brief | view | charter | history | members | report | edit | manage_members | archive | transfer | delete
 * (`brief` = resumo do projeto, também do Responsável TI; as seções respondem FORBIDDEN para quem vê o
 * projeto sem a seção; gerenciar membros também exige a seção Membros).
 */
function assertAccess(access, project, action) {
  if (action === 'brief') {
    if (!access.canView && !access.limited) throw appError('PROJECT_NOT_FOUND')
    return
  }
  if (PROJECT_SECTIONS.indexOf(action) >= 0) {
    if (!access.canView && !access.limited) throw appError('PROJECT_NOT_FOUND')
    if (!canSeeSection(access, action)) throw appError('FORBIDDEN')
    return
  }
  if (!access.canView) throw appError('PROJECT_NOT_FOUND')
  if (action === 'view') return

  const principal = access.principal
  const archived = !!project.archivedAt

  if (action === 'edit' || action === 'manage_members' || action === 'archive') {
    if (!rbac.can(principal, 'projects.edit') || !access.isManager) throw appError('FORBIDDEN')
    if (action === 'manage_members' && !canSeeSection(access, 'members')) throw appError('FORBIDDEN')
    if (archived && action !== 'archive') throw appError('PROJECT_ARCHIVED')
    return
  }
  if (action === 'transfer') {
    if (!rbac.can(principal, 'projects.edit') || !(access.isOwner || access.viewAll)) throw appError('FORBIDDEN')
    if (archived) throw appError('PROJECT_ARCHIVED')
    return
  }
  if (action === 'delete') {
    if (!rbac.can(principal, 'projects.delete') || !(access.isOwner || access.viewAll)) throw appError('FORBIDDEN')
    if (!archived) throw appError('PROJECT_NOT_ARCHIVED')
    return
  }
  throw appError('FORBIDDEN')
}

function allowed(access, project, action) {
  try {
    assertAccess(access, project, action)
    return true
  } catch (_) {
    return false
  }
}

/**
 * Arquivos do projeto (regras de negócio §22), com a regra dos anexos das tarefas: ver e baixar = quem
 * vê o projeto; enviar = `tasks.edit` + colaborar (dono, gestor, membro ou quem vê todos os projetos);
 * excluir = quem enviou ou o gestor. Projeto arquivado é só leitura.
 * Ações: view | upload | delete (`file` = { uploadedBy } no delete).
 */
function assertFileAccess(access, project, action, file) {
  if (!access.canView) throw appError('PROJECT_NOT_FOUND')
  if (action === 'view') return
  const principal = access.principal
  const contributor = access.viewAll || access.isOwner || access.role === 'manager' || access.role === 'member'
  if (!rbac.can(principal, 'tasks.edit') || !contributor) throw appError('FORBIDDEN')
  if (action === 'delete' && !(access.isManager || (file && principal && file.uploadedBy === principal.userId))) throw appError('FORBIDDEN')
  if (project.archivedAt) throw appError('PROJECT_ARCHIVED')
}

function allowedFile(access, project, action, file) {
  try {
    assertFileAccess(access, project, action, file)
    return true
  } catch (_) {
    return false
  }
}

/** Capacidades do usuário atual no projeto (a interface usa para habilitar ações). */
function capabilities(access, project) {
  return {
    edit: allowed(access, project, 'edit'),
    manage_members: allowed(access, project, 'manage_members'),
    archive: allowed(access, project, 'archive'),
    delete: allowed(access, project, 'delete'),
    transfer: allowed(access, project, 'transfer'),
    upload_files: allowedFile(access, project, 'upload'),
    sections: PROJECT_SECTIONS.filter((section) => canSeeSection(access, section)),
  }
}

module.exports = {
  PROJECT_STATUS,
  PROJECT_PRIORITY,
  PROJECT_VIEWS,
  VIEW_STATUSES,
  MEMBER_ROLES,
  PROJECT_SECTIONS,
  PROJECT_ICONS,
  PROJECT_COVERS,
  COVER_SEQUENCE,
  freeCover,
  coverInUse,
  normalizeKey,
  keyIssue,
  datesIssue,
  parentIssue,
  canSeeSection,
  resolveAccess,
  assertAccess,
  assertFileAccess,
  capabilities,
}
