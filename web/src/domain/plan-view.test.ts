import { describe, expect, it } from 'vitest'
import type { Plan, PlanGroup, PlanItem } from './plan'
import {
  EMPTY_FILTERS,
  activeFilterCount,
  boardSections,
  dependenciesOf,
  expandedByNarrowing,
  groupedSections,
  isOverdue,
  linkCandidates,
  summarize,
  type PlanFilters,
} from './plan-view'

const group = (id: string, number: string, extra: Partial<PlanGroup> = {}): PlanGroup => ({ id, parentId: null, name: id, color: 'blue', position: 0, number, summary: null, ...extra })

let pos = 0
const item = (id: string, groupId: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  id,
  groupId,
  parentId: null,
  name: id,
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
  position: ++pos,
  blocked: false,
  updates: 0,
  files: 0,
  baselineStart: null,
  baselineEnd: null,
  custom: {},
  ...extra,
})

const person = (id: string) => ({ id, name: id, email: `${id}@x.com`, avatarUrl: null })

function plan(items: PlanItem[], extra: Partial<Plan> = {}): Plan {
  return {
    project: { id: 'p', key: 'P', name: 'P', archived: false },
    capabilities: { edit: true, manage: true },
    statuses: [
      { id: 'todo', name: 'Planejado', color: 'blue', category: 'todo', position: 1 },
      { id: 'doing', name: 'Em progresso', color: 'amber', category: 'in_progress', position: 2 },
      { id: 'done', name: 'Feito', color: 'green', category: 'done', position: 3 },
      { id: 'cancel', name: 'Cancelado', color: 'gray', category: 'canceled', position: 4 },
    ],
    resources: [
      { id: 'gp', name: 'Gerente', color: 'indigo' },
      { id: 'cli', name: 'Cliente', color: 'teal' },
    ],
    groups: [group('ini', '1.0'), group('pl', '2.0'), group('pp', '2.1', { parentId: 'pl' })],
    items,
    links: [],
    columns: [],
    settings: { dependencyRule: 'warn', baselineAt: null },
    summary: null,
    truncated: false,
    ...extra,
  }
}

const withFilters = (patch: Partial<PlanFilters>): PlanFilters => ({ ...EMPTY_FILTERS, ...patch })
const ids = (p: Plan, f: Partial<PlanFilters>) =>
  boardSections(p, { filters: withFilters(f), today: '2026-03-01' })
    .flatMap((s) => s.items)
    .map((i) => i.id)

describe('plan-view — filtros da barra', () => {
  const items = [
    item('a', 'ini', { statusId: 'done', resourceIds: ['gp'], startDate: '2026-01-10', endDate: '2026-01-20', progress: { value: 100, source: 'done' } }),
    item('b', 'ini', { statusId: 'doing', startDate: '2026-02-01', endDate: '2026-02-10', progress: { value: 40, source: 'manual' }, blocked: true }),
    item('c', 'pp', { resourceIds: ['cli'], startDate: '2026-03-05' }),
    item('d', 'pl'),
  ]
  const p = plan(items, { links: [{ id: 'l1', fromId: 'a', toId: 'b', type: 'blocks' }] })

  it('combina campos (E) e valores (OU); "em branco" e "sem recurso" contam', () => {
    expect(ids(p, { statusIds: ['done', 'doing'] })).toEqual(['a', 'b'])
    expect(ids(p, { statusIds: [''] })).toEqual(['d', 'c'])
    expect(ids(p, { resourceIds: [''] })).toEqual(['b', 'd'])
    expect(ids(p, { statusIds: ['doing', ''], resourceIds: ['cli'] })).toEqual(['c'])
    expect(activeFilterCount(withFilters({ statusIds: ['x'], overdue: true, ownerIds: ['u'] }))).toBe(2)
  })

  it('grupo (a fase inclui os subgrupos), período, progresso, atrasados e dependências', () => {
    expect(ids(p, { groupIds: ['pl'] })).toEqual(['d', 'c'])
    expect(ids(p, { period: { start: '2026-01-15', end: '2026-02-02' } })).toEqual(['a', 'b'])
    expect(ids(p, { progress: ['in_progress'] })).toEqual(['b'])
    expect(ids(p, { progress: ['not_started'] })).toEqual(['d', 'c'])
    expect(ids(p, { overdue: true })).toEqual(['b'])
    expect(ids(p, { dependency: 'blocked' })).toEqual(['b'])
    expect(ids(p, { dependency: 'linked' })).toEqual(['a', 'b'])
  })

  it('atrasado: fim passou e não está encerrado', () => {
    expect(isOverdue(item('x', 'ini', { endDate: '2026-02-01' }), '2026-03-01', 'in_progress')).toBe(true)
    expect(isOverdue(item('x', 'ini', { endDate: '2026-02-01' }), '2026-03-01', 'done')).toBe(false)
    expect(isOverdue(item('x', 'ini', { startDate: '2026-04-01' }), '2026-03-01', null)).toBe(false)
  })

  it('com filtro, os totais do rodapé são os dos elementos visíveis', () => {
    const [ini] = boardSections(p, { filters: withFilters({ statusIds: ['doing'] }) })
    expect(ini?.group.summary?.items).toBe(1)
    expect(ini?.group.summary?.startDate).toBe('2026-02-01')
  })
})

describe('plan-view — pessoa (responsável dos subelementos)', () => {
  const items = [
    item('a', 'ini', { name: 'Kickoff' }),
    item('a1', 'ini', { parentId: 'a', name: 'Pauta', owner: person('ana') }),
    item('a2', 'ini', { parentId: 'a', name: 'Convites', owner: person('bia') }),
    item('b', 'ini', { name: 'Sem subelementos' }),
  ]
  const p = plan(items)

  it('mostra só os elementos com subelementos da pessoa (e só esses subelementos), já abertos', () => {
    const sections = boardSections(p, { filters: withFilters({ ownerIds: ['ana'] }) })
    expect(sections.flatMap((s) => s.items).map((i) => i.id)).toEqual(['a'])
    expect(sections[0]?.subitems.get('a')?.map((i) => i.id)).toEqual(['a1'])
    expect([...expandedByNarrowing(sections, { filters: withFilters({ ownerIds: ['ana'] }) })]).toEqual(['a'])
    // com busca junto
    const both = boardSections(p, { query: 'convites', filters: withFilters({ ownerIds: ['ana'] }) })
    expect(both.flatMap((s) => s.items)).toEqual([])
  })
})

describe('plan-view — agrupar por', () => {
  const items = [
    item('a', 'ini', { statusId: 'done', resourceIds: ['gp', 'cli'], startDate: '2026-01-10', estimatedHours: 2 }),
    item('b', 'pp', { statusId: 'doing', startDate: '2026-02-01', estimatedHours: 1 }),
    item('c', 'ini', { statusId: 'gone' }),
  ]
  const p = plan(items)
  const labels = { noStatus: 'Em branco', noResource: 'Sem recurso', noSchedule: 'Sem cronograma' }

  it('status (na ordem das etiquetas; em branco no fim, inclusive etiqueta que não existe mais)', () => {
    const sections = groupedSections(p, 'status', { labels, locale: 'pt-BR' })
    expect(sections.map((s) => [s.group.name, s.items.map((i) => i.id)])).toEqual([
      ['Em progresso', ['b']],
      ['Feito', ['a']],
      ['Em branco', ['c']],
    ])
    expect(sections.every((s) => s.synthetic)).toBe(true)
    expect(sections[0]?.group.color).toBe('amber')
  })

  it('recurso (o elemento aparece em cada um) e cronograma por mês', () => {
    expect(groupedSections(p, 'resource', { labels, locale: 'pt-BR' }).map((s) => [s.group.name, s.items.map((i) => i.id)])).toEqual([
      ['Cliente', ['a']],
      ['Gerente', ['a']],
      // na ordem do quadro (grupo, depois posição)
      ['Sem recurso', ['c', 'b']],
    ])
    const months = groupedSections(p, 'schedule', { labels, locale: 'pt-BR' })
    expect(months.map((s) => [s.group.name, s.items.map((i) => i.id)])).toEqual([
      ['jan 2026', ['a']],
      ['fev 2026', ['b']],
      ['Sem cronograma', ['c']],
    ])
    expect(months[0]?.group.summary?.estimatedHours).toBe(2)
  })
})

describe('plan-view — totais e dependências', () => {
  it('totais: soma, período, distribuição e progresso ponderado pelo esforço (cancelados fora)', () => {
    const p = plan([])
    const summary = summarize(
      [
        item('a', 'ini', { statusId: 'done', estimatedHours: 3, progress: { value: 100, source: 'done' }, startDate: '2026-01-05', endDate: '2026-01-06', durationDays: 2 }),
        item('b', 'ini', { estimatedHours: 1, progress: { value: 0, source: 'none' }, endDate: '2026-01-20', durationDays: 1 }),
        item('c', 'ini', { statusId: 'cancel', estimatedHours: 10 }),
        item('s', 'ini', { parentId: 'a', estimatedHours: 99 }),
      ],
      p,
    )
    expect(summary).toEqual({
      items: 3,
      statusCounts: [
        { statusId: 'done', count: 1 },
        { statusId: null, count: 1 },
        { statusId: 'cancel', count: 1 },
      ],
      startDate: '2026-01-05',
      endDate: '2026-01-20',
      estimatedHours: 14,
      durationDays: 3,
      progress: 75,
      customSums: {},
    })
  })

  it('dependências vistas do elemento e candidatos a ligar', () => {
    const p = plan([item('a', 'ini'), item('b', 'ini'), item('c', 'pl'), item('d', 'pl'), item('a1', 'ini', { parentId: 'a' })], {
      links: [
        { id: 'l1', fromId: 'a', toId: 'b', type: 'blocks' },
        { id: 'l2', fromId: 'b', toId: 'c', type: 'blocks' },
        { id: 'l3', fromId: 'd', toId: 'b', type: 'relates' },
      ],
    })
    const deps = dependenciesOf('b', p)
    expect(deps.dependsOn.map((x) => x.item.id)).toEqual(['a'])
    expect(deps.blocks.map((x) => x.item.id)).toEqual(['c'])
    expect(deps.relates.map((x) => x.item.id)).toEqual(['d'])
    expect(linkCandidates('b', p, '').map((i) => i.id)).toEqual([])
    expect(linkCandidates('a', p, '').map((i) => i.id)).toEqual(['c', 'd'])
    expect(linkCandidates('a', p, 'D').map((i) => i.id)).toEqual(['d'])
  })
})
