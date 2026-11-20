import { describe, expect, it } from 'vitest'
import { deadlineToIso, demandActionsFor, groupByStatus, isoToDeadline, loadPercent, type DemandStatus } from './demands'

const person = (id: string) => ({ id, name: id, email: `${id}@x`, avatarUrl: null })
const demand = (status: DemandStatus, extra: { assignee?: string; owner?: string; reporter?: string } = {}) => ({
  assignee: extra.assignee ? person(extra.assignee) : null,
  reporter: person(extra.reporter ?? 'ana'),
  demand: { status, owner: person(extra.owner ?? 'cesar'), dueAt: null, openedAt: null },
})

describe('domain/demands (§45)', () => {
  it('botões por papel e passo: responsável atribui; quem executa começa, passa e conclui; quem pediu valida e devolve', () => {
    expect(demandActionsFor('cesar', demand('unassigned'))).toEqual({ assign: true, start: false, pass: false, conclude: false, validate: false, return: false })
    expect(demandActionsFor('jorge', demand('assigned', { assignee: 'jorge' }))).toEqual({ assign: false, start: true, pass: true, conclude: true, validate: false, return: false })
    expect(demandActionsFor('jorge', demand('in_progress', { assignee: 'jorge' }))).toEqual({ assign: false, start: false, pass: true, conclude: true, validate: false, return: false })
    expect(demandActionsFor('ana', demand('to_validate', { assignee: 'jorge' }))).toEqual({ assign: false, start: false, pass: false, conclude: false, validate: true, return: true })
    expect(demandActionsFor('cesar', demand('to_validate', { assignee: 'jorge' })).assign).toBe(false)
    expect(demandActionsFor(undefined, demand('unassigned')).assign).toBe(false)
    expect(demandActionsFor('cesar', { assignee: null, reporter: null, demand: null }).assign).toBe(false)
  })

  it('quem vê todas (projects.view_all) também atribui e reatribui; o resto continua dos papéis', () => {
    const viewAll = { viewAll: true }
    expect(demandActionsFor('root', demand('unassigned'), viewAll)).toEqual({ assign: true, start: false, pass: false, conclude: false, validate: false, return: false })
    expect(demandActionsFor('root', demand('in_progress', { assignee: 'jorge' }), viewAll).assign).toBe(true)
    expect(demandActionsFor('root', demand('to_validate', { assignee: 'jorge' }), viewAll).assign).toBe(false)
    expect(demandActionsFor('root', { assignee: null, reporter: null, demand: null }, viewAll).assign).toBe(false)
  })

  it('agrupa por passo na ordem do fluxo, sem grupos vazios', () => {
    const list = [demand('in_progress'), demand('unassigned'), demand('in_progress')]
    expect(groupByStatus(list).map((g) => [g.status, g.items.length])).toEqual([
      ['unassigned', 1],
      ['in_progress', 2],
    ])
  })

  it('barra da carga proporcional à maior carga em horas', () => {
    const team = [
      { user: person('a'), openCount: 2, estimatedHours: 8 },
      { user: person('b'), openCount: 1, estimatedHours: 2 },
    ]
    expect(loadPercent(8, team)).toBe(100)
    expect(loadPercent(2, team)).toBe(25)
    expect(loadPercent(0, team)).toBe(0)
    expect(loadPercent(3, [])).toBe(0)
  })

  it('prazo: data e hora locais ⇄ ISO; inválido não vale', () => {
    const iso = deadlineToIso('2026-11-21', '17:00')
    expect(iso).not.toBeNull()
    expect(isoToDeadline(new Date(iso!))).toEqual({ day: '2026-11-21', time: '17:00' })
    expect(deadlineToIso('2026-11-21', '25:00')).toBeNull()
    expect(deadlineToIso('', '10:00')).toBeNull()
    expect(isoToDeadline(null)).toEqual({ day: '', time: '' })
  })
})
