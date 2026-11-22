import { describe, expect, it } from 'vitest'
import { COLUMN_LABEL_MAX, labelOf, resolveColumnLabel, withColumnLabel } from './column-labels'

describe('nomes das colunas (§44)', () => {
  it('o nome da pessoa vem antes do nome para todos, que vem antes do nome do sistema', () => {
    expect(resolveColumnLabel('lead', 'Líder', { lead: 'Meu dono' }, { lead: 'Dono' })).toBe('Meu dono')
    expect(resolveColumnLabel('lead', 'Líder', {}, { lead: 'Dono' })).toBe('Dono')
    expect(resolveColumnLabel('lead', 'Líder', {}, {})).toBe('Líder')
    expect(resolveColumnLabel('lead', 'Líder', undefined, undefined)).toBe('Líder')
  })

  it('só o nome guardado conta (nada herdado do objeto)', () => {
    expect(labelOf({}, 'constructor')).toBeUndefined()
    expect(resolveColumnLabel('toString', 'Texto', {}, {})).toBe('Texto')
  })

  it('trocar o nome: sem espaços nas pontas, até 40; vazio ou igual ao padrão volta ao padrão', () => {
    expect(withColumnLabel({}, 'lead', '  Dono  ', 'Líder')).toEqual({ lead: 'Dono' })
    expect(withColumnLabel({ lead: 'Dono', name: 'Projeto' }, 'lead', '', 'Líder')).toEqual({ name: 'Projeto' })
    expect(withColumnLabel({ lead: 'Dono' }, 'lead', 'Líder', 'Líder')).toEqual({})
    expect(withColumnLabel({}, 'lead', 'x'.repeat(50), 'Líder').lead).toHaveLength(COLUMN_LABEL_MAX)
  })
})
