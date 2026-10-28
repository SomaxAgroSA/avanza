import { describe, expect, it } from 'vitest'
import { OPTION_COLORS } from './task-config'
import { hexToOklch, hexTone, isHexColor, parseHexInput, toColor } from './colors'

describe('cor livre', () => {
  it('reconhece #rrggbb e lê da API a paleta, o hex ou o padrão', () => {
    expect(isHexColor('#1A7F37')).toBe(true)
    expect(isHexColor('#fff')).toBe(false)
    expect(toColor(OPTION_COLORS, 'teal', 'gray')).toBe('teal')
    expect(toColor(OPTION_COLORS, '#1A7F37', 'gray')).toBe('#1a7f37')
    expect(toColor(OPTION_COLORS, 'magenta', 'gray')).toBe('gray')
    expect(toColor(OPTION_COLORS, null, 'blue')).toBe('blue')
  })

  it('aceita o que a pessoa digita: com ou sem #, 3 ou 6 dígitos', () => {
    expect(parseHexInput('1a7f37')).toBe('#1a7f37')
    expect(parseHexInput(' #ABC ')).toBe('#aabbcc')
    expect(parseHexInput('#12345')).toBeNull()
    expect(parseHexInput('verde')).toBeNull()
  })

  it('converte para OKLCH (branco, preto e as primárias conhecidas)', () => {
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 3)
    expect(hexToOklch('#000000').l).toBeCloseTo(0, 3)
    const red = hexToOklch('#ff0000')
    expect(red.l).toBeCloseTo(0.628, 2)
    expect(red.c).toBeCloseTo(0.258, 2)
    expect(red.h).toBeCloseTo(29.2, 0)
    expect(hexToOklch('#0000ff').h).toBeCloseTo(264.1, 0)
  })

  it('tom: cores quase neutras viram cinza; saturação limitada', () => {
    expect(hexTone('#808080').chroma).toBe(0.02)
    expect(hexTone('#ff0000')).toEqual({ hue: 29, chroma: 0.2 })
    expect(hexTone('#1a7f37').chroma).toBeLessThan(0.2)
  })
})
