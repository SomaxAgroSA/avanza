/**
 * Infraestrutura do tempo real: registro gravado → mudança (com os campos que levam ao projeto) e o
 * envio pelo broker de assinaturas do PocketBase (SSE em /api/realtime) para quem assina o tópico.
 */

/** Onde cada coleção guarda o vínculo com o projeto, a tarefa, o elemento ou a pessoa. */
const LINKS = {
  tasks: { project: 'project_id' },
  comments: { task: 'task_id' },
  attachments: { task: 'task_id' },
  task_relations: { task: 'source_task_id' },
  sprints: { project: 'project_id' },
  project_milestones: { project: 'project_id' },
  projects: { self: true },
  project_members: { project: 'project_id' },
  project_groups: { project: 'project_id' },
  plan_items: { project: 'project_id' },
  plan_statuses: { project: 'project_id' },
  plan_resources: { project: 'project_id' },
  plan_item_links: { project: 'project_id' },
  plan_item_updates: { project: 'project_id', item: 'item_id' },
  plan_item_files: { project: 'project_id', item: 'item_id' },
  plan_journal: { project: 'project_id' },
  plan_issues: { project: 'project_id' },
  plan_columns: { project: 'project_id' },
  plan_settings: { project: 'project_id' },
  notifications: { user: 'user_id', task: 'task_id' },
}

function changeFromRecord(record, action) {
  const collection = record.collection().name
  const link = LINKS[collection]
  if (!link) return null
  const read = (field) => (field ? record.getString(field) || null : null)
  return {
    collection,
    action,
    id: record.id,
    projectId: link.self ? record.id : read(link.project),
    taskId: read(link.task),
    itemId: read(link.item),
    userId: read(link.user),
  }
}

/** Envia o aviso a cada conexão que assina o tópico. */
function broadcast(app, event) {
  const message = new SubscriptionMessage({ name: event.topic, data: JSON.stringify(event.payload) })
  app
    .subscriptionsBroker()
    .chunkedClients(300)
    .forEach((chunk) => {
      chunk.forEach((client) => {
        if (client.hasSubscription(event.topic)) client.send(message)
      })
    })
}

/** Nome do sinal de vida: não é tópico de ninguém, então o navegador ignora. */
const KEEPALIVE_EVENT = 'kamban_keepalive'

/**
 * Sinal de vida para todas as conexões: o PocketBase fecha a conexão SSE depois de 5 min sem
 * mensagens; o navegador reconecta, refaz as assinaturas e busca as telas de novo — com centenas de
 * pessoas paradas lendo, isso vira carga à toa (e o aviso "Reconectando…" pisca).
 */
function keepAlive(app) {
  const message = new SubscriptionMessage({ name: KEEPALIVE_EVENT, data: '{}' })
  let sent = 0
  app
    .subscriptionsBroker()
    .chunkedClients(300)
    .forEach((chunk) => {
      chunk.forEach((client) => {
        client.send(message)
        sent++
      })
    })
  return sent
}

module.exports = { LINKS, KEEPALIVE_EVENT, changeFromRecord, broadcast, keepAlive }
