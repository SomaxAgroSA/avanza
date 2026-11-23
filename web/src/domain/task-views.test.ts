import { describe, expect, it } from 'vitest'
import { DEFAULT_TASK_VIEWS, inboxPath, showsAllBox, startBox, tasksEntryPath, toTaskViews, visibleBoxes, type TaskViews } from './task-views'

const views = (patch: Partial<TaskViews>): TaskViews => ({ ...DEFAULT_TASK_VIEWS, ...patch })

describe('Tarefas por perfil (ajustes 23 e 24/11)', () => {
  it('sem escolha (ou valor desconhecido) fica como antes', () => {
    expect(toTaskViews(null)).toEqual(DEFAULT_TASK_VIEWS)
    expect(toTaskViews({ tasksStart: 'kanban', tasksList: 'mine', tasksAllBox: 'on', tasksHiddenBoxes: ['requested', 'all', 'received'] })).toEqual({
      tasksStart: '',
      tasksList: 'mine',
      tasksAllBox: '',
      tasksHiddenBoxes: ['received', 'requested'],
    })
    expect(tasksEntryPath(DEFAULT_TASK_VIEWS, true)).toBe('/tasks')
    expect(visibleBoxes(DEFAULT_TASK_VIEWS, true)).toEqual(['received', 'assigned', 'requested', 'all'])
    expect(visibleBoxes(DEFAULT_TASK_VIEWS, false)).toEqual(['received', 'assigned', 'requested'])
  })

  it('o menu abre na caixa que o perfil escolheu; a caixa Todas só para quem a vê', () => {
    expect(tasksEntryPath(views({ tasksStart: 'inbox_all' }), true)).toBe('/tasks/demands?box=all')
    expect(tasksEntryPath(views({ tasksStart: 'inbox_all' }), false)).toBe('/tasks/demands')
    expect(tasksEntryPath(views({ tasksStart: 'inbox_all', tasksAllBox: 'hidden' }), true)).toBe('/tasks/demands')
    expect(tasksEntryPath(views({ tasksStart: 'inbox' }), true)).toBe('/tasks/demands')
    expect(tasksEntryPath(views({ tasksStart: 'inbox_assigned' }), false)).toBe('/tasks/demands?box=assigned')
    expect(tasksEntryPath(views({ tasksStart: 'inbox_requested' }), false)).toBe('/tasks/demands?box=requested')
  })

  it('o perfil esconde caixas: só as marcadas aparecem, e a entrada escondida vira a primeira visível', () => {
    const onlyAll = views({ tasksList: 'hidden', tasksHiddenBoxes: ['received', 'assigned', 'requested'], tasksStart: 'inbox_all' })
    expect(visibleBoxes(onlyAll, true)).toEqual(['all'])
    expect(tasksEntryPath(onlyAll, true)).toBe('/tasks/demands?box=all')
    const noReceived = views({ tasksHiddenBoxes: ['received'], tasksStart: 'inbox' })
    expect(visibleBoxes(noReceived, false)).toEqual(['assigned', 'requested'])
    expect(startBox(noReceived, false)).toBe('assigned')
    expect(inboxPath(noReceived, false)).toBe('/tasks/demands?box=assigned')
  })

  it('ninguém fica sem nada: sem a Lista e sem caixa visível, volta Recebidas; com a Lista, o menu leva a ela', () => {
    const onlyAll = views({ tasksList: 'hidden', tasksHiddenBoxes: ['received', 'assigned', 'requested'], tasksStart: 'inbox_all' })
    expect(visibleBoxes(onlyAll, false)).toEqual(['received'])
    expect(tasksEntryPath(onlyAll, false)).toBe('/tasks/demands')
    const listOnly = views({ tasksHiddenBoxes: ['received', 'assigned', 'requested'], tasksAllBox: 'hidden', tasksStart: 'inbox' })
    expect(visibleBoxes(listOnly, true)).toEqual([])
    expect(tasksEntryPath(listOnly, true)).toBe('/tasks')
  })

  it('sem a Lista, o menu leva à Caixa de entrada mesmo com "Lista" como entrada', () => {
    expect(tasksEntryPath(views({ tasksList: 'hidden' }), true)).toBe('/tasks/demands')
  })

  it('caixa Todas: exige ver todos os projetos e o perfil não escondê-la', () => {
    expect(showsAllBox(DEFAULT_TASK_VIEWS, true)).toBe(true)
    expect(showsAllBox(DEFAULT_TASK_VIEWS, false)).toBe(false)
    expect(showsAllBox(views({ tasksAllBox: 'hidden' }), true)).toBe(false)
  })
})
