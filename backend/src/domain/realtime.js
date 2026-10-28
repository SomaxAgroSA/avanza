/**
 * Tempo real (regras de negócio §19): quem está com um quadro, uma lista ou uma tarefa aberta recebe
 * um aviso quando algo muda e a tela se atualiza sozinha. O aviso leva só identificadores (coleção,
 * ação, id, projeto) — a tela busca os dados de novo pela API, que aplica as permissões de sempre.
 *
 * Tópicos: `project:{id}` (tudo do projeto) e `user:{id}` (as notificações da pessoa).
 */

const MAX_TOPICS = 50
const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/

/** Coleções que geram aviso (as demais, como sessões e histórico, nunca). */
const WATCHED = Object.freeze([
  'tasks',
  'comments',
  'attachments',
  'task_relations',
  'sprints',
  'project_milestones',
  'projects',
  'project_members',
  'project_groups',
  'plan_items',
  'plan_statuses',
  'plan_resources',
  'plan_item_links',
  'plan_item_updates',
  'plan_item_files',
  'plan_journal',
  'plan_issues',
  'plan_columns',
  'plan_settings',
  'notifications',
])

function projectTopic(id) {
  return `project:${id}`
}

function userTopic(id) {
  return `user:${id}`
}

/** { kind: 'project' | 'user', id } ou null (tópico desconhecido, incluindo assinaturas de coleção). */
function parseTopic(topic) {
  const match = /^(project|user):(.+)$/.exec(typeof topic === 'string' ? topic : '')
  if (!match || !ID_PATTERN.test(match[2])) return null
  return { kind: match[1], id: match[2] }
}

function normalizeTopics(topics) {
  return Array.from(new Set((topics || []).filter((t) => typeof t === 'string'))).slice(0, MAX_TOPICS)
}

/**
 * Aviso de uma mudança: { topic, payload } ou null (coleção não acompanhada ou sem destino).
 * `input`: { collection, action, id, projectId?, taskId?, itemId?, userId? }.
 */
function buildEvent(input) {
  if (WATCHED.indexOf(input.collection) < 0) return null
  const topic = input.collection === 'notifications' ? (input.userId ? userTopic(input.userId) : null) : input.projectId ? projectTopic(input.projectId) : null
  if (!topic) return null
  return {
    topic,
    payload: {
      collection: input.collection,
      action: input.action,
      id: input.id,
      project_id: input.projectId || null,
      task_id: input.collection === 'tasks' ? input.id : input.taskId || null,
      item_id: input.collection === 'plan_items' ? input.id : input.itemId || null,
    },
  }
}

module.exports = { MAX_TOPICS, WATCHED, projectTopic, userTopic, parseTopic, normalizeTopics, buildEvent }
