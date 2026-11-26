/**
 * "O que aparece" por perfil (Controle de acesso → Perfis, ajuste 25/11/2026, ADR-062, regras §48): um
 * mecanismo só para esconder partes da tela — submenus, listas, caixas, visões, abas, blocos, filtros e botões —
 * e dizer onde cada módulo abre ("Abre em"). É só a tela: não tira permissão nenhuma e a API continua validando
 * tudo como antes (quem tem a permissão segue podendo abrir pelo endereço ou pela API).
 *
 * - O perfil guarda o que está ESCONDIDO (`roles.hidden_screens`, chaves `<grupo>.<item>`): o que não está na
 *   lista aparece, então todo perfil novo vê tudo e uma chave nova no catálogo aparece para todos.
 * - Em cada grupo sempre fica ao menos um item visível (ninguém fica com uma tela vazia), menos nos grupos
 *   "opcionais" (`OPTIONAL_GROUPS`: botões que podem sumir todos, como o "Fixar" das linhas da Lista, §50).
 * - Os grupos com `start` têm "Abre em" (`roles.screen_starts`, { grupo: item }); sem escolha (ou com o item
 *   escondido), abre no primeiro visível.
 *
 * O catálogo é espelhado em web/src/domain/screens.ts (o teste de paridade compara os dois).
 */

/** Grupos do catálogo, na ordem da tela, com o módulo do menu a que pertencem. */
const SCREEN_GROUPS = Object.freeze([
  // Panorama: os blocos da tela (Síntese, Indicadores, Saúde, Execução × planejamento, Atenção, Marcos)
  group('tracking', 'tracking.blocks', ['synthesis', 'kpis', 'health', 'execution', 'attention', 'milestones']),
  // Projetos: listas do menu (antes roles.projects_lists, 0037)
  group('projects', 'projects.lists', ['all', 'ongoing', 'finished', 'archived'], true),
  // Em andamento: Gestão e Direção e gerência (antes roles.ongoing_view, 0028)
  group('projects', 'projects.ongoing_views', ['management', 'executive'], true),
  // Em andamento › Direção e gerência: os blocos do painel (Equipe agora também na Gestão)
  group('projects', 'projects.blocks', ['kpis', 'dependencies', 'timeline', 'areas', 'status', 'team', 'table']),
  // abas da página do projeto (Ficha, Informe, Membros e Histórico também exigem a seção do perfil, §35)
  group('projects', 'projects.tabs', ['overview', 'charter', 'management', 'tasks', 'report', 'files', 'docs', 'members', 'history', 'settings']),
  // visões da aba Tarefas do projeto
  group('projects', 'projects.task_views', ['list', 'kanban', 'planning', 'timeline']),
  // Tarefas: a Lista e a Caixa de entrada (antes roles.tasks_list 'hidden' e tasks_start, 0034)
  group('tasks', 'tasks.screens', ['list', 'inbox'], true),
  // a Lista: "Minhas tarefas" e "Ver todas" (antes roles.tasks_list 'mine')
  group('tasks', 'tasks.scopes', ['mine', 'all']),
  // caixas da Caixa de entrada (antes roles.tasks_hidden_boxes e tasks_all_box, 0034/0035)
  group('tasks', 'tasks.boxes', ['received', 'assigned', 'requested', 'all'], true),
  // visões da Caixa de entrada: Lista e Linha do tempo (Gantt)
  group('tasks', 'tasks.views', ['list', 'timeline'], true),
  // filtros da linha de cima das Tarefas
  group('tasks', 'tasks.filters', ['search', 'project', 'priority', 'urgency', 'responsible', 'assignee', 'company']),
  // botões de criar
  group('tasks', 'tasks.create', ['project_task', 'internal_demand']),
  // ações de cada linha da Lista (§50): o "Fixar" (opcional: pode sumir; as fixadas continuam no topo)
  group('tasks', 'tasks.row_actions', ['pin'], false, true),
  // Documentação: botões da página
  group('docs', 'docs.actions', ['notify', 'versions', 'pdf']),
  // Configurações: cada submenu
  group('settings', 'settings.menu', [
    'general',
    'integrations',
    'task_types',
    'custom_fields',
    'statuses',
    'priorities',
    'areas',
    'dependency_areas',
    'companies',
    'tags',
    'icons',
    'access',
    'audit',
  ]),
])

function group(module, id, items, start, optional) {
  return Object.freeze({ module, id, items: Object.freeze(items.slice()), start: !!start, optional: !!optional })
}

/** Todas as chaves (`<grupo>.<item>`), na ordem do catálogo. */
const SCREEN_KEYS = Object.freeze(SCREEN_GROUPS.reduce((all, g) => all.concat(g.items.map((item) => `${g.id}.${item}`)), []))

/** Grupos com "Abre em". */
const START_GROUPS = Object.freeze(SCREEN_GROUPS.filter((g) => g.start).map((g) => g.id))

/** Grupos que podem ficar sem nenhum item visível (só botões; nenhuma tela fica vazia). */
const OPTIONAL_GROUPS = Object.freeze(SCREEN_GROUPS.filter((g) => g.optional).map((g) => g.id))

const MAX_HIDDEN = SCREEN_KEYS.length

function groupOf(id) {
  return SCREEN_GROUPS.find((g) => g.id === id) || null
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Problema na lista de escondidas vinda da API (null = válida): só chaves conhecidas e ao menos uma visível por grupo. */
function hiddenScreensIssue(value) {
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string')) return 'invalid_type'
  if (value.length > MAX_HIDDEN * 2) return 'too_many'
  if (!value.every((key) => SCREEN_KEYS.indexOf(key) >= 0)) return 'invalid_option'
  return SCREEN_GROUPS.some((g) => !g.optional && g.items.every((item) => value.indexOf(`${g.id}.${item}`) >= 0)) ? 'required' : null
}

/** Problema nas entradas "Abre em" vindas da API (null = válidas): { grupo com "Abre em": item do grupo }. */
function screenStartsIssue(value) {
  if (!isPlainObject(value)) return 'invalid_type'
  const ok = Object.keys(value).every((id) => {
    const g = groupOf(id)
    return !!g && g.start && g.items.indexOf(value[id]) >= 0
  })
  return ok ? null : 'invalid_option'
}

/** Escondidas → só as conhecidas, sem repetidas, na ordem do catálogo (o que se grava e o que a API devolve). */
function normalizeHidden(value) {
  const list = Array.isArray(value) ? value : []
  return SCREEN_KEYS.filter((key) => list.indexOf(key) >= 0)
}

/** "Abre em" → só os grupos com "Abre em", com um item visível, na ordem do catálogo. */
function normalizeStarts(value, hidden) {
  const source = isPlainObject(value) ? value : {}
  const hiddenList = normalizeHidden(hidden)
  const out = {}
  START_GROUPS.forEach((id) => {
    const item = source[id]
    if (groupOf(id).items.indexOf(item) >= 0 && hiddenList.indexOf(`${id}.${item}`) < 0) out[id] = item
  })
  return out
}

/**
 * Itens visíveis de um grupo (nunca vazio: um grupo todo escondido, que a validação não deixa gravar, mostra tudo;
 * o grupo opcional pode ficar vazio).
 */
function visibleItems(hidden, id) {
  const g = groupOf(id)
  if (!g) return []
  const hiddenList = normalizeHidden(hidden)
  const visible = g.items.filter((item) => hiddenList.indexOf(`${id}.${item}`) < 0)
  return visible.length || g.optional ? visible : g.items.slice()
}

module.exports = {
  SCREEN_GROUPS,
  SCREEN_KEYS,
  START_GROUPS,
  OPTIONAL_GROUPS,
  hiddenScreensIssue,
  screenStartsIssue,
  normalizeHidden,
  normalizeStarts,
  visibleItems,
}
