import { describe, expect, it } from 'vitest'
import { canAddSubproject, canHaveParent, isItRole, isOverdue, isValidKey, normalizeKey, parentCandidates, seesSection, suggestKey, type Project } from './projects'

describe('domain/projects', () => {
  it('sugere chave a partir do nome', () => {
    expect(suggestKey('Projetos Internos')).toBe('PI')
    expect(suggestKey('CRM')).toBe('CRM')
    expect(suggestKey('Integrações')).toBe('INTEG')
    expect(suggestKey('SAP Business One')).toBe('SAP')
    expect(suggestKey('CRM Corporativo')).toBe('CRM')
    expect(suggestKey('Portal do Cliente')).toBe('PDC')
    // iniciais "2M" viram "M" (chave não começa com número); com menos de 2 letras, usa o nome inteiro
    expect(suggestKey('2026 Migração')).toBe('MIGRA')
    expect(suggestKey('')).toBe('')
  })

  it('valida e normaliza a chave', () => {
    expect(normalizeKey(' crm ')).toBe('CRM')
    expect(isValidKey('CRM')).toBe(true)
    expect(isValidKey('C')).toBe(false)
    expect(isValidKey('1AB')).toBe(false)
  })

  it('identifica prazo vencido', () => {
    const now = new Date('2026-03-10T12:00:00Z')
    expect(isOverdue({ dueDate: new Date('2026-03-09T00:00:00Z'), status: 'active' }, now)).toBe(true)
    expect(isOverdue({ dueDate: new Date('2026-03-10T00:00:00Z'), status: 'active' }, now)).toBe(false)
    expect(isOverdue({ dueDate: new Date('2026-03-09T00:00:00Z'), status: 'completed' }, now)).toBe(false)
    expect(isOverdue({ dueDate: null, status: 'active' }, now)).toBe(false)
  })
})

describe('domain/projects — projeto pai e seções (regras §34 e §35)', () => {
  const base = (over: Partial<Project> = {}): Project => ({
    id: 'p1',
    name: 'CRM',
    key: 'CRM',
    description: '',
    platformUrl: '',
    icon: 'folder',
    cover: 'violet',
    status: 'active',
    priority: 'medium',
    urgency: null,
    area: null,
    parent: null,
    childCount: 0,
    owner: null,
    lead: null,
    startDate: null,
    dueDate: null,
    archivedAt: null,
    createdAt: null,
    updatedAt: null,
    memberCount: 1,
    myRole: 'manager',
    capabilities: { edit: true, manageMembers: true, archive: true, delete: false, transfer: false, uploadFiles: true, sections: ['charter', 'history', 'members', 'report'] },
    ...over,
  })
  const ref = { id: 'p9', key: 'PRG', name: 'Programa', icon: 'folder' as const, cover: 'blue' as const }

  it('um só nível: quem tem subprojetos não pode ter pai', () => {
    expect(canHaveParent(null)).toBe(true)
    expect(canHaveParent(base())).toBe(true)
    expect(canHaveParent(base({ childCount: 2 }))).toBe(false)
  })

  it('pais possíveis: sem pai, ativos, editáveis e nunca o próprio projeto', () => {
    const all = [
      base({ id: 'a' }),
      base({ id: 'b', parent: ref }),
      base({ id: 'c', archivedAt: new Date() }),
      base({ id: 'd', capabilities: { ...base().capabilities, edit: false } }),
      base({ id: 'p1' }),
    ]
    expect(parentCandidates(all, base()).map((p) => p.id)).toEqual(['a'])
    expect(parentCandidates(all, null).map((p) => p.id)).toEqual(['a', 'p1'])
  })

  it('novo subprojeto: quem cria projetos e edita um projeto principal ativo', () => {
    expect(canAddSubproject(base(), true)).toBe(true)
    expect(canAddSubproject(base(), false)).toBe(false)
    expect(canAddSubproject(base({ parent: ref }), true)).toBe(false)
    expect(canAddSubproject(base({ archivedAt: new Date() }), true)).toBe(false)
    expect(canAddSubproject(base({ capabilities: { ...base().capabilities, edit: false } }), true)).toBe(false)
  })

  it('seções vêm do servidor; o Responsável TI tem só o resumo', () => {
    expect(seesSection(base(), 'history')).toBe(true)
    expect(seesSection(base({ capabilities: { ...base().capabilities, sections: ['charter'] } }), 'history')).toBe(false)
    expect(isItRole(base({ myRole: 'it' }))).toBe(true)
    expect(isItRole(base())).toBe(false)
  })
})
