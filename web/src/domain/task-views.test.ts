import { describe, expect, it } from 'vitest'
import { DEFAULT_TASK_VIEWS, inboxPath, showsAllBox, tasksEntryPath, toTaskViews } from './task-views'

describe('Tarefas por perfil (ajuste 23/11)', () => {
  it('sem escolha (ou valor desconhecido) fica como antes', () => {
    expect(toTaskViews(null)).toEqual(DEFAULT_TASK_VIEWS)
    expect(toTaskViews({ tasksStart: 'kanban', tasksList: 'mine', tasksAllBox: 'on' })).toEqual({ tasksStart: '', tasksList: 'mine', tasksAllBox: '' })
    expect(tasksEntryPath(DEFAULT_TASK_VIEWS, true)).toBe('/tasks')
  })

  it('o menu abre onde o perfil escolheu; a caixa Todas só para quem a vê', () => {
    expect(tasksEntryPath({ ...DEFAULT_TASK_VIEWS, tasksStart: 'inbox_all' }, true)).toBe('/tasks/demands?box=all')
    expect(tasksEntryPath({ ...DEFAULT_TASK_VIEWS, tasksStart: 'inbox_all' }, false)).toBe('/tasks/demands')
    expect(tasksEntryPath({ ...DEFAULT_TASK_VIEWS, tasksStart: 'inbox_all', tasksAllBox: 'hidden' }, true)).toBe('/tasks/demands')
    expect(tasksEntryPath({ ...DEFAULT_TASK_VIEWS, tasksStart: 'inbox' }, true)).toBe('/tasks/demands')
  })

  it('sem a Lista, o menu leva à Caixa de entrada mesmo com "Lista" como entrada', () => {
    expect(tasksEntryPath({ ...DEFAULT_TASK_VIEWS, tasksList: 'hidden' }, true)).toBe('/tasks/demands')
    expect(inboxPath({ ...DEFAULT_TASK_VIEWS, tasksList: 'hidden', tasksStart: 'inbox_all' }, true)).toBe('/tasks/demands?box=all')
  })

  it('caixa Todas: exige ver todos os projetos e o perfil não escondê-la', () => {
    expect(showsAllBox(DEFAULT_TASK_VIEWS, true)).toBe(true)
    expect(showsAllBox(DEFAULT_TASK_VIEWS, false)).toBe(false)
    expect(showsAllBox({ ...DEFAULT_TASK_VIEWS, tasksAllBox: 'hidden' }, true)).toBe(false)
  })
})
