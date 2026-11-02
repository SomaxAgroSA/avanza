import { describe, expect, it } from 'vitest'
import { formatNumber, formatNumberInput, formatSchedule, isDurationEditable, isProgressEditable, parseNumberInput, rangeDays, statusSegments, type Plan, type PlanGroup, type PlanItem } from './plan'
import { boardSections, expandedByNarrowing, groupTitle } from './plan-view'

const group = (id: string, number: string, parentId: string | null = null): PlanGroup => ({
  id,
  parentId,
  name: id.toUpperCase(),
  color: 'blue',
  position: 0,
  number,
  summary: null,
})

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

const plan = (groups: PlanGroup[], items: PlanItem[], extra: Partial<Plan> = {}): Plan => ({
  project: { id: 'p1', key: 'IMP', name: 'Implantação', archived: false },
  capabilities: { edit: true, manage: true },
  statuses: [
    { id: 'plan', name: 'Planejado', color: 'gray', category: 'todo', position: 1 },
    { id: 'prog', name: 'Em progresso', color: 'amber', category: 'in_progress', position: 2 },
    { id: 'done', name: 'Feito', color: 'green', category: 'done', position: 3 },
  ],
  resources: [
    { id: 'r-gp', name: 'Gerente de Projetos', color: 'indigo' },
    { id: 'r-cli', name: 'Cliente', color: 'teal' },
  ],
  groups,
  items,
  links: [],
  columns: [],
  settings: { dependencyRule: 'warn', baselineAt: null },
  summary: null,
  truncated: false,
  ...extra,
})

describe('domain/plan — seções do quadro', () => {
  const groups = [group('ini', '1.0'), group('pl', '2.0'), group('pp', '2.1', 'pl'), group('vazio', '3.0')]

  it('fase só com subgrupos vira cabeçalho (sem tabela); subgrupo leva o pai no título', () => {
    const sections = boardSections(plan(groups, [item('a', 'ini', 2), item('b', 'ini', 1), item('c', 'pp', 1)]))
    expect(sections.map((s) => [s.group.id, s.headerOnly])).toEqual([
      ['ini', false],
      ['pl', true],
      ['pp', false],
      ['vazio', false],
    ])
    expect(sections[0]?.items.map((i) => i.id)).toEqual(['b', 'a'])
    expect(sections[1]?.subgroups).toBe(1)
    expect(sections[2]?.parent?.id).toBe('pl')
    expect(groupTitle(sections[2]?.parent as PlanGroup)).toBe('2.0 PL')

    const withOwn = boardSections(plan(groups, [item('d', 'pl', 1), item('c', 'pp', 1)]))
    expect(withOwn.map((s) => [s.group.id, s.headerOnly])).toEqual([
      ['ini', false],
      ['pl', false],
      ['pp', false],
      ['vazio', false],
    ])
  })

  it('subelementos ficam abaixo do pai, na ordem', () => {
    const items = [item('a', 'ini', 1, { subitems: 2 }), item('s2', 'ini', 2, { parentId: 'a' }), item('s1', 'ini', 1, { parentId: 'a' })]
    const [ini] = boardSections(plan(groups, items))
    expect(ini?.items.map((i) => i.id)).toEqual(['a'])
    expect(ini?.subitems.get('a')?.map((i) => i.id)).toEqual(['s1', 's2'])
    expect(ini?.total).toBe(1)
  })

  it('busca sem acento: elemento que casa leva todos os subelementos; subelemento que casa abre o pai', () => {
    const items = [
      item('a', 'ini', 1, { name: 'Reunião de kickoff' }),
      item('a1', 'ini', 1, { parentId: 'a', name: 'Pauta' }),
      item('b', 'pp', 1, { name: 'Plano' }),
      item('b1', 'pp', 1, { parentId: 'b', name: 'Revisar reuniao' }),
      item('b2', 'pp', 2, { parentId: 'b', name: 'Aprovar' }),
      item('c', 'ini', 2, { name: 'Outro' }),
    ]
    const sections = boardSections(plan(groups, items), { query: 'REUNIAO' })
    // a fase "pl" aparece como cabeçalho porque o subgrupo tem resultado
    expect(sections.map((s) => [s.group.id, s.headerOnly])).toEqual([
      ['ini', false],
      ['pl', true],
      ['pp', false],
    ])
    expect(sections[0]?.items.map((i) => i.id)).toEqual(['a'])
    expect(sections[0]?.subitems.get('a')?.map((i) => i.id)).toEqual(['a1'])
    expect(sections[2]?.subitems.get('b')?.map((i) => i.id)).toEqual(['b1'])
    expect(boardSections(plan(groups, items), { query: 'nada' })).toEqual([])
    expect([...expandedByNarrowing(sections, { query: 'reuniao' })]).toEqual(['b'])
  })

  it('ordena pela coluna (vazios no fim, nas duas direções)', () => {
    const items = [
      item('a', 'ini', 1, { estimatedHours: 5, statusId: 'done', resourceIds: ['r-gp'] }),
      item('b', 'ini', 2, { estimatedHours: null, statusId: 'plan' }),
      item('c', 'ini', 3, { estimatedHours: 1, resourceIds: ['r-cli'] }),
    ]
    const ids = (column: 'estimated' | 'status' | 'resources', direction: 'asc' | 'desc') =>
      boardSections(plan([group('ini', '1.0')], items), { sort: { column, direction } })[0]?.items.map((i) => i.id)
    expect(ids('estimated', 'asc')).toEqual(['c', 'a', 'b'])
    expect(ids('estimated', 'desc')).toEqual(['a', 'c', 'b'])
    expect(ids('status', 'asc')).toEqual(['b', 'a', 'c'])
    expect(ids('resources', 'asc')).toEqual(['c', 'a', 'b'])
  })
})

describe('domain/plan — rodapé e edição', () => {
  it('barra de status na ordem das etiquetas, em branco no fim, com percentuais', () => {
    const p = plan([], [])
    const segments = statusSegments(
      {
        items: 4,
        statusCounts: [
          { statusId: null, count: 1 },
          { statusId: 'done', count: 2 },
          { statusId: 'plan', count: 1 },
        ],
        startDate: null,
        endDate: null,
        estimatedHours: null,
        durationDays: null,
        progress: 0,
      },
      p.statuses,
    )
    expect(segments).toEqual([
      { statusId: 'plan', count: 1, percent: 25 },
      { statusId: 'done', count: 2, percent: 50 },
      { statusId: null, count: 1, percent: 25 },
    ])
    expect(statusSegments(null, p.statuses)).toEqual([])
  })

  it('duração só é editável sem cronograma; progresso só quando não é automático', () => {
    expect(isDurationEditable(item('a', 'g', 1))).toBe(true)
    expect(isDurationEditable(item('a', 'g', 1, { startDate: '2026-01-26' }))).toBe(false)
    expect(isProgressEditable(item('a', 'g', 1, { progress: { value: 40, source: 'manual' } }))).toBe(true)
    expect(isProgressEditable(item('a', 'g', 1, { progress: { value: 40, source: 'subitems' } }))).toBe(false)
    expect(isProgressEditable(item('a', 'g', 1, { progress: { value: 100, source: 'done' } }))).toBe(false)
    // vem das tarefas vinculadas: não se digita
    expect(isProgressEditable(item('a', 'g', 1, { progress: { value: 60, source: 'tasks' } }))).toBe(false)
  })

  it('número digitado: vírgula ou ponto, vazio = null, inteiro e limites', () => {
    expect(parseNumberInput('1,5', { max: 100 })).toEqual({ ok: true, value: 1.5 })
    expect(parseNumberInput(' 2.25 ', { max: 100 })).toEqual({ ok: true, value: 2.25 })
    expect(parseNumberInput('', { max: 100 })).toEqual({ ok: true, value: null })
    expect(parseNumberInput('1,555', { max: 100 }).ok).toBe(false)
    expect(parseNumberInput('abc', { max: 100 }).ok).toBe(false)
    expect(parseNumberInput('-1', { max: 100 }).ok).toBe(false)
    expect(parseNumberInput('101', { max: 100 }).ok).toBe(false)
    expect(parseNumberInput('2.5', { integer: true, max: 100 }).ok).toBe(false)
    expect(parseNumberInput('7', { integer: true, max: 100 })).toEqual({ ok: true, value: 7 })
  })
})

describe('domain/plan — formatos', () => {
  const now = new Date('2026-09-30T12:00:00Z')

  it('cronograma compacto', () => {
    expect(formatSchedule('2026-09-18', '2026-09-18', 'pt-BR', now)).toBe('18 set')
    expect(formatSchedule('2026-09-18', '2026-09-20', 'pt-BR', now)).toBe('18 — 20 set')
    expect(formatSchedule('2026-09-28', '2026-10-02', 'pt-BR', now)).toBe('28 set — 2 out')
    expect(formatSchedule('2026-12-28', '2027-01-03', 'pt-BR', now)).toBe('28 dez 2026 — 3 jan 2027')
    expect(formatSchedule(null, '2026-09-20', 'pt-BR', now)).toBe('20 set')
    expect(formatSchedule(null, null, 'pt-BR', now)).toBeNull()
  })

  it('dias do intervalo e números', () => {
    expect(rangeDays('2026-01-26', '2026-01-30')).toBe(5)
    expect(rangeDays('2026-01-26', null)).toBe(1)
    expect(rangeDays(null, null)).toBe(0)
    expect(formatNumber(4.1, 'pt-BR')).toBe('4,1')
    expect(formatNumber(null, 'pt-BR')).toBeNull()
    expect(formatNumberInput(1234.5, 'pt-BR')).toBe('1234,5')
    expect(formatNumberInput(1.5, 'en')).toBe('1.5')
  })
})
