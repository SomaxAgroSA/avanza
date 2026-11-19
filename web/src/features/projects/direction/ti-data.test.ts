import { describe, expect, it } from 'vitest'
import type { TiDelivery, TiDependencies, TiProject } from '@/domain/ti-dependencies'
import { dueLabel, tiAffected, tiInScope, tiPeopleOf } from './ti-data'

const fvb = { id: 'p1', key: 'FVB', name: 'Fuerza de Ventas Brasil' }
const dre = { id: 'p2', key: 'DRE', name: 'DRE Somax Paraguay' }
const victor = { id: 'u9', name: 'Equipo de Informática', email: 'ti@x.com', avatarUrl: null }
const other = { id: 'u8', name: 'TI do DRE', email: 'ti2@x.com', avatarUrl: null }

const delivery = (id: string, project: typeof fvb, assigneeId: string, extra: Partial<TiDelivery> = {}): TiDelivery => ({
  id, code: id.toUpperCase(), title: `Entrega ${id}`, project, dueDate: null, assigneeId, waitingDays: 2, daysLeft: null, risk: 'none_due', blocks: 0, blocksProjects: [], ...extra,
})
const counts = (extra: Partial<TiProject['counts']> = {}) => ({ deliveries: 1, blocked: 0, pending: 0, noneDue: 1, afterProjectDue: 0, overdue: 0, dueSoon: 0, ...extra })
const TI: TiDependencies = {
  today: '2026-11-19',
  people: [victor, other],
  projects: [
    { project: { ...fvb, dueDate: '2026-12-31' }, counts: counts({ pending: 1 }), deliveries: [delivery('t1', fvb, 'u9')], blocked: [], pending: [] },
    { project: { ...dre, dueDate: null }, counts: counts({ blocked: 1, noneDue: 0, overdue: 1 }), deliveries: [delivery('t2', dre, 'u8', { risk: 'overdue', dueDate: '2026-11-18' })], blocked: [], pending: [] },
  ],
}

describe('ti-data: recorte do painel', () => {
  it('só os projetos afetados do recorte, somando as contagens; o ⚠ vale para todos os afetados', () => {
    const both = tiInScope(TI, [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
    expect(both.totals).toEqual({ deliveries: 2, blocked: 1, pending: 1, noneDue: 1, afterProjectDue: 0, overdue: 1, dueSoon: 0, projects: 2 })
    expect(tiInScope(TI, [{ id: 'p3' }]).projects).toEqual([])
    expect(tiInScope(TI, [{ id: 'p1' }, { id: 'p2' }], 'p2').projects.map((p) => p.project.key)).toEqual(['DRE'])
    expect(tiInScope(undefined, [{ id: 'p1' }]).totals.projects).toBe(0)
    expect([...tiAffected(TI)]).toEqual(['p1', 'p2'])
  })

  it('responsáveis: os das entregas mostradas; sem nenhuma, todos', () => {
    expect(tiPeopleOf(TI, [TI.projects[0]!]).map((u) => u.name)).toEqual(['Equipo de Informática'])
    expect(tiPeopleOf(TI, []).map((u) => u.name)).toEqual(['Equipo de Informática', 'TI do DRE'])
  })
})

describe('ti-data: coluna Prazo', () => {
  const today = '2026-11-19'
  it('rótulos curtos e tons', () => {
    expect(dueLabel(null, today)).toEqual({ tone: 'warn', kind: 'none', days: 0, withYear: false })
    expect(dueLabel('2027-01-04', today, 'after_project_due')).toEqual({ tone: 'crit', kind: 'afterClose', days: 0, withYear: true })
    expect(dueLabel('2026-11-18', today, 'overdue')).toMatchObject({ tone: 'crit', kind: 'overdue' })
    expect(dueLabel('2026-11-19', today)).toMatchObject({ tone: 'crit', kind: 'today' })
    expect(dueLabel('2026-11-20', today)).toMatchObject({ tone: 'crit', kind: 'tomorrow' })
    expect(dueLabel('2026-11-22', today)).toMatchObject({ tone: 'crit', kind: 'inDays', days: 3 })
    expect(dueLabel('2026-11-26', today, 'ok')).toMatchObject({ tone: 'ok', kind: 'inDays', days: 7 })
  })
})
