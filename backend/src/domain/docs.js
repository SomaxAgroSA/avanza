/**
 * Espaços de documentação (expansão, Onda 2 — docs/roadmap-expansao.md).
 *
 * - Espaço da empresa (sem projeto) ou de um projeto. Visibilidade: `company` (qualquer pessoa com
 *   `docs.view`) ou `project` (só quem vê o projeto). Espaço sem projeto é sempre da empresa.
 * - Ler: `docs.view` + visibilidade. Editar páginas: `docs.edit` (+ colaborar no projeto, se for de
 *   projeto). Configurar o espaço: `docs.manage` (+ gestor do projeto, se for de projeto).
 * - Páginas nunca publicadas (rascunho) só aparecem para quem edita.
 */

const rbac = require('./rbac')

const SPACE_VISIBILITIES = Object.freeze(['company', 'project'])
const PAGE_STATUSES = Object.freeze(['draft', 'published'])
const SPACE_ICONS = Object.freeze(['book', 'file-text', 'layers', 'settings', 'shield', 'users', 'rocket', 'target', 'code', 'database', 'globe', 'briefcase'])
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

function spaceKeyIssue(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key) ? null : 'invalid_format'
}

function visibilityIssue(visibility, projectId) {
  if (SPACE_VISIBILITIES.indexOf(visibility) < 0) return 'invalid_option'
  if (visibility === 'project' && !projectId) return 'project_required'
  return null
}

function isContributor(projectAccess) {
  return !!(projectAccess && projectAccess.canView && (projectAccess.viewAll || projectAccess.isOwner || projectAccess.role === 'manager' || projectAccess.role === 'member'))
}

/** `projectAccess`: resolveAccess do projeto do espaço (null quando o espaço é da empresa). */
function spaceAccess(principal, space, projectAccess) {
  const inProject = !!space.projectId
  const seesProject = !!(projectAccess && projectAccess.canView)
  const canRead = rbac.can(principal, 'docs.view') && (space.visibility === 'company' || seesProject)
  const canEdit = canRead && rbac.can(principal, 'docs.edit') && (!inProject || isContributor(projectAccess))
  const canManage = canRead && rbac.can(principal, 'docs.manage') && (!inProject || !!(seesProject && projectAccess.isManager))
  return { canRead, canEdit, canManage }
}

/** Página visível: publicada (quem lê) ou rascunho nunca publicado (só quem edita). */
function canSeePage(access, page) {
  if (!access.canRead) return false
  return page.status === 'published' || access.canEdit
}

module.exports = { SPACE_VISIBILITIES, PAGE_STATUSES, SPACE_ICONS, spaceKeyIssue, visibilityIssue, spaceAccess, canSeePage }
