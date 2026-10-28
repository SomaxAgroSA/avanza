import { describe, expect, it } from 'vitest'
import { isRequiredIn, isRequiredOnCreate, type CustomField, type TaskTypeField } from './task-config'
import { customValueIssues } from './tasks'

const field = (id: string, name: string): CustomField =>
  ({ id, name, label: name, type: 'text', description: '', config: {}, options: [], defaultValue: null }) as unknown as CustomField

const link = (extra: Partial<TaskTypeField>): TaskTypeField => ({
  field: field('f1', 'parecer'),
  order: 0,
  required: false,
  visible: true,
  showOnCard: false,
  requiredStatusIds: [],
  ...extra,
})

describe('obrigatório por status (espelha backend/domain/task.js requiredIn)', () => {
  it('exigido sempre, só nos status marcados, e nunca quando oculto', () => {
    expect(isRequiredIn(link({ required: true }), 'backlog')).toBe(true)
    expect(isRequiredIn(link({ requiredStatusIds: ['analise'] }), 'analise')).toBe(true)
    expect(isRequiredIn(link({ requiredStatusIds: ['analise'] }), 'backlog')).toBe(false)
    expect(isRequiredIn(link({ requiredStatusIds: ['analise'] }), undefined)).toBe(false)
    expect(isRequiredIn(link({ visible: false, required: true, requiredStatusIds: ['analise'] }), 'analise')).toBe(false)
  })

  it('ao criar, arquivo/imagem obrigatório não é exigido (o anexo só vem depois); os demais, sim', () => {
    const file = (type: string) => ({ ...field('f9', 'evidencias'), type }) as unknown as CustomField
    expect(isRequiredOnCreate(link({ field: file('file'), required: true }), 'backlog')).toBe(false)
    expect(isRequiredOnCreate(link({ field: file('image'), requiredStatusIds: ['analise'] }), 'analise')).toBe(false)
    expect(isRequiredOnCreate(link({ required: true }), 'backlog')).toBe(true)
    expect(isRequiredOnCreate(link({ requiredStatusIds: ['analise'] }), 'analise')).toBe(true)
    // depois de criada, a regra comum volta a valer
    expect(isRequiredIn(link({ field: file('file'), required: true }), 'backlog')).toBe(true)
  })

  it('a validação do formulário considera o status escolhido', () => {
    const fields = [link({ requiredStatusIds: ['analise'] }), link({ field: field('f2', 'versao'), required: true })]
    expect(customValueIssues(fields, { versao: '1.0' }, 'backlog')).toEqual({})
    expect(customValueIssues(fields, { versao: '1.0' }, 'analise')).toEqual({ parecer: 'required' })
    expect(customValueIssues(fields, {}, 'backlog')).toEqual({ versao: 'required' })
  })
})
