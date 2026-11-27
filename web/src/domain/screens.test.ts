import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCREENS,
  SCREEN_KEYS,
  chooseStart,
  isLastVisible,
  shows,
  startItem,
  toScreenSettings,
  toggleScreen,
  visibleItems,
  type ScreenSettings,
} from './screens'

// a paridade com o catálogo do servidor fica em backend/tests/unit/domain-screens.test.js
describe('"O que aparece" por perfil (domain/screens, §48)', () => {
  it('sem escolha: tudo visível; da API, só o conhecido e "Abre em" num item visível', () => {
    expect(SCREEN_KEYS.every((key) => shows(DEFAULT_SCREENS, key))).toBe(true)
    expect(toScreenSettings(undefined, null)).toEqual(DEFAULT_SCREENS)
    expect(toScreenSettings(['tasks.views.timeline', 'x', 'projects.lists.all'], { 'projects.lists': 'all', 'tasks.boxes': 'all', 'docs.actions': 'pdf' })).toEqual({
      hidden: ['projects.lists.all', 'tasks.views.timeline'],
      starts: { 'tasks.boxes': 'all' },
    })
  })

  it('itens visíveis e onde abre (o escolhido, se aparece e está disponível; senão o primeiro)', () => {
    const settings: ScreenSettings = { hidden: ['projects.lists.all'], starts: { 'projects.lists': 'archived', 'tasks.boxes': 'all' } }
    expect(visibleItems(settings, 'projects.lists')).toEqual(['ongoing', 'finished', 'archived'])
    expect(startItem(settings, 'projects.lists')).toBe('archived')
    expect(startItem(DEFAULT_SCREENS, 'projects.lists')).toBe('all')
    // a caixa Todas sem projects.view_all: a primeira disponível
    expect(startItem(settings, 'tasks.boxes', ['received', 'assigned'])).toBe('received')
  })

  it('marcar e desmarcar: sempre fica ao menos um por grupo e o "Abre em" do item escondido cai', () => {
    let settings = toggleScreen(DEFAULT_SCREENS, 'tasks.views', 'timeline', false)
    expect(settings.hidden).toEqual(['tasks.views.timeline'])
    expect(isLastVisible(settings, 'tasks.views', 'list')).toBe(true)
    expect(toggleScreen(settings, 'tasks.views', 'list', false)).toBe(settings)
    settings = chooseStart(toggleScreen(settings, 'tasks.views', 'timeline', true), 'tasks.views', 'timeline')
    expect(settings).toEqual({ hidden: [], starts: { 'tasks.views': 'timeline' } })
    settings = toggleScreen(settings, 'tasks.views', 'timeline', false)
    expect(settings).toEqual({ hidden: ['tasks.views.timeline'], starts: {} })
    // escolher como entrada um item escondido não muda nada
    expect(chooseStart(settings, 'tasks.views', 'timeline')).toBe(settings)
    // as escondidas ficam na ordem do catálogo
    expect(toggleScreen(toggleScreen(DEFAULT_SCREENS, 'tasks.views', 'timeline', false), 'projects.lists', 'all', false).hidden).toEqual(['projects.lists.all', 'tasks.views.timeline'])
  })

  it('"Fixar para mim" e "Fixar para todos" (§55): grupo opcional — um, outro ou nenhum', () => {
    expect(visibleItems(DEFAULT_SCREENS, 'tasks.row_actions')).toEqual(['pin_mine', 'pin'])
    let settings = toggleScreen(DEFAULT_SCREENS, 'tasks.row_actions', 'pin', false)
    expect(visibleItems(settings, 'tasks.row_actions')).toEqual(['pin_mine'])
    expect(isLastVisible(settings, 'tasks.row_actions', 'pin_mine')).toBe(false)
    settings = toggleScreen(settings, 'tasks.row_actions', 'pin_mine', false)
    expect(settings.hidden).toEqual(['tasks.row_actions.pin_mine', 'tasks.row_actions.pin'])
    expect(visibleItems(settings, 'tasks.row_actions')).toEqual([])
    expect(shows(settings, 'tasks.row_actions.pin_mine')).toBe(false)
  })
})
