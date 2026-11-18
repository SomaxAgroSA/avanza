import { describe, expect, it } from 'vitest'
import type { ExecutiveAchievement, ExecutiveDashboard, ExecutiveProjectOption, PortfolioRow } from './executive'
import type { HealthLevel } from './plan-management'
import type { ProjectStatus } from './projects'
import {
  causesOf,
  deliveryBuckets,
  lateDays,
  panoramaKpis,
  panoramaMilestones,
  panoramaOptions,
  panoramaRows,
  panoramaSynthesis,
  planProgress,
  trackingPeriodRange,
} from './tracking'

const TODAY = '2026-11-18'

function row(
  key: string,
  over: { status?: ProjectStatus; due?: string | null; level?: HealthLevel; blocked?: number; overdue?: number; plan?: [number, number] | null; owner?: string } = {},
): PortfolioRow {
  return {
    project: {
      id: key.toLowerCase(),
      key,
      name: `Projeto ${key}`,
      cover: 'green',
      icon: 'folder',
      status: over.status ?? 'active',
      priority: 'medium',
      area: null,
      startDate: null,
      dueDate: over.due ?? null,
      owner: over.owner ? { id: over.owner, name: over.owner, avatarUrl: null } : null,
      objective: null,
      updatedAt: null,
    },
    health: {
      level: over.level ?? (over.plan ? 'ok' : 'none'),
      factors: over.plan ? [{ key: 'progress', level: 'ok', value: Math.max(0, over.plan[1] - over.plan[0]), actual: over.plan[0], planned: over.plan[1] }] : [],
    },
    // o progresso antigo (pelas tarefas) não entra na média do Panorama
    progress: { value: 90, source: 'tasks' },
    plan: null,
    tasks: { total: 5, open: 3, inProgress: 1, blocked: over.blocked ?? 0, overdue: over.overdue ?? 0, done: 2 },
    nextMilestone: null,
    openIssues: 0,
  }
}

const keys = (rows: PortfolioRow[]) => rows.map((r) => r.project.key)

describe('Panorama — período', () => {
  const now = new Date(2026, 10, 18, 9, 0)
  it('atalhos terminam hoje; personalizado usa as datas e, inválido, volta aos 90 dias', () => {
    expect(trackingPeriodRange('30d', now)).toEqual({ from: '2026-10-20', to: '2026-11-18' })
    expect(trackingPeriodRange('90d', now)).toEqual({ from: '2026-08-21', to: '2026-11-18' })
    expect(trackingPeriodRange('year', now)).toEqual({ from: '2026-01-01', to: '2026-11-18' })
    expect(trackingPeriodRange('custom', now, { from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-03-01', to: '2026-03-31' })
    expect(trackingPeriodRange('custom', now, { from: '2026-04-01', to: '2026-03-01' })).toEqual({ from: '2026-08-21', to: '2026-11-18' })
    expect(trackingPeriodRange('custom', now, { from: null, to: '2026-03-01' })).toEqual({ from: '2026-08-21', to: '2026-11-18' })
  })
})

describe('Panorama — indicadores', () => {
  it('supervisionados: total e quebra por status (concluído só se estiver no escopo)', () => {
    const kpis = panoramaKpis([row('A'), row('B', { status: 'planning' }), row('C', { status: 'paused' }), row('D')], TODAY)
    expect(kpis.supervised).toEqual({
      total: 4,
      byStatus: [
        { status: 'planning', count: 1 },
        { status: 'active', count: 2 },
        { status: 'paused', count: 1 },
      ],
    })
  })

  it('avanço real médio: só projetos com plano (real e planejado do mesmo fator), desvio em pontos', () => {
    const kpis = panoramaKpis([row('A', { plan: [40, 60] }), row('B', { plan: [20, 30] }), row('C')], TODAY)
    expect(kpis.progress).toEqual({ withPlan: 2, total: 3, real: 30, planned: 45, gap: -15 })
    expect(planProgress(row('C'))).toBeNull()
    expect(panoramaKpis([row('X')], TODAY).progress).toEqual({ withPlan: 0, total: 1, real: null, planned: null, gap: null })
  })

  it('em risco: críticos + em atenção, pela saúde', () => {
    const kpis = panoramaKpis([row('A', { level: 'critical' }), row('B', { level: 'critical' }), row('C', { level: 'attention' }), row('D', { level: 'ok' })], TODAY)
    expect(kpis.risk).toEqual({ critical: 2, attention: 1 })
    expect(kpis.health).toEqual({ ok: 1, attention: 1, critical: 2, none: 0 })
  })

  it('bloqueios e vencidas: pausado não conta como bloqueado nem atrasado; tarefas contadas uma vez', () => {
    const rows = [
      row('A', { blocked: 3, overdue: 2, due: '2026-11-10' }),
      row('B', { blocked: 1 }),
      row('P', { status: 'paused', blocked: 5, overdue: 4, due: '2026-10-01' }),
      row('C', { status: 'completed', due: '2026-10-01' }),
    ]
    const kpis = panoramaKpis(rows, TODAY)
    expect(kpis.blocked).toEqual({ projects: 2, tasks: 4 })
    expect(kpis.overdue).toEqual({ tasks: 2, lateProjects: 1 })
    expect(lateDays(rows[0]!, TODAY)).toBe(8)
    expect(lateDays(rows[3]!, TODAY)).toBe(0)
  })
})

describe('Panorama — síntese', () => {
  it('título com os dois fatos mais graves; apoio sem repetir o título; prioridade = o mais grave', () => {
    const kpis = panoramaKpis([row('A', { level: 'critical', blocked: 4, overdue: 3 }), row('B', { level: 'ok' }), row('C', { level: 'ok' })], TODAY)
    expect(panoramaSynthesis(kpis, 12)).toEqual({
      headline: [
        { kind: 'risk', count: 1 },
        { kind: 'blocked', count: 4 },
      ],
      ok: 2,
      total: 3,
      overdueTasks: 3,
      deliveries: 12,
      priority: 'risk',
    })
  })

  it('sem risco nem bloqueio: vencidas no título (e fora do apoio); tudo bem = portfólio em ordem', () => {
    const late = panoramaSynthesis(panoramaKpis([row('A', { overdue: 2, level: 'ok' })], TODAY), 0)
    expect(late.headline).toEqual([{ kind: 'overdue', count: 2 }])
    expect(late.overdueTasks).toBeNull()
    expect(late.priority).toBe('overdue')
    const fine = panoramaSynthesis(panoramaKpis([row('A', { level: 'ok' })], TODAY), 5)
    expect(fine).toMatchObject({ headline: [], priority: null, ok: 1, total: 1, overdueTasks: 0 })
  })
})

describe('Panorama — projetos que requerem atenção', () => {
  const rows = [
    row('OK', { level: 'ok' }),
    row('ATT', { level: 'attention' }),
    row('BLK', { level: 'ok', blocked: 2 }),
    row('BLK2', { level: 'ok', blocked: 5 }),
    row('LATE', { level: 'ok', due: '2026-11-01' }),
    row('CRIT', { level: 'critical' }),
    row('OVD', { level: 'ok', overdue: 1 }),
    row('PAU', { level: 'ok', status: 'paused', blocked: 9, due: '2026-01-01' }),
    row('NONE'),
  ]

  it('prioridade: crítico → data-alvo vencida → mais bloqueios → atenção → vencidas; pausado sozinho não entra', () => {
    expect(keys(panoramaRows(rows, TODAY, 'attention'))).toEqual(['CRIT', 'LATE', 'BLK2', 'BLK', 'ATT', 'OVD'])
  })

  it('a rosca filtra por situação; os indicadores por bloqueio e vencimento; "todos" mostra tudo', () => {
    expect(keys(panoramaRows(rows, TODAY, 'ok')).sort()).toEqual(['BLK', 'BLK2', 'LATE', 'OK', 'OVD', 'PAU'].sort())
    expect(keys(panoramaRows(rows, TODAY, 'none'))).toEqual(['NONE'])
    expect(keys(panoramaRows(rows, TODAY, 'risk'))).toEqual(['CRIT'])
    expect(keys(panoramaRows(rows, TODAY, 'watch'))).toEqual(['ATT'])
    expect(keys(panoramaRows(rows, TODAY, 'blocked'))).toEqual(['BLK2', 'BLK'])
    expect(keys(panoramaRows(rows, TODAY, 'overdue'))).toEqual(['LATE', 'OVD'])
    expect(panoramaRows(rows, TODAY, 'all')).toHaveLength(rows.length)
  })

  it('causas na ordem de gravidade; pausado só informa', () => {
    expect(causesOf(row('X', { level: 'critical', due: '2026-11-08', blocked: 2, overdue: 1 }), TODAY)).toEqual([
      { kind: 'health', level: 'critical' },
      { kind: 'late', days: 10 },
      { kind: 'blocked', count: 2 },
      { kind: 'overdueTasks', count: 1 },
    ])
    expect(causesOf(row('P', { status: 'paused', blocked: 2, due: '2026-01-01' }), TODAY)).toEqual([{ kind: 'paused' }])
  })
})

describe('Panorama — marcos e entregas', () => {
  const crm = { id: 'crm', key: 'CRM', name: 'CRM' }
  const app = { id: 'app', key: 'APP', name: 'App' }
  const plan = {
    upcomingMilestones: [
      { id: 'm3', name: 'Piloto', dueDate: '2026-12-10', project: crm },
      { id: 'm2', name: 'Fechamento', dueDate: '2026-11-20', project: app },
      { id: 'mx', name: 'Fora do filtro', dueDate: '2026-11-19', project: { id: 'outro', key: 'OUT', name: 'Outro' } },
    ],
    overdueMilestones: [{ id: 'm1', name: 'Protótipo', dueDate: '2026-11-14', project: app }],
  } as unknown as ExecutiveDashboard['plan']

  it('vencidos e próximos em ordem de data, com o responsável do projeto; só os projetos da tela', () => {
    const rows = [row('CRM', { owner: 'Ana' }), row('APP', { owner: 'Douglas' })]
    expect(panoramaMilestones(plan, rows, TODAY).map((m) => [m.name, m.state, m.days, m.owner?.name])).toEqual([
      ['Protótipo', 'overdue', 4, 'Douglas'],
      ['Fechamento', 'soon', 2, 'Douglas'],
      ['Piloto', 'planned', 22, 'Ana'],
    ])
    expect(panoramaMilestones(null, rows, TODAY)).toEqual([])
  })

  it('entregas por semana: tarefas da série e marcos concluídos no balde da data', () => {
    const points = [
      { start: '2026-11-02', tasksCreated: 0, tasksCompleted: 3, planItemsCompleted: 0, tasksInProgress: 0, tasksOverdue: 0 },
      { start: '2026-11-09', tasksCreated: 0, tasksCompleted: 5, planItemsCompleted: 0, tasksInProgress: 0, tasksOverdue: 0 },
    ]
    const achievements: ExecutiveAchievement[] = [
      {
        project: { ...crm, archived: false, status: 'completed' },
        tasksDone: 8,
        planItemsDone: 0,
        milestonesDone: [
          { id: 'a', name: 'A', dueDate: '2026-11-11' },
          { id: 'b', name: 'B', dueDate: null },
        ],
        recent: [],
      },
    ]
    expect(deliveryBuckets(points, achievements)).toEqual([
      { start: '2026-11-02', tasks: 3, milestones: 0 },
      { start: '2026-11-09', tasks: 5, milestones: 1 },
    ])
  })
})

describe('Panorama — opções dos filtros', () => {
  const option = (id: string, over: Partial<ExecutiveProjectOption> = {}): ExecutiveProjectOption => ({
    id,
    key: id.toUpperCase(),
    name: id,
    cover: 'green',
    icon: 'folder',
    status: 'active',
    archived: false,
    member: false,
    area: null,
    owner: null,
    ...over,
  })
  const catalog = [
    option('crm', { area: { id: 'a1', name: 'Comercial' }, owner: { id: 'u1', name: 'Ana', avatarUrl: null } }),
    option('erp', { area: { id: 'a2', name: 'Finanças' }, owner: { id: 'u2', name: 'Bruno', avatarUrl: null } }),
    option('ops', { owner: { id: 'u1', name: 'Ana', avatarUrl: null } }),
    option('old', { archived: true, area: { id: 'a3', name: 'Arquivo' } }),
    option('fim', { status: 'completed', area: { id: 'a4', name: 'Concluídos' } }),
  ]

  it('só os supervisionados; os projetos seguem a área e o responsável escolhidos', () => {
    const all = panoramaOptions(catalog, { areaId: '', ownerId: '' })
    expect(all.areas.map((a) => a.name)).toEqual(['Comercial', 'Finanças'])
    expect(all.withoutArea).toBe(true)
    expect(all.owners.map((o) => o.name)).toEqual(['Ana', 'Bruno'])
    expect(all.projects.map((p) => p.id)).toEqual(['crm', 'erp', 'ops'])
    expect(panoramaOptions(catalog, { areaId: 'none', ownerId: '' }).projects.map((p) => p.id)).toEqual(['ops'])
    expect(panoramaOptions(catalog, { areaId: '', ownerId: 'u1' }).projects.map((p) => p.id)).toEqual(['crm', 'ops'])
  })
})
