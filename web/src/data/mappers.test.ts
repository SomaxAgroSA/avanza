import { describe, expect, it } from 'vitest'
import { toArea, toBoard, toCurrentUser, toDependencies, toPriority, toProject, toProjectBrief, toProjectTaskCounts, toReport, toRole, toTaskSummary, toTeamActivity, toUser } from './mappers'
import type { BoardDto, DependenciesDto, ProjectDto, ReportDto, TaskDto, TeamActivityDto, UserDto } from './dtos'

const userDto: UserDto = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@x.com',
  avatar_url: null,
  status: 'active',
  role_id: 'r1',
  locale: 'es',
  theme: 'dark',
  created_at: '2026-01-10T12:00:00.000Z',
  updated_at: '2026-01-10T12:00:00.000Z',
  last_login_at: null,
}

describe('data/mappers', () => {
  it('converte usuário (snake_case -> camelCase, datas)', () => {
    const user = toUser(userDto)
    expect(user.roleId).toBe('r1')
    expect(user.createdAt?.toISOString()).toBe('2026-01-10T12:00:00.000Z')
    expect(user.lastLoginAt).toBeNull()
    expect(user.locale).toBe('es')
    expect(user.theme).toBe('dark')
    // §38: sem home_page (API antiga) = automática
    expect(user.homePage).toBe('')
    expect(toUser({ ...userDto, home_page: '/projects/ongoing' }).homePage).toBe('/projects/ongoing')
  })

  it('§48: "O que aparece" do perfil (sem os campos = tudo visível; só o conhecido) e contagens de tarefas por projeto', () => {
    const base = { id: 'r1', code: 'DIRETORIA', name: 'Diretoria', description: '', is_system: false }
    expect(toRole(base).screens).toEqual({ hidden: [], starts: {} })
    const screens = { hidden_screens: ['tasks.views.timeline', 'outra', 'projects.lists.all'], screen_starts: { 'projects.lists': 'ongoing', 'tasks.views': 'timeline', 'docs.actions': 'pdf' } }
    expect(toRole({ ...base, ...screens }).screens).toEqual({ hidden: ['projects.lists.all', 'tasks.views.timeline'], starts: { 'projects.lists': 'ongoing' } })
    expect(toCurrentUser({ user: userDto, role: { ...base, ...screens }, permissions: [], session: null }).role?.screens.hidden).toEqual(['projects.lists.all', 'tasks.views.timeline'])
    expect(toProjectTaskCounts({ projects: [{ project_id: 'p1', done: 3, open: 5 }] })).toEqual([{ projectId: 'p1', done: 3, open: 5 }])
  })

  it('§26.2: o Panorama ligado ou desligado vem em /auth/me (sem o campo, ligado)', () => {
    const me = { user: userDto, role: null, permissions: [], session: null }
    expect(toCurrentUser(me).platform).toEqual({ panoramaEnabled: true })
    expect(toCurrentUser({ ...me, platform: { panorama_enabled: false } }).platform).toEqual({ panoramaEnabled: false })
    expect(toCurrentUser({ ...me, platform: { panorama_enabled: true } }).platform).toEqual({ panoramaEnabled: true })
  })

  it('usa padrões seguros para valores desconhecidos', () => {
    const user = toUser({ ...userDto, locale: 'fr', theme: 'neon', status: 'weird', created_at: 'invalid' })
    expect(user.locale).toBe('pt-BR')
    expect(user.theme).toBe('system')
    expect(user.status).toBe('active')
    expect(user.createdAt).toBeNull()
  })

  it('descarta permissões desconhecidas', () => {
    const role = toRole({ id: 'r', code: 'X', name: 'X', description: '', is_system: false, permissions: ['tasks.view', 'hack.all'] })
    expect(role.permissions).toEqual(['tasks.view'])
    expect(role.userCount).toBe(0)
  })

  it('converte contexto do usuário atual', () => {
    const me = toCurrentUser({ user: userDto, role: null, permissions: ['users.view'], session: null })
    expect(me.user.id).toBe('u1')
    expect(me.permissions).toEqual(['users.view'])
    expect(me.role).toBeNull()
  })

  it('quadro de todos os projetos: projeto nulo, projetos incluídos e quem pode mover cada card', () => {
    const task: TaskDto = {
      id: 't1', code: 'ERP-1', number: 1, title: 'X', project: { id: 'p2', key: 'ERP', name: 'ERP' }, type: null, status: null, priority: null,
      creator: null, assignee: null, reporter: null, parent_task_id: null, due_date: null, estimated_hours: null, actual_hours: null,
      started_at: null, completed_at: null, created_at: null, updated_at: null,
    }
    const column = { status: { id: 's', key: 'S', name: 'S', color: 'gray', category: 'todo', is_default: true }, wip_limit: 2, allowed_next: [], total: 1, truncated: false }
    const dto: BoardDto = {
      project: null,
      projects: [{ id: 'p2', key: 'ERP', name: 'ERP' }],
      capabilities: { move: true, create: false },
      columns: [{ ...column, tasks: [{ ...task, capabilities: { move: false } }] }],
    }
    const board = toBoard(dto)
    expect(board.project).toBeNull()
    expect(board.projects).toEqual([{ id: 'p2', key: 'ERP', name: 'ERP' }])
    expect(board.columns[0]?.cards[0]?.canMove).toBe(false)
    // quadro do projeto: a lista de projetos é o próprio projeto e o card segue o quadro
    const single = toBoard({ ...dto, project: { id: 'p2', key: 'ERP', name: 'ERP', archived: false }, projects: undefined, columns: [{ ...column, tasks: [task] }] })
    expect(single.projects).toEqual([{ id: 'p2', key: 'ERP', name: 'ERP' }])
    expect(single.columns[0]?.cards[0]?.canMove).toBeUndefined()
  })

  it('área responsável: resumo na tarefa (cor desconhecida = cinza; ausente = sem área) e item da lista', () => {
    const task: TaskDto = {
      id: 't1', code: 'CRM-1', number: 1, title: 'X', project: null, type: null, status: null, priority: null,
      creator: null, assignee: null, reporter: null, parent_task_id: null, due_date: null, estimated_hours: null, actual_hours: null,
      started_at: null, completed_at: null, created_at: null, updated_at: null,
    }
    expect(toTaskSummary({ ...task, area: { id: 'a1', key: 'TI', name: 'Dpto. TI', color: 'blue' } }).area).toEqual({ id: 'a1', key: 'TI', name: 'Dpto. TI', color: 'blue' })
    expect(toTaskSummary({ ...task, area: { id: 'a1', key: 'TI', name: 'Dpto. TI', color: 'xyz' } }).area?.color).toBe('gray')
    expect(toTaskSummary(task).area).toBeNull()
    // fixada para mim (§55): só a data; ausente ou inválida = não fixada
    expect(toTaskSummary({ ...task, pinned_mine: { at: '2026-11-27T10:00:00.000Z' } }).pinnedMine).toEqual({ at: new Date('2026-11-27T10:00:00.000Z') })
    expect(toTaskSummary({ ...task, pinned_mine: { at: 'nada' } }).pinnedMine).toBeNull()
    expect(toTaskSummary(task).pinnedMine).toBeNull()
    const area = toArea({ id: 'a1', key: 'TI', name: 'Dpto. TI', description: '', color: 'blue', order: 1, is_active: true, is_default: false, created_at: null, updated_at: null })
    expect([area.name, area.isDefault, area.isActive]).toEqual(['Dpto. TI', false, true])
  })

  describe('Responsável TI, projeto pai e seções (PR #3)', () => {
    const project: ProjectDto = {
      id: 'p1', name: 'FVB', key: 'FVB', description: '', icon: 'folder', cover: 'blue', status: 'active', priority: 'medium',
      owner: null, start_date: null, due_date: null, archived_at: null, created_at: null, updated_at: null, member_count: 2, my_role: 'it',
      capabilities: { edit: false, manage_members: false, archive: false, delete: false, transfer: false, sections: ['charter', 'xyz'] },
      parent: { id: 'p0', key: 'CRM', name: 'Portal CRM', icon: 'rocket', cover: 'nada' },
      child_count: 0,
    }

    it('projeto: papel it, pai, subprojetos e seções conhecidas (servidor antigo = todas)', () => {
      const p = toProject(project)
      expect(p.myRole).toBe('it')
      expect(p.parent).toEqual({ id: 'p0', key: 'CRM', name: 'Portal CRM', icon: 'rocket', cover: 'violet' })
      expect(p.childCount).toBe(0)
      expect(p.capabilities.sections).toEqual(['charter'])
      const old = toProject({ ...project, my_role: 'weird', parent: undefined, child_count: undefined, capabilities: { edit: true, manage_members: true, archive: true, delete: true, transfer: true } })
      expect(old.myRole).toBeNull()
      expect(old.parent).toBeNull()
      expect(old.childCount).toBe(0)
      expect(old.capabilities.sections).toEqual(['charter', 'history', 'members', 'report'])
    })

    it('tarefa visível para TI e resumo do projeto', () => {
      const task: TaskDto = {
        id: 't1', code: 'FVB-1', number: 1, title: 'Liberar acesso', project: { id: 'p1', key: 'FVB', name: 'FVB' }, type: null, status: null, priority: null,
        creator: null, assignee: null, reporter: null, parent_task_id: null, due_date: null, estimated_hours: null, actual_hours: null,
        started_at: null, completed_at: null, created_at: null, updated_at: null,
      }
      expect(toTaskSummary(task).itVisible).toBe(false)
      expect(toTaskSummary({ ...task, it_visible: true }).itVisible).toBe(true)
      const brief = toProjectBrief({
        objective: 'Portal comercial',
        tasks: [{ ...task, it_visible: true }],
        items: [{ id: 'i1', kind: 'result', title: 'Disponibilidade', target: 99.5, unit: '%', due_date: '2026-12-31T00:00:00.000Z' }, { id: 'i2', kind: 'outro', title: 'Tela' }],
      })
      expect(brief.objective).toBe('Portal comercial')
      expect(brief.tasks.map((t) => t.code)).toEqual(['FVB-1'])
      expect(brief.items).toEqual([
        { id: 'i1', kind: 'result', title: 'Disponibilidade', description: '', unit: '%', target: 99.5, dueDate: '2026-12-31' },
        { id: 'i2', kind: 'feature', title: 'Tela', description: '', unit: '', target: null, dueDate: null },
      ])
      expect(toProjectBrief({}).items).toEqual([])
    })
  })

  describe('a caixa das demandas internas nos painéis (§45)', () => {
    it('kind demands vira demands: true no Equipo ahora, nas Dependências e no rótulo do relatório', () => {
      const team = toTeamActivity({
        window_days: 7,
        generated_at: null,
        people: [
          {
            user: { id: 'u1', name: 'Jorge', email: 'j@x', avatar_url: null },
            projects: [
              { project: { id: 'sys', key: 'DEM', name: 'Demandas internas', icon: 'inbox', cover: 'slate', kind: 'demands' }, state: 'working', in_progress: 1, recent: 1, open: 1, stale: false, last_activity: null, tasks: [] },
              { project: { id: 'p1', key: 'CRM', name: 'CRM', icon: 'folder', cover: 'blue' }, state: 'idle', in_progress: 0, recent: 0, open: 1, stale: false, last_activity: null, tasks: [] },
            ],
          },
        ],
      } as TeamActivityDto)
      expect(team.people[0]?.projects.map((p) => p.project.demands ?? false)).toEqual([true, false])
      const deps = toDependencies({
        generated_at: null,
        today: '2026-11-20',
        people: [],
        areas: [],
        totals: { deliveries: 0, blocked: 0, pending: 0, none_due: 0, overdue: 0, projects: 1 },
        projects: [
          { project: { id: 'sys', key: 'DEM', name: 'Demandas internas', kind: 'demands', due_date: null }, counts: { deliveries: 0, blocked: 0, pending: 0, none_due: 0, overdue: 0 }, deliveries: [], blocked: [], pending: [] },
        ],
      } as unknown as DependenciesDto)
      expect(deps.projects[0]?.project.demands).toBe(true)
      const report = toReport({
        period: { from: '2026-11-01T00:00:00.000Z', to: '2026-11-20T00:00:00.000Z', tz_offset: 0 },
        generated_at: '2026-11-20T00:00:00.000Z',
        indicators: {},
        series: { bucket: 'day', points: [] },
        breakdown: {
          dimension: 'project',
          rows: [{ key: 'sys', label: { id: 'sys', key: 'DEM', name: 'Demandas internas', kind: 'demands' }, total: 1, open: 1, overdue: 0, blocked: 0, created: 1, completed: 0, lead_time: { hours: null, count: 0 } }],
        },
      } as unknown as ReportDto)
      expect(report.breakdown.rows[0]?.label).toEqual({ kind: 'project', id: 'sys', key: 'DEM', name: 'Demandas internas', demands: true })
    })
  })
})

describe('data/mappers — prioridade com nome por idioma', () => {
  const base = { id: 'p1', key: 'MEDIA', description: '', color: 'amber', order: 2, is_active: true, is_default: true, created_at: null, updated_at: null }

  it('nome no idioma da tela e as versões para editar', () => {
    const priority = toPriority({ ...base, name: 'Media', translations: { 'pt-BR': { name: 'Média' }, en: { name: 'Medium' }, es: { name: 'Media' } } })
    expect(priority.name).toBe('Media')
    expect(priority.translations).toEqual({ 'pt-BR': { name: 'Média' }, en: { name: 'Medium' }, es: { name: 'Media' } })
  })

  it('servidor sem traduções: o original é o próprio nome', () => {
    expect(toPriority({ ...base, name: 'Média' }).translations).toEqual({ 'pt-BR': { name: 'Média' }, en: { name: '' }, es: { name: '' } })
  })
})
