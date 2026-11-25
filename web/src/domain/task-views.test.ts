import { describe, expect, it } from 'vitest'
import { DEFAULT_TASK_VIEWS, inboxHeader, inboxPath, showsAllBox, startBox, taskViewsOf, tasksEntryPath, visibleBoxes, type TaskViews } from './task-views'
import { DEFAULT_SCREENS, type ScreenKey } from './screens'

const views = (patch: Partial<TaskViews>): TaskViews => ({ ...DEFAULT_TASK_VIEWS, ...patch })

describe('Tarefas por perfil (ajustes 23 e 24/11)', () => {
  it('sem escolha fica como antes', () => {
    expect(taskViewsOf(DEFAULT_SCREENS)).toEqual(DEFAULT_TASK_VIEWS)
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

describe('Caixa de entrada com uma caixa só (ajuste 25/11)', () => {
  it('sem a Lista e com uma caixa: o nome "Caixa de entrada" no lugar dos botões', () => {
    expect(inboxHeader(views({ tasksList: 'hidden' }), ['all'])).toEqual({ boxSwitch: false, title: true })
  })
  it('com a Lista e uma caixa: nem botões nem nome (a aba Caixa de entrada já diz onde se está)', () => {
    expect(inboxHeader(DEFAULT_TASK_VIEWS, ['received'])).toEqual({ boxSwitch: false, title: false })
  })
  it('com várias caixas, os botões continuam', () => {
    expect(inboxHeader(views({ tasksList: 'hidden' }), ['received', 'all'])).toEqual({ boxSwitch: true, title: false })
    expect(inboxHeader(DEFAULT_TASK_VIEWS, ['received', 'assigned'])).toEqual({ boxSwitch: true, title: false })
  })
})

describe('Tarefas a partir do "O que aparece" do perfil (§48)', () => {
  const of = (hidden: ScreenKey[], starts: Record<string, string> = {}) => taskViewsOf({ hidden, starts })

  it('a Lista, o alcance dela e onde o menu abre', () => {
    expect(of(['tasks.screens.list']).tasksList).toBe('hidden')
    expect(of(['tasks.scopes.all']).tasksList).toBe('mine')
    expect(of(['tasks.scopes.mine']).tasksList).toBe('all')
    expect(of([], { 'tasks.screens': 'inbox', 'tasks.boxes': 'all' }).tasksStart).toBe('inbox_all')
    expect(of([], { 'tasks.screens': 'inbox' }).tasksStart).toBe('inbox')
    // a caixa escolhida escondida: a primeira visível
    expect(of(['tasks.boxes.received'], { 'tasks.screens': 'inbox' }).tasksStart).toBe('inbox_assigned')
  })

  it('as caixas escondidas; sem a Caixa de entrada, nenhuma caixa (e o menu leva à Lista)', () => {
    expect(of(['tasks.boxes.received', 'tasks.boxes.all'])).toMatchObject({ tasksHiddenBoxes: ['received'], tasksAllBox: 'hidden' })
    const noInbox = of(['tasks.screens.inbox'])
    expect(visibleBoxes(noInbox, true)).toEqual([])
    expect(tasksEntryPath(noInbox, true)).toBe('/tasks')
  })
})
