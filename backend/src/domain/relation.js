/**
 * Relacionamentos entre tarefas (diretriz §12 e §13).
 *
 * - Gravados em `task_relations` só quatro tipos, sempre de "origem" para "destino":
 *   relates (Relacionado a), blocks (Bloqueia), duplicates (Duplicado de), depends_on (Depende de).
 *   Os inversos (Bloqueado por, Duplicado em, Dependência de) são a mesma relação vista do outro lado.
 * - Pai/Filho = subtarefas (`tasks.parent_task_id`); Fork de = `tasks.forked_from_task_id`.
 * - Bloqueios e dependências formam um grafo de precedência ("vem antes") que não pode ter ciclo.
 */

const RELATION_TYPES = Object.freeze(['relates', 'blocks', 'duplicates', 'depends_on'])

/** Tipos aceitos na API, do ponto de vista da tarefa em que a relação é criada. */
const INPUT_TYPES = Object.freeze({
  relates: { type: 'relates', swap: false },
  blocks: { type: 'blocks', swap: false },
  blocked_by: { type: 'blocks', swap: true },
  duplicates: { type: 'duplicates', swap: false },
  duplicated_by: { type: 'duplicates', swap: true },
  depends_on: { type: 'depends_on', swap: false },
  dependency_of: { type: 'depends_on', swap: true },
})
const VIEW_TYPES = Object.freeze(Object.keys(INPUT_TYPES))

const INVERSE = Object.freeze({ relates: 'relates', blocks: 'blocked_by', duplicates: 'duplicated_by', depends_on: 'dependency_of' })

/** Tipos em que a ordem dos lados não importa para saber se já existe. */
const SYMMETRIC_FOR_DUPLICATES = Object.freeze(['relates', 'duplicates'])

const MAX_SUBTASK_DEPTH = 5

/** O que o fork copia quando nada é informado (a pessoa escolhe no momento do fork). */
const FORK_COPY_DEFAULTS = Object.freeze({ description: true, tags: true, custom_values: true, checklist: true, attachments: false, relations: false })

/** Tipo pedido -> relação gravada ({ type, sourceId, targetId }); null se inválido ou a própria tarefa. */
function normalize(inputType, taskId, otherId) {
  const spec = INPUT_TYPES[inputType]
  if (!spec || !taskId || !otherId || taskId === otherId) return null
  return spec.swap ? { type: spec.type, sourceId: otherId, targetId: taskId } : { type: spec.type, sourceId: taskId, targetId: otherId }
}

/** Como a relação aparece para a tarefa `taskId`. */
function viewType(relation, taskId) {
  return relation.sourceId === taskId ? relation.type : INVERSE[relation.type]
}

function isDuplicate(existing, candidate) {
  return existing.some((rel) => {
    if (rel.type !== candidate.type) return false
    if (rel.sourceId === candidate.sourceId && rel.targetId === candidate.targetId) return true
    return SYMMETRIC_FOR_DUPLICATES.indexOf(rel.type) >= 0 && rel.sourceId === candidate.targetId && rel.targetId === candidate.sourceId
  })
}

/** Aresta "vem antes" [antes, depois] da relação, ou null se não impõe ordem. */
function precedenceOf(relation) {
  if (relation.type === 'blocks') return [relation.sourceId, relation.targetId]
  if (relation.type === 'depends_on') return [relation.targetId, relation.sourceId]
  return null
}

/**
 * Adicionar a aresta [antes, depois] cria ciclo? `next(ids)` devolve quem vem depois dos ids
 * (consultado aos poucos, só o necessário). Limite de segurança para grafos grandes.
 */
function createsCycle(edge, next, limit) {
  const before = edge[0]
  const after = edge[1]
  if (before === after) return true
  const max = limit || 5000
  const seen = {}
  let frontier = [after]
  let count = 0
  while (frontier.length > 0 && count < max) {
    frontier.forEach((id) => {
      seen[id] = true
    })
    count += frontier.length
    const following = next(frontier).filter((id, i, all) => all.indexOf(id) === i)
    if (following.indexOf(before) >= 0) return true
    frontier = following.filter((id) => !seen[id])
  }
  return false
}

/**
 * Validação do pai (subtarefa): mesmo projeto, sem ciclo e profundidade máxima.
 * `parentOf(id)` devolve o id do pai de uma tarefa (ou null).
 */
function parentIssue(input) {
  const parent = input.parent
  if (parent.id === input.taskId) return 'cycle'
  if (parent.projectId !== input.projectId) return 'other_project'
  let depth = 1
  let current = input.parentOf(parent.id)
  while (current) {
    if (current === input.taskId) return 'cycle'
    depth += 1
    if (depth >= MAX_SUBTASK_DEPTH) return 'too_deep'
    current = input.parentOf(current)
  }
  return null
}

/** Opções de cópia do fork: padrões + o que foi pedido (chaves desconhecidas são ignoradas). */
function forkCopy(requested) {
  const out = {}
  Object.keys(FORK_COPY_DEFAULTS).forEach((key) => {
    const value = requested && typeof requested[key] === 'boolean' ? requested[key] : FORK_COPY_DEFAULTS[key]
    out[key] = value
  })
  return out
}

module.exports = {
  RELATION_TYPES,
  INPUT_TYPES,
  VIEW_TYPES,
  MAX_SUBTASK_DEPTH,
  FORK_COPY_DEFAULTS,
  normalize,
  viewType,
  isDuplicate,
  precedenceOf,
  createsCycle,
  parentIssue,
  forkCopy,
}
