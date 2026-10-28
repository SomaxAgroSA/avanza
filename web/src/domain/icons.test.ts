import { describe, expect, it } from 'vitest'
import { iconLabel, isIconName, toIcon, usageTotal } from './icons'
import { TASK_TYPE_ICONS } from './task-config'

describe('ícones', () => {
  it('lê da API: padrão do lugar, nome da galeria ou o padrão', () => {
    expect(toIcon(TASK_TYPE_ICONS, 'bug', 'check-square')).toBe('bug')
    expect(toIcon(TASK_TYPE_ICONS, 'tractor', 'check-square')).toBe('tractor')
    expect(toIcon(TASK_TYPE_ICONS, '<script>', 'check-square')).toBe('check-square')
    expect(toIcon(TASK_TYPE_ICONS, '', 'check-square')).toBe('check-square')
  })

  it('nome do Lucide e rótulo legível', () => {
    expect(isIconName('file-spreadsheet')).toBe(true)
    expect(isIconName('File')).toBe(false)
    expect(isIconName('x--y')).toBe(false)
    expect(iconLabel('file-spreadsheet')).toBe('file spreadsheet')
    expect(usageTotal({ projects: 1, taskTypes: 0, docSpaces: 2 })).toBe(3)
  })
})
