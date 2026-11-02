import { describe, expect, it } from 'vitest'
import { toArea, toBoard, toCurrentUser, toRole, toTaskSummary, toUser } from './mappers'
import type { BoardDto, TaskDto, UserDto } from './dtos'

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
    const area = toArea({ id: 'a1', key: 'TI', name: 'Dpto. TI', description: '', color: 'blue', order: 1, is_active: true, is_default: false, created_at: null, updated_at: null })
    expect([area.name, area.isDefault, area.isActive]).toEqual(['Dpto. TI', false, true])
  })
})
