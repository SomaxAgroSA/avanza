import { describe, expect, it } from 'vitest'
import type { Plan, PlanGroup, PlanItem } from './plan'
import type { TaskSummary } from './tasks'
import { isProgressFromTasks, linkableTasks, linkedTasks, planItemChoices, tasksPercent } from './plan-tasks'

const group = (id: string, number: string, name: string, parentId: string | null = null): PlanGroup => ({ id, parentId, name, color: 'blue', position: 0, number, summary: null })

const item = (id: string, groupId: string, position: number, extra: Partial<PlanItem> = {}): PlanItem => ({
  id,
  groupId,
  parentId: null,
  name: `Elemento ${id}`,
  statusId: null,
  startDate: null,
  endDate: null,
  dueDate: null,
  owner: null,
  resourceIds: [],
  estimatedHours: null,
  actualHours: null,
  durationDays: null,
  durationManual: null,
  progress: { value: 0, source: 'none' },
  progressManual: null,
  subitems: 0,
  position,
  blocked: false,
  updates: 0,
  files: 0,
  baselineStart: null,
  baselineEnd: null,
  custom: {},
  ...extra,
})

const plan = (groups: PlanGroup[], items: PlanItem[]): Plan => ({
  project: { id: 'p1', key: 'IMP', name: 'Implantação', archived: false },
  capabilities: { edit: true, manage: true },
  statuses: [],
  resources: [],
  groups,
  items,
  links: [],
  columns: [],
  settings: { dependencyRule: 'warn', baselineAt: null },
  summary: null,
  truncated: false,
})

const task = (id: string, planItem: TaskSummary['planItem']) => ({ id, planItem }) as TaskSummary

describe('tarefas vinculadas aos elementos da Gestão', () => {
  it('contagem das tarefas vinculadas (ausente = nenhuma) e progresso vindo delas', () => {
    expect(linkedTasks(item('a', 'g', 1))).toEqual({ total: 0, done: 0 })
    expect(linkedTasks(item('a', 'g', 1, { tasks: { total: 5, done: 3 } }))).toEqual({ total: 5, done: 3 })
    expect(isProgressFromTasks(item('a', 'g', 1, { progress: { value: 60, source: 'tasks' } }))).toBe(true)
    expect(isProgressFromTasks(item('a', 'g', 1, { progress: { value: 60, source: 'manual' } }))).toBe(false)
    expect(tasksPercent({ total: 3, done: 2 })).toBe(67)
    expect(tasksPercent({ total: 0, done: 0 })).toBe(0)
  })

  it('opções do campo: grupo a grupo na ordem do quadro, subelemento logo depois do pai', () => {
    const groups = [group('g1', '1.0', 'Iniciação'), group('g2', '2.0', 'Planejamento'), group('g21', '2.1', 'Plano', 'g2')]
    const items = [
      item('b', 'g1', 2),
      item('a', 'g1', 1, { subitems: 1 }),
      item('a1', 'g1', 1, { parentId: 'a' }),
      item('c', 'g21', 1),
    ]
    expect(planItemChoices(plan(groups, items))).toEqual([
      { id: 'a', name: 'Elemento a', group: '1.0 Iniciação', parentId: null },
      { id: 'a1', name: 'Elemento a1', group: '1.0 Iniciação', parentId: 'a' },
      { id: 'b', name: 'Elemento b', group: '1.0 Iniciação', parentId: null },
      { id: 'c', name: 'Elemento c', group: '2.1 Plano', parentId: null },
    ])
    expect(planItemChoices(plan(groups, []))).toEqual([])
  })

  it('para vincular: tira as tarefas que já estão neste elemento', () => {
    const list = [task('t1', null), task('t2', { id: 'a', name: 'A' }), task('t3', { id: 'b', name: 'B' }), task('t4', undefined)]
    expect(linkableTasks(list, 'a').map((t) => t.id)).toEqual(['t1', 't3', 't4'])
  })
})
