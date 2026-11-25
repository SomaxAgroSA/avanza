import { describe, expect, it } from 'vitest'
import type { DepDelivery, Dependencies, DepProject } from '@/domain/dependencies'
import { areaChips, depAffected, depInScope, dueLabel } from './dependency-data'

const fvb = { id: 'p1', key: 'FVB', name: 'Fuerza de Ventas Brasil' }
const dre = { id: 'p2', key: 'DRE', name: 'DRE Somax Paraguay' }
const TI = { key: 'ti', name: 'TI' }
const FIN = { key: 'financas', name: 'Finanças' }

const delivery = (id: string, project: typeof fvb, area: typeof TI, extra: Partial<DepDelivery> = {}): DepDelivery => ({
  id, code: id.toUpperCase(), title: `Entrega ${id}`, project, area, dueDate: null, assigneeId: 'u9', waitingDays: 2, daysLeft: null, risk: 'none_due', blocks: 0, blocksProjects: [], ...extra,
})
const counts = (extra: Partial<DepProject['counts']> = {}) => ({ deliveries: 1, blocked: 0, pending: 0, noneDue: 1, overdue: 0, ...extra })
const ref = (id: string, project: typeof fvb, area = TI) => ({ id, code: id.toUpperCase(), title: `Entrega ${id}`, project, area, dueDate: null })
const DEPS: Dependencies = {
  today: '2026-11-19',
  people: [],
  areas: [
    { ...TI, deliveries: 2 },
    { ...FIN, deliveries: 1 },
    { key: 'comercial', name: 'Comercial', deliveries: 0 },
  ],
  projects: [
    {
      project: { ...fvb, dueDate: '2026-12-31' },
      counts: counts({ pending: 1 }),
      deliveries: [delivery('t1', fvb, TI)],
      blocked: [],
      pending: [{ id: 't5', code: 'FVB-5', title: 'Segurança', project: fvb, dueDate: null, relatedTo: ref('t1', fvb), relationId: 'r2' }],
    },
    {
      project: { ...dre, dueDate: null },
      counts: counts({ deliveries: 2, blocked: 1, noneDue: 0, overdue: 1 }),
      deliveries: [delivery('t2', dre, TI, { risk: 'overdue', dueDate: '2026-11-18' }), delivery('t3', dre, FIN, { risk: 'ok', dueDate: '2026-11-25' })],
      blocked: [{ id: 't4', code: 'DRE-4', title: 'Dashboard', project: dre, dueDate: null, waitingOn: [{ ...ref('t1', fvb), relationId: 'r1' }] }],
      pending: [],
    },
  ],
}

describe('dependency-data: recorte do painel', () => {
  it('só os projetos afetados do recorte, somando as contagens; o ⚠ vale para todos os afetados', () => {
    const both = depInScope(DEPS, [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
    expect(both.totals).toEqual({ deliveries: 3, blocked: 1, pending: 1, noneDue: 1, overdue: 1, projects: 2 })
    expect(depInScope(DEPS, [{ id: 'p3' }]).projects).toEqual([])
    expect(depInScope(DEPS, [{ id: 'p1' }, { id: 'p2' }], 'p2').projects.map((p) => p.project.key)).toEqual(['DRE'])
    expect(depInScope(undefined, [{ id: 'p1' }]).totals.projects).toBe(0)
    expect([...depAffected(DEPS)]).toEqual(['p1', 'p2'])
  })

  it('filtro por área: só entregas, bloqueios e a validar daquela área; projetos sem nada dela saem', () => {
    const scope = [{ id: 'p1' }, { id: 'p2' }]
    const fin = depInScope(DEPS, scope, null, 'financas')
    expect(fin.projects.map((p) => [p.project.key, p.deliveries.map((d) => d.code), p.blocked.length, p.pending.length])).toEqual([['DRE', ['T3'], 0, 0]])
    expect(fin.totals).toEqual({ deliveries: 1, blocked: 0, pending: 0, noneDue: 0, overdue: 0, projects: 1 })
    const ti = depInScope(DEPS, scope, null, 'ti')
    expect(ti.projects.map((p) => [p.project.key, p.deliveries.map((d) => d.code), p.blocked.length, p.pending.length])).toEqual([
      ['FVB', ['T1'], 0, 1],
      ['DRE', ['T2'], 1, 0],
    ])
  })

  it('chips: "todas" + uma por área com entregas no recorte, na ordem das áreas', () => {
    const scope = depInScope(DEPS, [{ id: 'p1' }, { id: 'p2' }])
    expect(areaChips(DEPS, scope.projects)).toEqual({ total: 3, areas: [{ ...TI, count: 2 }, { ...FIN, count: 1 }] })
    const onlyFvb = depInScope(DEPS, [{ id: 'p1' }])
    expect(areaChips(DEPS, onlyFvb.projects)).toEqual({ total: 1, areas: [{ ...TI, count: 1 }] })
  })
})

describe('dependency-data: coluna Prazo (só o prazo da tarefa)', () => {
  const today = '2026-11-19'
  it('sem prazo âmbar; vencida vermelha com os dias; o resto verde; ano quando não é o atual', () => {
    expect(dueLabel(null, today)).toEqual({ tone: 'warn', kind: 'none', days: 0, withYear: false })
    expect(dueLabel('2026-11-18', today)).toEqual({ tone: 'crit', kind: 'overdue', days: 1, withYear: false })
    expect(dueLabel('2026-11-09', today)).toEqual({ tone: 'crit', kind: 'overdue', days: 10, withYear: false })
    expect(dueLabel('2026-11-19', today)).toEqual({ tone: 'ok', kind: 'today', days: 0, withYear: false })
    expect(dueLabel('2026-11-20', today)).toEqual({ tone: 'ok', kind: 'tomorrow', days: 1, withYear: false })
    expect(dueLabel('2026-11-22', today)).toEqual({ tone: 'ok', kind: 'inDays', days: 3, withYear: false })
    expect(dueLabel('2027-01-04', today)).toEqual({ tone: 'ok', kind: 'inDays', days: 46, withYear: true })
    expect(dueLabel('2025-12-30', today)).toMatchObject({ tone: 'crit', kind: 'overdue', withYear: true })
  })
})
