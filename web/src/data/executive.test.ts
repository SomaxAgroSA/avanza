import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/core/networking/api-client'
import type { ExecutiveDto } from './dtos'
import { createHttpExecutiveRepository } from './http-repositories'

const dto: ExecutiveDto = {
  generated_at: '2026-10-29T13:42:00.000Z',
  period: { from: null, to: '2026-10-29T23:59:59.999Z' },
  filters: { project_ids: [] },
  projects: [{ id: 'p1', key: 'CRM', name: 'CRM', color: 'blue', icon: 'folder', archived: false }],
  summary: {
    active_projects: 12,
    health: { ok: 7, attention: 3, critical: 2, none: 0 },
    progress: 64,
    deliveries: { tasks: 120, plan_items: 25, milestones: 3 },
    overdue: { tasks: 5, plan_items: 4 },
    open_issues: 3,
    critical_bugs: 1,
  },
  portfolio: [
    {
      project: { id: 'p1', key: 'CRM', name: 'CRM', color: 'blue', icon: 'folder', status: 'active', priority: 'high', start_date: '2026-01-10', due_date: '2026-12-15', owner: { id: 'u1', name: 'Ana', avatar_url: null } },
      health: { level: 'critical', factors: [{ key: 'schedule', value: 35, level: 'critical', count: 7, of: 20 }, { key: 'unknown', value: 1, level: 'ok' }] },
      progress: { value: 72, source: 'plan' },
      plan: { total: 25, done: 12, open: 13, overdue: 7, stuck: 0 },
      tasks: { total: 80, open: 30, overdue: 4, done: 48 },
      next_milestone: { id: 'm1', name: 'Go-live', due_date: '2026-12-01' },
      open_issues: 2,
    },
    {
      project: { id: 'p2', key: 'OPS', name: 'Ops', color: null, icon: null, status: 'active', priority: 'medium', start_date: null, due_date: null, owner: null },
      health: { level: 'none', factors: [] },
      progress: null,
      plan: null,
      tasks: { total: 0, open: 0, overdue: 0, done: 0 },
      next_milestone: null,
      open_issues: 0,
    },
  ],
  plan: null,
  kanban: {
    funnel: { backlog: 40, todo: 20, in_progress: 15, done: 300, cancelled: 12 },
    created: 180,
    completed: 120,
    lead_time: { hours: 96.5, count: 120 },
    cycle_time: { hours: null, count: 0 },
    overdue: 5,
    blocked: 2,
    critical_bugs: 1,
    overdue_tasks: [{ id: 't1', code: 'CRM-12', title: 'Integração', project: { id: 'p1', key: 'CRM', name: 'CRM' }, due_date: '2026-10-20', status: { id: 's1', name: 'Em andamento', color: null, category: 'in_progress' } }],
  },
  timeline: { bucket: 'week', points: [{ start: '2026-09-01', tasks_created: 30, tasks_completed: 25, plan_items_completed: 6 }] },
  achievements: [
    {
      project: { id: 'p1', key: 'CRM', name: 'CRM', archived: false },
      tasks_done: 48,
      plan_items_done: 12,
      milestones_done: [{ id: 'm0', name: 'Homologação', due_date: '2026-10-10' }],
      recent: [{ kind: 'plan_item', id: 'e3', code: null, title: 'Levantamento', completed_at: '2026-10-20T10:00:00.000Z' }],
    },
  ],
}

function apiReturning(data: ExecutiveDto) {
  const get = vi.fn(() => Promise.resolve({ data, meta: {} }))
  return { api: { get } as unknown as ApiClient, get }
}

describe('repositório do painel executivo', () => {
  it('manda os filtros como a API espera (project_ids separados por vírgula, dias e fuso)', async () => {
    const { api, get } = apiReturning(dto)
    await createHttpExecutiveRepository(api).get({ projectIds: ['a', 'b'], statuses: ['active', 'paused'], from: '2026-01-01', to: '2026-10-29', tzOffset: 180 })
    expect(get).toHaveBeenCalledWith('/executive', { query: { project_ids: 'a,b', statuses: 'active,paused', from: '2026-01-01', to: '2026-10-29', tz_offset: '180' } })

    await createHttpExecutiveRepository(api).get({ projectIds: [], statuses: [], from: null, to: null, tzOffset: 180 })
    expect(get).toHaveBeenLastCalledWith('/executive', { query: { project_ids: undefined, statuses: undefined, from: undefined, to: undefined, tz_offset: '180' } })
  })

  it('converte a resposta (snake_case → camelCase; nulos e valores desconhecidos com padrões seguros)', async () => {
    const { api } = apiReturning(dto)
    const data = await createHttpExecutiveRepository(api).get({ projectIds: [], statuses: [], from: null, to: null, tzOffset: 180 })
    expect(data.generatedAt).toEqual(new Date('2026-10-29T13:42:00.000Z'))
    expect(data.summary.deliveries).toEqual({ tasks: 120, planItems: 25, milestones: 3 })
    const [crm, ops] = data.portfolio
    expect(crm?.health.factors.map((f) => f.key)).toEqual(['schedule'])
    expect(crm?.progress).toEqual({ value: 72, source: 'plan' })
    expect(crm?.project.owner).toEqual({ id: 'u1', name: 'Ana', avatarUrl: null })
    expect(ops?.project).toMatchObject({ cover: 'violet', icon: 'folder', owner: null, dueDate: null })
    expect(ops?.progress).toBeNull()
    expect(data.plan).toBeNull()
    expect(data.kanban.cycleTime).toEqual({ hours: null, count: 0 })
    expect(data.kanban.overdueTasks[0]?.status).toEqual({ id: 's1', name: 'Em andamento', color: 'gray', category: 'in_progress' })
    expect(data.timeline).toEqual({ bucket: 'week', points: [{ start: '2026-09-01', tasksCreated: 30, tasksCompleted: 25, planItemsCompleted: 6 }] })
    expect(data.achievements[0]?.recent[0]).toEqual({ kind: 'plan_item', id: 'e3', code: null, title: 'Levantamento', completedAt: new Date('2026-10-20T10:00:00.000Z') })
  })
})
