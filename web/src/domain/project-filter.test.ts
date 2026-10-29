import { describe, expect, it } from 'vitest'
import {
  allowedByProjectFilter,
  DEFAULT_PROJECT_FILTER,
  filterProjectsBySettings,
  isDefaultProjectFilter,
  normalizeProjectFilter,
  projectFilterKey,
  scopedProjectIds,
  toggleProjectFilterStatus,
  toProjectFilterSubject,
  type ProjectFilterSubject,
} from './project-filter'

const subject = (p: ProjectFilterSubject) => p
const list: ProjectFilterSubject[] = [
  { id: 'a', status: 'active', member: true },
  { id: 'b', status: 'planning', member: false },
  { id: 'c', status: 'completed', member: true },
  { id: 'd', status: null, member: false },
]

describe('domain/project-filter', () => {
  it('chave da preferência por tela', () => {
    expect(projectFilterKey('kanban')).toBe('project_filter.kanban')
  })

  it('padrão = todos os status e todos os projetos', () => {
    expect(isDefaultProjectFilter(DEFAULT_PROJECT_FILTER)).toBe(true)
    expect(isDefaultProjectFilter({ statuses: ['active'], membersOnly: false })).toBe(false)
    expect(isDefaultProjectFilter({ statuses: [], membersOnly: true })).toBe(false)
  })

  it('normaliza o valor salvo: ausente vira padrão; status desconhecidos e repetidos saem, na ordem do catálogo', () => {
    expect(normalizeProjectFilter(null)).toEqual(DEFAULT_PROJECT_FILTER)
    expect(normalizeProjectFilter({ statuses: ['completed', 'x' as never, 'planning', 'completed'], membersOnly: true })).toEqual({
      statuses: ['planning', 'completed'],
      membersOnly: true,
    })
  })

  it('marca e desmarca status', () => {
    const on = toggleProjectFilterStatus(DEFAULT_PROJECT_FILTER, 'paused', true)
    expect(on.statuses).toEqual(['paused'])
    expect(toggleProjectFilterStatus({ ...on, statuses: ['active', 'paused'] }, 'active', false).statuses).toEqual(['paused'])
  })

  it('status e participação', () => {
    expect(allowedByProjectFilter(list[0]!, { statuses: ['active'], membersOnly: true })).toBe(true)
    expect(allowedByProjectFilter(list[1]!, { statuses: ['planning'], membersOnly: true })).toBe(false)
    expect(allowedByProjectFilter(list[1]!, { statuses: ['active'], membersOnly: false })).toBe(false)
    // status desconhecido não passa quando há status escolhidos
    expect(allowedByProjectFilter(list[3]!, { statuses: ['active'], membersOnly: false })).toBe(false)
    expect(allowedByProjectFilter(list[3]!, DEFAULT_PROJECT_FILTER)).toBe(true)
  })

  it('filtra a lista e mantém o projeto em uso', () => {
    const settings = { statuses: ['active' as const, 'planning' as const], membersOnly: false }
    expect(filterProjectsBySettings(list, settings, subject).map((p) => p.id)).toEqual(['a', 'b'])
    expect(filterProjectsBySettings(list, settings, subject, ['c']).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(filterProjectsBySettings(list, { statuses: [], membersOnly: true }, subject).map((p) => p.id)).toEqual(['a', 'c'])
    expect(filterProjectsBySettings(list, DEFAULT_PROJECT_FILTER, subject)).toHaveLength(4)
  })

  it('projetos da lista geral: participa quem tem papel', () => {
    expect(toProjectFilterSubject({ id: 'p', status: 'active', myRole: 'viewer' })).toEqual({ id: 'p', status: 'active', member: true })
    expect(toProjectFilterSubject({ id: 'p', status: 'active', myRole: null }).member).toBe(false)
  })

  it('ids para as visões que juntam projetos: null sem restrição; senão os permitidos (e os em uso)', () => {
    expect(scopedProjectIds(list, DEFAULT_PROJECT_FILTER)).toBeNull()
    expect(scopedProjectIds(list, { statuses: [], membersOnly: true })).toEqual(['a', 'c'])
    expect(scopedProjectIds(list, { statuses: ['paused'], membersOnly: false })).toEqual([])
    expect(scopedProjectIds(list, { statuses: ['paused'], membersOnly: false }, ['b'])).toEqual(['b'])
  })
})
