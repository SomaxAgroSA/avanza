import { describe, expect, it } from 'vitest'
import {
  boardPeople,
  boardPersonReferences,
  boardWipLimit,
  buildContainers,
  buildLanes,
  canMoveCard,
  canTransition,
  columnTemplate,
  DEFAULT_VIEW,
  parseBoardView,
  toggleCollapsed,
  visibleColumns,
  containerId,
  EMPTY_FILTERS,
  isAllProjects,
  liveProjectIds,
  matchesFilters,
  moveCardInBoard,
  neighbors,
  neighborsInProject,
  parseContainer,
  projectFilterOptions,
  wipState,
  type Board,
  type BoardCard,
} from './kanban'

function card(id: string, extra: Partial<BoardCard> = {}): BoardCard {
  return {
    id,
    code: `CRM-${id}`,
    number: 1,
    title: `Tarefa ${id}`,
    project: null,
    type: { id: 't1', key: 'BUG', name: 'Bug', icon: 'bug', color: 'red' },
    status: null,
    priority: { id: 'p1', key: 'ALTA', name: 'Alta', color: 'orange' },
    creator: null,
    assignee: null,
    reporter: null,
    parentTaskId: null,
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    actualHours: null,
    startedAt: null,
    completedAt: null,
    createdAt: null,
    updatedAt: null,
    tags: [],
    checklistProgress: { done: 0, total: 0 },
    commentCount: 0,
    attachmentCount: 0,
    subtaskProgress: { done: 0, total: 0 },
    blocked: false,
    inReport: true,
    urgency: null,
    area: null,
    sprint: null,
    cardFields: [],
    ...extra,
  }
}

const status = (id: string, name: string) => ({ id, key: id.toUpperCase(), name, color: 'gray' as const, category: 'todo' as const, isDefault: false })
const ana = { id: 'u1', name: 'Ana Souza', email: 'a@x.com', avatarUrl: null }

const board: Board = {
  project: { id: 'p', key: 'CRM', name: 'CRM', archived: false },
  projects: [{ id: 'p', key: 'CRM', name: 'CRM' }],
  capabilities: { move: true, create: true },
  columns: [
    { status: status('a', 'Backlog'), wipLimit: 0, allowedNext: ['b'], total: 2, truncated: false, cards: [card('1', { assignee: ana }), card('2')] },
    { status: status('b', 'Fazendo'), wipLimit: 2, allowedNext: [], total: 1, truncated: false, cards: [card('3', { title: 'Relatório de vendas' })] },
    { status: status('c', 'Feito'), wipLimit: 0, allowedNext: [], total: 0, truncated: false, cards: [] },
  ],
}

describe('domain/kanban', () => {
  it('filtra por busca (sem acento), responsável e "sem responsável"', () => {
    expect(matchesFilters(card('3', { title: 'Relatório de vendas' }), { ...EMPTY_FILTERS, search: 'relatorio' }, 'u1')).toBe(true)
    expect(matchesFilters(card('1', { assignee: ana }), { ...EMPTY_FILTERS, assignee: 'me' }, 'u1')).toBe(true)
    expect(matchesFilters(card('2'), { ...EMPTY_FILTERS, assignee: 'me' }, 'u1')).toBe(false)
    expect(matchesFilters(card('2'), { ...EMPTY_FILTERS, assignee: 'none' }, 'u1')).toBe(true)
  })

  it('filtra por urgência: alta/média/baixa ou sem urgência', () => {
    expect(matchesFilters(card('4', { urgency: 'high' }), { ...EMPTY_FILTERS, urgency: 'high' }, 'u1')).toBe(true)
    expect(matchesFilters(card('5', { urgency: 'low' }), { ...EMPTY_FILTERS, urgency: 'high' }, 'u1')).toBe(false)
    expect(matchesFilters(card('6', { urgency: null }), { ...EMPTY_FILTERS, urgency: 'none' }, 'u1')).toBe(true)
    expect(matchesFilters(card('7', { urgency: 'medium' }), { ...EMPTY_FILTERS, urgency: 'none' }, 'u1')).toBe(false)
    expect(matchesFilters(card('8', { urgency: 'medium' }), EMPTY_FILTERS, 'u1')).toBe(true)
  })

  it('filtra por área: a área escolhida ou sem área', () => {
    const ti = { id: 'a1', key: 'TI', name: 'Dpto. TI', color: 'blue' as const }
    expect(matchesFilters(card('4', { area: ti }), { ...EMPTY_FILTERS, area: 'a1' }, 'u1')).toBe(true)
    expect(matchesFilters(card('5', { area: ti }), { ...EMPTY_FILTERS, area: 'a2' }, 'u1')).toBe(false)
    expect(matchesFilters(card('6', { area: null }), { ...EMPTY_FILTERS, area: 'none' }, 'u1')).toBe(true)
    expect(matchesFilters(card('7', { area: ti }), { ...EMPTY_FILTERS, area: 'none' }, 'u1')).toBe(false)
    expect(matchesFilters(card('8', { area: ti }), EMPTY_FILTERS, 'u1')).toBe(true)
  })

  it('contêineres por raia × coluna', () => {
    const containers = buildContainers(board, ['u1', ''], 'assignee', () => true)
    expect(containers[containerId('u1', 'a')]).toEqual(['1'])
    expect(containers[containerId('', 'a')]).toEqual(['2'])
    expect(containers[containerId('', 'b')]).toEqual(['3'])
    expect(parseContainer(containerId('u1', 'b'))).toEqual({ lane: 'u1', statusId: 'b' })
  })

  it('transições seguem os destinos permitidos da coluna de origem', () => {
    expect(canTransition(board, 'a', 'b')).toBe(true)
    expect(canTransition(board, 'a', 'c')).toBe(false)
    expect(canTransition(board, 'b', 'c')).toBe(true)
  })

  it('vizinhos para o servidor e movimento otimista', () => {
    expect(neighbors(['x', 'y', 'z'], 'y')).toEqual({ prevId: 'x', nextId: 'z' })
    expect(neighbors(['y'], 'y')).toEqual({ prevId: undefined, nextId: undefined })
    const moved = moveCardInBoard(board, '1', 'b', '3')
    expect(moved.columns[0]?.cards.map((c) => c.id)).toEqual(['2'])
    expect(moved.columns[1]?.cards.map((c) => c.id)).toEqual(['3', '1'])
    expect(moved.columns[1]?.cards[1]?.status?.name).toBe('Fazendo')
    expect(moved.columns[1]?.total).toBe(2)
  })

  it('situação do WIP', () => {
    expect(wipState({ wipLimit: 0, total: 9 })).toBe('none')
    expect(wipState({ wipLimit: 2, total: 1 })).toBe('ok')
    expect(wipState({ wipLimit: 2, total: 2 })).toBe('full')
    expect(wipState({ wipLimit: 2, total: 3 })).toBe('over')
  })

  it('raias: uma por valor presente, na ordem certa e "sem valor" por último', () => {
    const bia = { id: 'u2', name: 'Bia Lima', email: 'b@x.com', avatarUrl: null }
    const baixa = { id: 'p2', key: 'BAIXA', name: 'Baixa', color: 'gray' as const }
    const cards = [card('1', { assignee: bia, priority: baixa }), card('2'), card('3', { assignee: ana, priority: null })]
    expect(buildLanes(cards, 'none', [])).toEqual([{ id: 'all', name: '' }])
    expect(buildLanes(cards, 'assignee', []).map((l) => l.id)).toEqual(['u1', 'u2', ''])
    expect(buildLanes(cards, 'assignee', [])[0]).toMatchObject({ name: 'Ana Souza', person: ana })
    // prioridades seguem a ordem configurada, não a alfabética
    expect(buildLanes(cards, 'priority', ['p1', 'p2']).map((l) => l.id)).toEqual(['p1', 'p2', ''])
    expect(buildLanes(cards, 'priority', ['p1', 'p2'])[0]).toMatchObject({ name: 'Alta', color: 'orange' })
    expect(buildLanes(cards, 'type', []).map((l) => l.id)).toEqual(['t1'])
  })
})

describe('domain/kanban — quadro de todos os projetos', () => {
  const crm = { id: 'p1', key: 'CRM', name: 'CRM' }
  const erp = { id: 'p2', key: 'ERP', name: 'ERP' }
  const rh = { id: 'p3', key: 'RH', name: 'RH' }
  const bia = { id: 'u2', name: 'Bia Lima', email: 'b@x.com', avatarUrl: null }
  const all: Board = {
    project: null,
    projects: [crm, erp, rh],
    capabilities: { move: true, create: true },
    columns: [
      {
        status: status('a', 'Backlog'),
        wipLimit: 2,
        allowedNext: [],
        total: 3,
        truncated: false,
        cards: [
          card('1', { project: crm, canMove: true, assignee: bia }),
          card('2', { project: erp, canMove: false, creator: ana }),
          card('3', { project: crm, canMove: true, assignee: ana }),
        ],
      },
    ],
  }

  it('reconhece o quadro, sem WIP (é por projeto) e com a permissão de mover de cada card', () => {
    expect(isAllProjects(all)).toBe(true)
    expect(isAllProjects(board)).toBe(false)
    expect(boardWipLimit(all, { wipLimit: 2 })).toBe(0)
    expect(boardWipLimit(board, { wipLimit: 2 })).toBe(2)
    expect(canMoveCard(all, card('x', { canMove: false }))).toBe(false)
    expect(canMoveCard(all, card('x', { canMove: true }))).toBe(true)
    // quadro do projeto: vale a permissão do quadro
    expect(canMoveCard({ ...board, capabilities: { move: false, create: false } }, card('x'))).toBe(false)
  })

  it('filtra por projeto (vazio = todos)', () => {
    expect(matchesFilters(card('1', { project: crm }), { ...EMPTY_FILTERS, projects: ['p1'] }, 'u1')).toBe(true)
    expect(matchesFilters(card('2', { project: erp }), { ...EMPTY_FILTERS, projects: ['p1'] }, 'u1')).toBe(false)
    expect(matchesFilters(card('2', { project: erp }), { ...EMPTY_FILTERS, projects: ['p1', 'p2'] }, 'u1')).toBe(true)
    expect(matchesFilters(card('2', { project: erp }), EMPTY_FILTERS, 'u1')).toBe(true)
  })

  it('vizinhos para o servidor: os mais próximos do mesmo projeto', () => {
    const projectOf = (id: string) => ({ a: 'p1', b: 'p2', c: 'p1', d: 'p2', e: 'p1' })[id]
    expect(neighborsInProject(['a', 'b', 'c', 'd', 'e'], 'c', projectOf)).toEqual({ prevId: 'a', nextId: 'e' })
    expect(neighborsInProject(['b', 'c', 'd'], 'c', projectOf)).toEqual({ prevId: undefined, nextId: undefined })
    expect(neighborsInProject(['a', 'b'], 'x', projectOf)).toEqual({})
  })

  it('pessoas e projetos tirados dos cards', () => {
    expect(boardPeople(all).map((p) => p.name)).toEqual(['Ana Souza', 'Bia Lima'])
    expect(boardPersonReferences(all).map((p) => p.id).sort()).toEqual(['u1', 'u2'])
    // RH não tem cards: fica fora do filtro, a não ser que já esteja escolhido
    expect(projectFilterOptions(all, []).map((p) => p.key)).toEqual(['CRM', 'ERP'])
    expect(projectFilterOptions(all, ['p3']).map((p) => p.key)).toEqual(['CRM', 'ERP', 'RH'])
  })

  it('tempo real: projetos com cards primeiro, até o limite', () => {
    expect(liveProjectIds(all, 10)).toEqual({ ids: ['p1', 'p2', 'p3'], complete: true })
    expect(liveProjectIds(all, 2)).toEqual({ ids: ['p1', 'p2'], complete: false })
    // RH (sem cards) fica de fora mesmo vindo primeiro; a lista sai na ordem do quadro
    expect(liveProjectIds({ ...all, projects: [rh, erp, crm] }, 2)).toEqual({ ids: ['p2', 'p1'], complete: false })
  })
})

describe('domain/kanban — visão do quadro', () => {
  it('filtro de etapas: só as escolhidas, na ordem do fluxo; vazio ou etapa que sumiu = todas', () => {
    expect(visibleColumns(board.columns, ['c', 'a']).map((c) => c.status.id)).toEqual(['a', 'c'])
    expect(visibleColumns(board.columns, [])).toHaveLength(3)
    expect(visibleColumns(board.columns, ['sumiu'])).toHaveLength(3)
  })

  it('colunas recolhidas ficam estreitas; o modo compacto estreita as abertas', () => {
    expect(columnTemplate(board.columns, DEFAULT_VIEW)).toBe('minmax(16rem, 1fr) minmax(16rem, 1fr) minmax(16rem, 1fr)')
    const view = toggleCollapsed({ collapsed: [], compact: true }, 'b')
    expect(columnTemplate(board.columns, view)).toBe('minmax(13rem, 1fr) 2.75rem minmax(13rem, 1fr)')
    expect(toggleCollapsed(view, 'b').collapsed).toEqual([])
  })

  it('preferência salva: descarta o que não tem o formato', () => {
    expect(parseBoardView({ collapsed: ['a', 3], compact: true })).toEqual({ collapsed: ['a'], compact: true })
    expect(parseBoardView('lixo')).toEqual(DEFAULT_VIEW)
    expect(parseBoardView(null)).toEqual(DEFAULT_VIEW)
  })
})
