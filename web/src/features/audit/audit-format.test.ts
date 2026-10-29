import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/core/i18n'
import type { AuditEntry } from '@/domain/entities'
import { actionLabel, describeChanges } from './audit-format'

const entry = (overrides: Partial<AuditEntry>): AuditEntry => ({
  id: 'a1',
  entityType: 'user',
  entityId: 'u1',
  action: 'user.updated',
  oldValue: null,
  newValue: null,
  user: null,
  ip: '',
  correlationId: '',
  createdAt: null,
  ...overrides,
})

beforeAll(async () => {
  await i18n.changeLanguage('pt-BR')
})

describe('audit-format', () => {
  const t = i18n.t.bind(i18n)

  it('traduz ações conhecidas e mantém desconhecidas', () => {
    expect(actionLabel(t, 'user.disabled')).toBe('Desativou o usuário')
    expect(actionLabel(t, 'custom.thing')).toBe('custom.thing')
  })

  it('descreve alterações com rótulos e valores legíveis', () => {
    const changes = describeChanges(
      t,
      entry({ oldValue: { status: 'active', role_id: 'r1' }, newValue: { status: 'disabled', role_id: 'r2' } }),
      (field, value) => (field === 'role_id' ? { r1: 'Membro', r2: 'Gestor' }[value] : undefined),
    )
    expect(changes).toEqual([
      { field: 'status', label: 'Status', before: 'Ativo', after: 'Desativado' },
      { field: 'role_id', label: 'Perfil', before: 'Membro', after: 'Gestor' },
    ])
  })

  it('tarefas: campos principais primeiro, personalizados por último e pelo rótulo', () => {
    // o banco devolve as chaves em ordem alfabética
    const changes = describeChanges(
      t,
      entry({ newValue: { assignee: 'Ana', 'cf:Severidade': 'Alta', code: 'CRM-1', task_status: 'Backlog', title: 'Erro' } }),
    )
    expect(changes.map((c) => c.label)).toEqual(['Código', 'Título', 'Status', 'Responsável', 'Severidade'])
  })

  it('traduz a situação de sprints e de marcos (mesmo campo state)', () => {
    const states = (value: string) => describeChanges(t, entry({ newValue: { state: value } }))[0]?.after
    expect(states('active')).toBe(i18n.t('sprints.states.active'))
    expect(states('done')).toBe(i18n.t('timeline.milestones.states.done'))
    expect(states('done')).not.toBe('done')
  })

  it('traduz listas de permissões', () => {
    const [change] = describeChanges(t, entry({ newValue: { permissions: ['tasks.view'] } }))
    expect(change).toMatchObject({ label: 'Permissões', before: '', after: 'Ver tarefas' })
  })
})
