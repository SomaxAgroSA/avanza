import { describe, expect, it } from 'vitest'
import { companyLabel, companyRequired, filterCompanies, normalizeShortCode, type Company } from './companies'

const company = (name: string, extra: Partial<Company> = {}): Company => ({
  id: name,
  name,
  shortCode: '',
  active: true,
  projectCount: 0,
  demandCount: 0,
  usageCount: 0,
  createdAt: null,
  updatedAt: null,
  ...extra,
})

describe('empresas (§46)', () => {
  it('obrigatória só com alguma ativa', () => {
    expect(companyRequired([])).toBe(false)
    expect(companyRequired([company('A', { active: false })])).toBe(false)
    expect(companyRequired([company('A', { active: false }), company('B')])).toBe(true)
  })

  it('sigla em maiúsculas e rótulo com a sigla', () => {
    expect(normalizeShortCode(' smx ')).toBe('SMX')
    expect(companyLabel({ name: 'Somax', shortCode: 'SMX' })).toBe('Somax (SMX)')
    expect(companyLabel({ name: 'Agro', shortCode: '' })).toBe('Agro')
  })

  it('busca por nome ou sigla, filtra pelo estado e ordena', () => {
    const list = [company('Somax', { shortCode: 'SMX', usageCount: 3 }), company('Agro', { active: false, usageCount: 5 }), company('Beta', { usageCount: 1 })]
    expect(filterCompanies(list, {}).map((c) => c.name)).toEqual(['Agro', 'Beta', 'Somax'])
    expect(filterCompanies(list, { search: 'smx' }).map((c) => c.name)).toEqual(['Somax'])
    expect(filterCompanies(list, { state: 'inactive' }).map((c) => c.name)).toEqual(['Agro'])
    expect(filterCompanies(list, { state: 'active' }).map((c) => c.name)).toEqual(['Beta', 'Somax'])
    expect(filterCompanies(list, { sort: { id: 'usage', direction: 'desc' } }).map((c) => c.name)).toEqual(['Agro', 'Somax', 'Beta'])
    expect(filterCompanies(list, { sort: { id: 'state', direction: 'asc' } }).map((c) => c.name)).toEqual(['Beta', 'Somax', 'Agro'])
  })
})
