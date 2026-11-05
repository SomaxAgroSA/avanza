import { describe, expect, it } from 'vitest'
import { ACCESS_MODULES, PROJECT_SECTION_CHIPS, accessSummary, moduleVisible, personalRoleCode, projectAccessOf, togglePermission } from './access'
import type { ProjectMember } from './projects'

const member = (id: string, role: ProjectMember['role'], isOwner = false): ProjectMember => ({
  user: { id, name: id, email: `${id}@x.test`, avatarUrl: null, status: 'active' },
  role,
  isOwner,
  joinedAt: null,
})

describe('domain/access', () => {
  it('ligar uma ação liga o "ver" do módulo; desligar o "ver" desliga as ações', () => {
    expect(togglePermission([], 'kanban.manage', true)).toEqual(['kanban.manage', 'kanban.view'])
    expect(togglePermission(['tasks.view', 'tasks.edit', 'tasks.create', 'reports.view'], 'tasks.view', false)).toEqual(['reports.view'])
    expect(togglePermission(['tasks.view', 'tasks.edit'], 'tasks.edit', false)).toEqual(['tasks.view'])
    // Configurações não têm "ver": cada permissão vale sozinha
    expect(togglePermission([], 'settings.manage', true)).toEqual(['settings.manage'])
  })

  it('seções do projeto (§35): ligar uma liga "ver projetos"; desligar "ver projetos" desliga as seções', () => {
    expect(togglePermission([], 'projects.charter', true)).toEqual(['projects.charter', 'projects.view'])
    expect(togglePermission(['projects.view', 'projects.charter', 'projects.history', 'tasks.view'], 'projects.view', false)).toEqual(['tasks.view'])
    expect(togglePermission(['projects.view', 'projects.charter'], 'projects.charter', false)).toEqual(['projects.view'])
  })

  it('o que vê dentro do projeto, na ordem das abas: seções próprias e módulos que aparecem nele', () => {
    expect(PROJECT_SECTION_CHIPS.map((c) => c.key)).toEqual(['charter', 'plan', 'tasks', 'kanban', 'report', 'members', 'history'])
    expect(PROJECT_SECTION_CHIPS.find((c) => c.key === 'kanban')?.code).toBe('kanban.view')
  })

  it('Responsável TI é um papel de membro como os outros', () => {
    expect(projectAccessOf([member('tito', 'it')], 'tito')).toBe('it')
  })

  it('módulo visível pelo "ver" ou, sem ele, por qualquer ação', () => {
    const plan = ACCESS_MODULES.find((m) => m.module === 'plan')!
    const settings = ACCESS_MODULES.find((m) => m.module === 'settings')!
    expect(moduleVisible(['plan.view'], plan)).toBe(true)
    expect(moduleVisible(['plan.edit'], plan)).toBe(false)
    expect(moduleVisible(['platform.manage'], settings)).toBe(true)
  })

  it('acesso ao projeto: dono, papel de membro ou sem acesso', () => {
    const members = [member('ana', 'manager', true), member('lia', 'viewer')]
    expect(projectAccessOf(members, 'ana')).toBe('owner')
    expect(projectAccessOf(members, 'lia')).toBe('viewer')
    expect(projectAccessOf(members, 'otto')).toBe('none')
  })

  it('resumo: módulos visíveis e projetos (todos, se o perfil vê todos)', () => {
    expect(accessSummary(['projects.view', 'tasks.view'], ['member', 'none', 'none'])).toEqual({ modulesVisible: 2, modulesTotal: ACCESS_MODULES.length, projectsWithAccess: 1, projectsTotal: 3, seesAllProjects: false })
    expect(accessSummary(['projects.view', 'projects.view_all'], ['none', 'none']).projectsWithAccess).toBe(2)
  })

  it('código do perfil próprio no formato do servidor, sem repetir', () => {
    expect(personalRoleCode('Douglas Martíns', [])).toBe('USR_DOUGLAS_MARTINS')
    expect(personalRoleCode('Douglas Martíns', ['USR_DOUGLAS_MARTINS'])).toBe('USR_DOUGLAS_MARTINS_2')
    expect(personalRoleCode('Ñ', [])).toMatch(/^[A-Z][A-Z0-9_]{1,31}$/)
  })
})
