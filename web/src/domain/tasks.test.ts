import { describe, expect, it } from 'vitest'
import { OPEN_TASK_CATEGORIES, TASK_SCOPE_SORT, isOverdue, mentionQueryAt, mentionsToDisplay, mentionsToStorage, parseHours, scopeCountFilters, scopedTaskFilters, taskListFilters } from './tasks'

describe('domain/tasks — menções', () => {
  const carla = { id: 'u7', name: 'Carla Mendes' }
  const ana = { id: 'u1', name: 'Ana' }
  const anaPaula = { id: 'u2', name: 'Ana Paula' }

  it('converte entre o texto exibido e o salvo', () => {
    const stored = mentionsToStorage('Oi @Carla Mendes, tudo bem?', [carla])
    expect(stored).toBe('Oi @[Carla Mendes](u7), tudo bem?')
    expect(mentionsToDisplay(stored)).toEqual({ text: 'Oi @Carla Mendes, tudo bem?', people: [carla] })
  })

  it('nome maior tem prioridade e nome apagado deixa de ser menção', () => {
    expect(mentionsToStorage('@Ana Paula e @Ana', [ana, anaPaula])).toBe('@[Ana Paula](u2) e @[Ana](u1)')
    expect(mentionsToStorage('@Anastácia', [ana])).toBe('@Anastácia')
    expect(mentionsToStorage('sem menção', [carla])).toBe('sem menção')
  })

  it('detecta a consulta após @ até o cursor', () => {
    expect(mentionQueryAt('Oi @car', 7)).toEqual({ start: 3, query: 'car' })
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQueryAt('email a@b', 9)).toBeNull()
    expect(mentionQueryAt('Oi @ ', 5)).toBeNull()
    expect(mentionQueryAt('Oi @Carla\nok', 12)).toBeNull()
  })
})

describe('domain/tasks — utilitários', () => {
  it('horas digitadas', () => {
    expect(parseHours('')).toBeNull()
    expect(parseHours('1,5')).toBe(1.5)
    expect(parseHours('abc')).toBeNaN()
  })

  it('prazo vencido só para tarefa aberta', () => {
    const today = new Date(2026, 8, 28)
    const due = new Date(Date.UTC(2026, 8, 27))
    const open = { dueDate: due, status: { id: 's', key: 'S', name: 'S', color: 'gray' as const, category: 'todo' as const } }
    expect(isOverdue(open, today)).toBe(true)
    expect(isOverdue({ ...open, status: { ...open.status, category: 'done' as const } }, today)).toBe(false)
  })
})

describe('domain/tasks — filtros da lista (ajuste 18/11)', () => {
  it('ficam só Status, Prioridade, Urgência e Responsável; os que saíram da barra são descartados', () => {
    expect(
      taskListFilters({ status: 's1', priority: 'p1', urgency: 'high', assignee: 'me', area: 'a1', category: 'done,cancelled', type: 't1', project: 'p9', tags: 'g1', in_report: 'true', it_visible: 'false', other: '' }),
    ).toEqual({ status: 's1', priority: 'p1', urgency: 'high', assignee: 'me' })
    expect(taskListFilters({ status: '' })).toEqual({})
  })
})

describe('domain/tasks — Lista de tarefas do menu (§42)', () => {
  it('Minhas = atribuídas a quem olha; Todas = sem responsável fixo; Responsável sai da barra (o escopo decide)', () => {
    expect(scopedTaskFilters({ priority: 'p1,p2', assignee: 'u9', area: 'a1' }, 'mine')).toEqual({ priority: 'p1,p2', assignee: 'me', category: OPEN_TASK_CATEGORIES })
    expect(scopedTaskFilters({ priority: 'p1,p2', assignee: 'u9', area: 'a1' }, 'all')).toEqual({ priority: 'p1,p2', category: OPEN_TASK_CATEGORIES })
  })

  it('só as abertas, a menos que o Status diga outra coisa (aí vale o status escolhido, aberto ou encerrado)', () => {
    expect(OPEN_TASK_CATEGORIES).toBe('backlog,todo,in_progress')
    expect(scopedTaskFilters({ status: 's-done', urgency: 'high,none' }, 'all')).toEqual({ status: 's-done', urgency: 'high,none' })
    expect(scopedTaskFilters({ status: '' }, 'all')).toEqual({ category: OPEN_TASK_CATEGORIES })
  })

  it('contagens: abertas em cada escopo, sem os filtros da barra', () => {
    expect(scopeCountFilters('mine')).toEqual({ assignee: 'me', category: OPEN_TASK_CATEGORIES })
    expect(scopeCountFilters('all')).toEqual({ category: OPEN_TASK_CATEGORIES })
  })

  it('ordem inicial: Minhas pelo prazo (sem prazo no fim); Todas pelas movidas mais recentes', () => {
    expect(TASK_SCOPE_SORT.mine).toEqual({ id: 'due_date', direction: 'asc' })
    expect(TASK_SCOPE_SORT.all).toEqual({ id: 'updated_at', direction: 'desc' })
  })
})
