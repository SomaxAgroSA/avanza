import { describe, expect, it } from 'vitest'
import { acceptsNewOptions, normalizeTypeKey, slugifyName, valueIssue, withFieldOption, type CustomField, type FieldOption } from './task-config'

const field = (type: CustomField['type'], config: CustomField['config'] = {}, options: CustomField['options'] = []) => ({ type, config, options })

describe('domain/task-config', () => {
  it('opção adicionada pela tarefa: só em seleção com a configuração ligada', () => {
    expect(acceptsNewOptions(field('select', { allow_create_options: true }))).toBe(true)
    expect(acceptsNewOptions(field('multiselect', { allow_create_options: true }))).toBe(true)
    expect(acceptsNewOptions(field('select'))).toBe(false)
    expect(acceptsNewOptions(field('text', { allow_create_options: true }))).toBe(false)
  })

  it('inclui a opção nova no campo certo, na ordem, sem duplicar', () => {
    const option = (id: string, order: number, isActive = true): FieldOption => ({ id, label: id, color: 'gray', order, isActive })
    const sev = { id: 'f1', options: [option('a', 0), option('b', 1)] }
    expect(withFieldOption(sev, 'f1', option('c', 2)).options.map((o) => o.id)).toEqual(['a', 'b', 'c'])
    // reativada: troca a existente
    const back = withFieldOption({ id: 'f1', options: [option('a', 0), option('b', 1, false)] }, 'f1', option('b', 1))
    expect(back.options.map((o) => [o.id, o.isActive])).toEqual([['a', true], ['b', true]])
    // outro campo fica igual
    expect(withFieldOption(sev, 'f2', option('c', 2))).toBe(sev)
  })

  it('gera nome técnico e chave de tipo', () => {
    expect(slugifyName('Passos para reprodução')).toBe('passos_para_reproducao')
    expect(normalizeTypeKey(' nova funcionalidade ')).toBe('NOVA_FUNCIONALIDADE')
    expect(normalizeTypeKey('Adequação')).toBe('ADEQUACAO')
  })

  it('valida valores por tipo, igual ao backend', () => {
    expect(valueIssue(field('text'), '', true)).toBe('required')
    expect(valueIssue(field('text'), '', false)).toBeNull()
    expect(valueIssue(field('text', { max_length: 3 }), 'abcd', false)).toBe('too_long')
    expect(valueIssue(field('number', { min: 1 }), '0', false)).toBe('too_small')
    expect(valueIssue(field('number'), '2,5', false)).toBe('not_integer')
    expect(valueIssue(field('decimal'), '2,5', false)).toBeNull()
    expect(valueIssue(field('url'), 'ftp://x', false)).toBe('invalid_url')
    expect(valueIssue(field('phone'), '+55 (11) 99999-0000', false)).toBeNull()
    const options = [{ id: 'a', label: 'A', color: 'gray' as const, order: 0, isActive: true }]
    expect(valueIssue(field('select', {}, options), 'a', true)).toBeNull()
    expect(valueIssue(field('multiselect', {}, options), ['a', 'x'], false)).toBe('invalid_option')
  })
})
