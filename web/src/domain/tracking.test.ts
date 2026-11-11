import { describe, expect, it } from 'vitest'
import type { PortfolioRow } from './executive'
import type { HealthLevel } from './plan-management'
import type { ProjectPriority, ProjectStatus } from './projects'
import {
  applyTrackingFilter,
  decisionItems,
  groupPortfolio,
  isBlocked,
  lateDays,
  scopeOptions,
  scopeRows,
  trackingPeriodRange,
  trackingSummary,
  upcomingDeliveries,
} from './tracking'

const TODAY = '2026-11-11'

function row(
  key: string,
  over: { priority?: ProjectPriority; status?: ProjectStatus; due?: string | null; level?: HealthLevel; blocked?: number; area?: string | null; owner?: string | null } = {},
): PortfolioRow {
  return {
    project: {
      id: key.toLowerCase(),
      key,
      name: `Projeto ${key}`,
      cover: 'green',
      icon: 'folder',
      status: over.status ?? 'active',
      priority: over.priority ?? 'medium',
      area: over.area ? { id: over.area, name: over.area } : null,
      startDate: null,
      dueDate: over.due ?? null,
      owner: over.owner ? { id: over.owner, name: over.owner, avatarUrl: null } : null,
    },
    health: { level: over.level ?? 'ok', factors: [] },
    progress: null,
    plan: null,
    tasks: { total: 0, open: 0, inProgress: 0, blocked: over.blocked ?? 0, overdue: 0, done: 0 },
    nextMilestone: null,
    openIssues: 0,
  }
}

describe('seguimento de projetos', () => {
  it('atraso só conta para projetos abertos com a data-alvo vencida', () => {
    expect(lateDays(row('A', { due: '2026-11-05' }), TODAY)).toBe(6)
    expect(lateDays(row('B', { due: '2026-11-20' }), TODAY)).toBe(0)
    expect(lateDays(row('C', { due: '2026-11-05', status: 'completed' }), TODAY)).toBe(0)
    expect(lateDays(row('D'), TODAY)).toBe(0)
  })

  it('bloqueado = pausado ou com tarefa bloqueada; o resumo conta cada regra', () => {
    const rows = [row('A', { status: 'paused' }), row('B', { blocked: 2 }), row('C', { due: '2026-11-01', level: 'critical' }), row('D')]
    expect(rows.map(isBlocked)).toEqual([true, true, false, false])
    expect(trackingSummary(rows, TODAY)).toEqual({ active: 4, late: 1, blocked: 2, risk: 1 })
    expect(applyTrackingFilter(rows, 'blocked', TODAY).map((r) => r.project.key)).toEqual(['A', 'B'])
    expect(applyTrackingFilter(rows, null, TODAY)).toHaveLength(4)
  })

  it('decisão: só projetos com motivo, por prioridade e depois o maior atraso', () => {
    const items = decisionItems(
      [
        row('M', { priority: 'medium', due: '2026-11-10' }),
        row('H', { priority: 'high', status: 'paused' }),
        row('M2', { priority: 'medium', due: '2026-11-01', blocked: 1 }),
        row('OK', { priority: 'critical' }),
      ],
      TODAY,
    )
    expect(items.map((i) => i.row.project.key)).toEqual(['H', 'M2', 'M'])
    expect(items[1]?.reasons).toEqual([{ kind: 'late', days: 10 }, { kind: 'blockedTasks', count: 1 }])
  })

  it('agrupa por prioridade (Crítica → Baixa) e por área (sem área no fim), em risco primeiro', () => {
    const rows = [
      row('A', { priority: 'low', area: 'Comercial' }),
      row('B', { priority: 'high', area: 'Logística', level: 'ok' }),
      row('C', { priority: 'high', level: 'critical' }),
      row('D', { priority: 'high', area: 'Comercial', due: '2026-11-01' }),
    ]
    const byPriority = groupPortfolio(rows, 'priority', TODAY)
    expect(byPriority.map((g) => g.key)).toEqual(['high', 'low'])
    expect(byPriority[0]?.rows.map((r) => r.project.key)).toEqual(['C', 'D', 'B'])
    expect(byPriority[0]?.late).toBe(1)
    expect(groupPortfolio(rows, 'area', TODAY).map((g) => g.name || g.key)).toEqual(['Comercial', 'Logística', 'none'])
  })

  it('escopo por departamento e responsável, com opções sem repetir', () => {
    const rows = [row('A', { area: 'Comercial', owner: 'Ana' }), row('B', { area: 'Comercial', owner: 'Bia' }), row('C', { owner: 'Ana' })]
    expect(scopeRows(rows, { areaId: 'Comercial', ownerId: '' }).map((r) => r.project.key)).toEqual(['A', 'B'])
    expect(scopeRows(rows, { areaId: 'none', ownerId: 'Ana' }).map((r) => r.project.key)).toEqual(['C'])
    expect(scopeOptions(rows, 'owner')).toEqual([
      { id: 'Ana', name: 'Ana' },
      { id: 'Bia', name: 'Bia' },
    ])
  })

  it('próximas entregas: marcos e datas-alvo dos próximos 30 dias, por data', () => {
    const a = row('A', { due: '2026-11-30' })
    const b = row('B', { due: '2027-02-01' })
    const list = upcomingDeliveries(
      {
        portfolio: [a, b],
        plan: {
          items: { total: 0, done: 0, open: 0, overdue: 0, stuck: 0, canceled: 0 },
          statusDistribution: [],
          schedule: { onTime: 0, overdue: 0, unscheduled: 0, done: 0 },
          effort: { estimated: null, actual: null, remaining: null },
          issues: [],
          openIssuesTotal: 0,
          upcomingMilestones: [{ id: 'm1', name: 'Piloto', dueDate: '2026-11-20', project: { id: 'b', key: 'B', name: 'Projeto B' } }],
        },
      },
      [a, b],
      TODAY,
    )
    expect(list.map((d) => [d.date, d.kind, d.row.project.key])).toEqual([
      ['2026-11-20', 'milestone', 'B'],
      ['2026-11-30', 'due', 'A'],
    ])
  })

  it('períodos contam hoje', () => {
    const now = new Date(2026, 10, 11, 9, 30)
    expect(trackingPeriodRange('30d', now)).toEqual({ from: '2026-10-13', to: '2026-11-11' })
    expect(trackingPeriodRange('year', now)).toEqual({ from: '2026-01-01', to: '2026-11-11' })
  })
})

describe('panorama', () => {
  it('avanço médio só de quem mede e contagem por situação', async () => {
    const { averageProgress, situationCounts } = await import('./tracking')
    const a = { ...row('A'), progress: { value: 40, source: 'plan' as const } }
    const b = { ...row('B', { level: 'critical' }), progress: { value: 80, source: 'tasks' as const } }
    expect(averageProgress([a, b, row('C')])).toBe(60)
    expect(averageProgress([row('C')])).toBeNull()
    expect(situationCounts([a, b, row('C', { level: 'none' })])).toEqual({ risk: 1, watch: 0, ok: 1, none: 1 })
  })

  it('requer atenção: o motivo mais grave dá o rótulo; entregas próximas de quem não está na lista vêm depois', async () => {
    const { panoramaAttention } = await import('./tracking')
    const late = row('L', { due: '2026-11-01', blocked: 2 })
    const paused = row('P', { status: 'paused', priority: 'high' })
    const soon = row('S', { due: '2026-11-14' })
    const list = panoramaAttention({ portfolio: [late, paused, soon], plan: null }, [late, paused, soon], TODAY)
    expect(list.map((i) => [i.kind, i.row.project.key])).toEqual([
      ['paused', 'P'],
      ['late', 'L'],
      ['soon', 'S'],
    ])
    expect(list[2]?.soon?.days).toBe(3)
  })
})
