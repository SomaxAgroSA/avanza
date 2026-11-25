import { describe, expect, it } from 'vitest'
import {
  countByStatus,
  deadlineToIso,
  demandActionsFor,
  groupByStatus,
  hasInboxFilters,
  inboxQuery,
  isoToDeadline,
  loadPercent,
  readInboxFilters,
  sortByUrgencyPriority,
  writeInboxFilters,
  hasPersonFilters,
  personQuery,
  readPersonFilters,
  toInboxView,
  writePersonFilters,
  type DemandStatus,
} from './demands'

const person = (id: string) => ({ id, name: id, email: `${id}@x`, avatarUrl: null })
const demand = (status: DemandStatus, extra: { assignee?: string; owner?: string; reporter?: string } = {}) => ({
  assignee: extra.assignee ? person(extra.assignee) : null,
  reporter: person(extra.reporter ?? 'ana'),
  demand: { status, owner: person(extra.owner ?? 'cesar'), dueAt: null, openedAt: null },
})

describe('domain/demands — filtros e ordem da Bandeja (ajuste 23/11)', () => {
  it('filtros no endereço: lê, grava (vazios saem, a caixa fica) e vira a consulta', () => {
    const params = new URLSearchParams('box=assigned&q=dmr&project=internal&priority=p1,p2&urgency=high,none')
    const filters = readInboxFilters(params)
    expect(filters).toEqual({ search: 'dmr', projectId: 'internal', priorityIds: ['p1', 'p2'], urgencies: ['high', 'none'] })
    expect(hasInboxFilters(filters)).toBe(true)
    expect(inboxQuery(filters)).toEqual({ search: 'dmr', projectId: 'internal', priorityIds: ['p1', 'p2'], urgencies: ['high', 'none'] })
    const cleared = writeInboxFilters(params, { search: '', projectId: '', priorityIds: [], urgencies: ['high'] })
    expect(cleared.toString()).toBe('box=assigned&urgency=high')
    expect(hasInboxFilters(readInboxFilters(new URLSearchParams('box=all')))).toBe(false)
    expect(inboxQuery({ search: '  ', projectId: '', priorityIds: [], urgencies: [] })).toEqual({})
  })

  it('filtros de pessoa e empresa (25/11): lê, grava sem mexer nos outros e vira a consulta', () => {
    const params = new URLSearchParams('box=all&q=dmr&owner=u2&company=c1')
    const people = readPersonFilters(params)
    expect(people).toEqual({ ownerId: 'u2', assigneeId: '', companyId: 'c1' })
    expect(hasPersonFilters(people)).toBe(true)
    expect(personQuery(people)).toEqual({ ownerId: 'u2', companyId: 'c1' })
    expect(writePersonFilters(params, { ownerId: '', assigneeId: 'u3', companyId: '' }).toString()).toBe('box=all&q=dmr&assignee=u3')
    expect(hasPersonFilters(readPersonFilters(new URLSearchParams('box=all')))).toBe(false)
  })

  it('visão da Caixa de entrada (25/11): lista ou linha do tempo; o resto vira lista', () => {
    expect(toInboxView('timeline')).toBe('timeline')
    expect(toInboxView('gantt')).toBe('list')
    expect(toInboxView(null)).toBe('list')
  })

  it('ordem: as mais urgentes primeiro, depois a prioridade mais importante; empate mantém a ordem', () => {
    const task = (id: string, urgency: 'high' | 'medium' | 'low' | null, priority: string | null) => ({ id, urgency, priority: priority ? { id: priority, key: priority, name: priority, color: 'gray' as const } : null })
    const list = [task('a', null, 'baixa'), task('b', 'low', 'critica'), task('c', 'high', 'media'), task('d', 'high', 'critica'), task('e', 'medium', null), task('f', null, 'baixa')]
    expect(sortByUrgencyPriority(list, ['critica', 'alta', 'media', 'baixa']).map((t) => t.id)).toEqual(['d', 'c', 'e', 'b', 'a', 'f'])
  })

  it('números por passo (quando há filtro)', () => {
    expect(countByStatus([demand('unassigned'), demand('unassigned'), demand('to_validate')])).toEqual({ unassigned: 2, assigned: 0, in_progress: 0, to_validate: 1, done: 0 })
  })
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
