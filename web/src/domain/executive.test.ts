import { describe, expect, it } from 'vitest'
import {
  attentionItems,
  averageDelivery,
  deliverySeries,
  executiveDuration,
  executivePeriodRange,
  hasDeliveries,
  kanbanFlow,
  portfolioByHealth,
  localDay,
  mainHealthFactor,
  totalDeliveries,
  type ExecutiveKanbanSection,
  type PortfolioRow,
} from './executive'
import type { HealthFactor, HealthLevel } from './plan-management'

describe('painel executivo', () => {
  const now = new Date(2026, 9, 29, 10, 42) // 29/10/2026 (local)

  it('"Desde o início" não manda datas; os atalhos terminam hoje (dias locais)', () => {
    expect(executivePeriodRange('all', now)).toEqual({ from: null, to: null })
    expect(executivePeriodRange('year', now)).toEqual({ from: '2026-01-01', to: '2026-10-29' })
    expect(executivePeriodRange('month', now)).toEqual({ from: '2026-10-01', to: '2026-10-29' })
    // 90 dias contando hoje
    expect(executivePeriodRange('90d', now)).toEqual({ from: '2026-08-01', to: '2026-10-29' })
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('personalizado: as duas datas e o fim não antes do início', () => {
    expect(executivePeriodRange('custom', now, { from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-03-01', to: '2026-03-31' })
    expect(executivePeriodRange('custom', now, { from: '2026-03-31', to: '2026-03-01' })).toBeNull()
    expect(executivePeriodRange('custom', now, { from: '2026-03-01', to: '' })).toBeNull()
    expect(executivePeriodRange('custom', now)).toBeNull()
  })

  it('motivo da saúde: o pior fator (crítico antes de atenção; empate fica com o primeiro)', () => {
    const factors = [
      { key: 'progress' as const, level: 'attention' as const, value: 12 },
      { key: 'schedule' as const, level: 'critical' as const, value: 35 },
      { key: 'issues' as const, level: 'critical' as const, value: 4 },
    ]
    expect(mainHealthFactor({ level: 'critical', factors })?.key).toBe('schedule')
    expect(mainHealthFactor({ level: 'attention', factors: [factors[0]!] })?.key).toBe('progress')
    expect(mainHealthFactor({ level: 'ok', factors })).toBeNull()
    expect(mainHealthFactor({ level: 'none', factors: [] })).toBeNull()
  })

  it('tempo médio: dias a partir de 24 h; entregas somam os três tipos', () => {
    expect(executiveDuration(null)).toBeNull()
    expect(executiveDuration(23.94)).toEqual({ value: 23.9, unit: 'hours' })
    expect(executiveDuration(96.5)).toEqual({ value: 4, unit: 'days' })
    expect(totalDeliveries({ tasks: 120, planItems: 25, milestones: 3 })).toBe(148)
  })
})

describe('painel executivo — leitura rápida', () => {
  const crm = { id: 'p1', key: 'CRM', name: 'CRM' }
  const erp = { id: 'p2', key: 'ERP', name: 'ERP' }
  const project = (ref: typeof crm, level: HealthLevel, factors: HealthFactor[] = []): PortfolioRow => ({
    project: { ...ref, cover: 'blue', icon: 'folder', status: 'active', priority: 'high', startDate: null, dueDate: null, owner: null },
    health: { level, factors },
    progress: null,
    plan: null,
    tasks: { total: 0, open: 0, overdue: 0, done: 0 },
    nextMilestone: null,
    openIssues: 0,
  })
  const kanban = (overdueTasks: ExecutiveKanbanSection['overdueTasks'] = []): ExecutiveKanbanSection => ({
    funnel: { backlog: 4, todo: 3, in_progress: 2, done: 10, cancelled: 1 },
    created: 0,
    completed: 0,
    leadTime: { hours: null, count: 0 },
    cycleTime: { hours: null, count: 0 },
    overdue: overdueTasks.length,
    blocked: 0,
    criticalBugs: 0,
    overdueTasks,
  })
  const task = (id: string, dueDate: string) => ({ id, code: id, title: id, project: crm, dueDate, status: { id: 's', name: 'S', color: 'blue' as const, category: 'todo' as const } })

  it('precisa de atenção: críticos primeiro; depois um de cada tipo por vez (atenção, problema, tarefa, marco)', () => {
    const schedule: HealthFactor = { key: 'schedule', level: 'critical', value: 35 }
    const items = attentionItems({
      portfolio: [project(crm, 'critical', [schedule]), project(erp, 'attention'), project({ id: 'p3', key: 'OK', name: 'OK' }, 'ok'), project({ id: 'p4', key: 'NO', name: 'NO' }, 'none')],
      plan: {
        items: { total: 1, done: 0, open: 1, overdue: 0, stuck: 0, canceled: 0 },
        statusDistribution: [],
        schedule: { onTime: 0, overdue: 0, unscheduled: 0, done: 0 },
        effort: { estimated: null, actual: null, remaining: null },
        issues: [
          { id: 'i2', number: 2, description: 'novo', state: 'pending', openedOn: '2026-10-20', project: crm },
          { id: 'i1', number: 1, description: 'antigo', state: 'pending', openedOn: '2026-09-01', project: crm },
        ],
        openIssuesTotal: 2,
        upcomingMilestones: [{ id: 'm1', name: 'Go-live', dueDate: '2026-11-10', project: crm }],
      },
      kanban: kanban([task('T2', '2026-10-25'), task('T1', '2026-10-01')]),
    })
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(['project:p1', 'project:p2', 'issue:i1', 'task:T1', 'milestone:m1', 'issue:i2', 'task:T2'])
    const first = items[0]
    expect(first?.kind === 'project' && first.factor?.key).toBe('schedule')
  })

  it('nada pede atenção: lista vazia', () => {
    expect(attentionItems({ portfolio: [project(crm, 'ok')], plan: null, kanban: kanban() })).toEqual([])
  })

  it('fluxo do Kanban sem as canceladas; tempo médio só com amostra; série de entregas', () => {
    expect(kanbanFlow(kanban().funnel)).toEqual([
      { category: 'backlog', count: 4 },
      { category: 'todo', count: 3 },
      { category: 'in_progress', count: 2 },
      { category: 'done', count: 10 },
    ])
    expect(averageDelivery({ hours: 0, count: 0 })).toBeNull()
    expect(averageDelivery({ hours: 96.5, count: 3 })).toEqual({ value: 4, unit: 'days' })
    const points = [
      { start: '2026-09-01', tasksCreated: 9, tasksCompleted: 2, planItemsCompleted: 1 },
      { start: '2026-10-01', tasksCreated: 9, tasksCompleted: 0, planItemsCompleted: 0 },
    ]
    expect(deliverySeries(points)).toEqual([3, 0])
    expect(hasDeliveries(points)).toBe(true)
    expect(hasDeliveries([{ ...points[1]! }])).toBe(false)
  })

  it('portfólio filtrado pela saúde (null = todos), na mesma ordem', () => {
    const rows = [project(crm, 'critical'), project(erp, 'ok'), project({ id: 'p3', key: 'X', name: 'X' }, 'critical')]
    expect(portfolioByHealth(rows, 'critical').map((r) => r.project.id)).toEqual(['p1', 'p3'])
    expect(portfolioByHealth(rows, null)).toBe(rows)
  })
})
