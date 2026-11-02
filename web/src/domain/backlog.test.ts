import { describe, expect, it } from 'vitest'
import { groupBacklog, moveTargets, NO_SPRINT, rankInBacklog, type ActivationStatus } from './backlog'
import { sprintIssues, type Sprint } from './sprints'
import type { TaskSummary } from './tasks'

function item(id: string, extra: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    code: `CRM-${id}`,
    number: Number(id),
    title: `Item ${id}`,
    project: null,
    type: null,
    status: { id: 'b', key: 'BACKLOG', name: 'Backlog', color: 'gray', category: 'backlog' },
    priority: null,
    sprint: null,
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
    ...extra,
  }
}

const c1: Sprint = { id: 'c1', name: 'Sprint 1', state: 'planned', projectId: 'p', goal: '', startDate: null, endDate: null, order: 1, createdAt: null, updatedAt: null }
const inC1 = { id: 'c1', name: 'Sprint 1', state: 'planned' as const }
const alta = { id: 'p1', key: 'ALTA', name: 'Alta', color: 'orange' as const }
const baixa = { id: 'p2', key: 'BAIXA', name: 'Baixa', color: 'gray' as const }

describe('backlog', () => {
  const view = {
    sprints: [c1],
    items: [item('1', { estimatedHours: 2 }), item('2', { sprint: inC1, estimatedHours: 3.5, priority: baixa }), item('3'), item('4', { sprint: inC1, priority: alta })],
  }

  it('agrupa por sprint (sem sprint por último), mantém a ordem manual e soma estimativas', () => {
    const groups = groupBacklog(view, () => true)
    expect(groups.map((g) => g.id)).toEqual(['c1', NO_SPRINT])
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['2', '4'])
    expect(groups[0]).toMatchObject({ estimate: 3.5, unestimated: 1 })
    expect(groups[1]?.items.map((i) => i.id)).toEqual(['1', '3'])
    // filtro só esconde; o grupo continua existindo
    expect(groupBacklog(view, (i) => i.id === '1')[0]?.items).toEqual([])
  })

  it('ordenações alternativas respeitam a ordem configurada das prioridades', () => {
    const groups = groupBacklog(view, () => true, 'priority', ['p1', 'p2'])
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['4', '2'])
    expect(groupBacklog(view, () => true, 'estimate')[1]?.items.map((i) => i.id)).toEqual(['1', '3'])
  })

  it('priorização otimista: move depois do vizinho e troca a sprint', () => {
    const moved = rankInBacklog(view, '3', inC1, '2')
    expect(moved.items.map((i) => i.id)).toEqual(['1', '2', '3', '4'])
    expect(moved.items[2]?.sprint?.id).toBe('c1')
    expect(rankInBacklog(view, '1', null, undefined, '4').items.map((i) => i.id)).toEqual(['2', '3', '1', '4'])
    expect(rankInBacklog(view, '2', null).items.map((i) => i.id)).toEqual(['1', '3', '4', '2'])
  })

  it('mover para: status ativos, abertos, diferentes do atual e permitidos pela transição', () => {
    const statuses: ActivationStatus[] = [
      { id: 'b', name: 'Backlog', category: 'backlog', order: 0, isActive: true, allowedNext: [] },
      { id: 'dev', name: 'Dev', category: 'in_progress', order: 2, isActive: true },
      { id: 'todo', name: 'A fazer', category: 'todo', order: 1, isActive: true },
      { id: 'old', name: 'Antigo', category: 'todo', order: 3, isActive: false },
      { id: 'done', name: 'Feito', category: 'done', order: 4, isActive: true },
    ]
    expect(moveTargets(statuses, 'b').map((s) => s.id)).toEqual(['todo', 'dev'])
    // já analisada: pode voltar ao backlog ou seguir
    expect(moveTargets(statuses, 'todo').map((s) => s.id)).toEqual(['b', 'dev'])
    const restricted = statuses.map((s) => (s.id === 'b' ? { ...s, allowedNext: ['dev'] } : s))
    expect(moveTargets(restricted, 'b').map((s) => s.id)).toEqual(['dev'])
  })
})

describe('sprints', () => {
  it('nome obrigatório e fim não antes do início', () => {
    expect(sprintIssues({ name: ' ', goal: '', startDate: '', endDate: '' })).toEqual({ name: 'required' })
    expect(sprintIssues({ name: 'C', goal: '', startDate: '2026-10-10', endDate: '2026-10-01' })).toEqual({ end_date: 'end_before_start' })
    expect(sprintIssues({ name: 'C', goal: '', startDate: '2026-10-01', endDate: '2026-10-10' })).toEqual({})
  })
})
