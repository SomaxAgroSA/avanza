import { describe, expect, it } from 'vitest'
import {
  buildContainers,
  buildLanes,
  canTransition,
  containerId,
  EMPTY_FILTERS,
  matchesFilters,
  moveCardInBoard,
  neighbors,
  parseContainer,
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
    sprint: null,
    cardFields: [],
    ...extra,
  }
}

const status = (id: string, name: string) => ({ id, key: id.toUpperCase(), name, color: 'gray' as const, category: 'todo' as const, isDefault: false })
const ana = { id: 'u1', name: 'Ana Souza', email: 'a@x.com', avatarUrl: null }

const board: Board = {
  project: { id: 'p', key: 'CRM', name: 'CRM', archived: false },
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
