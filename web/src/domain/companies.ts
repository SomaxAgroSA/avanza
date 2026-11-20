/**
 * Empresas do grupo (regras de negócio §46): cadastro da plataforma (Configurações → Empresas), ligado ao
 * projeto e à demanda interna. A tarefa de projeto herda a empresa do projeto.
 */

/** Empresa num registro (projeto, tarefa, demanda). */
export interface CompanyRef {
  id: string
  name: string
  /** Sigla ('' = sem sigla). */
  shortCode: string
}

export interface Company extends CompanyRef {
  active: boolean
  /** Uso (só na lista de quem gerencia a plataforma; 0 nas demais). */
  projectCount: number
  demandCount: number
  usageCount: number
  createdAt: Date | null
  updatedAt: Date | null
}

export interface CompanyInput {
  name: string
  shortCode?: string
  active?: boolean
}

/** Com ao menos uma empresa ativa, projeto novo e demanda interna nova precisam de uma (a regra é do servidor). */
export function companyRequired(companies: readonly Pick<Company, 'active'>[]): boolean {
  return companies.some((company) => company.active)
}

/** Sigla como fica gravada: maiúsculas, sem espaços nas pontas. */
export function normalizeShortCode(value: string): string {
  return value.trim().toUpperCase()
}

/** Rótulo curto da empresa: "Nome (SIGLA)" ou só o nome. */
export function companyLabel(company: Pick<CompanyRef, 'name' | 'shortCode'>): string {
  return company.shortCode ? `${company.name} (${company.shortCode})` : company.name
}

export type CompanyStateFilter = 'active' | 'inactive'

/** Busca (nome ou sigla), estado e ordenação da lista de Configurações → Empresas (carregada de uma vez). */
export function filterCompanies(
  list: readonly Company[],
  options: { search?: string; state?: string; sort?: { id: string; direction: 'asc' | 'desc' } | null },
): Company[] {
  const term = (options.search ?? '').trim().toLocaleLowerCase()
  const rows = list.filter(
    (company) =>
      (!term || company.name.toLocaleLowerCase().includes(term) || company.shortCode.toLocaleLowerCase().includes(term)) &&
      (options.state !== 'active' || company.active) &&
      (options.state !== 'inactive' || !company.active),
  )
  const sort = options.sort ?? { id: 'name', direction: 'asc' as const }
  const value = (company: Company): string | number => {
    if (sort.id === 'shortCode') return company.shortCode.toLocaleLowerCase()
    if (sort.id === 'usage') return company.usageCount
    if (sort.id === 'state') return company.active ? 0 : 1
    return company.name.toLocaleLowerCase()
  }
  const factor = sort.direction === 'desc' ? -1 : 1
  return rows.slice().sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === vb) return a.name.localeCompare(b.name)
    return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * factor
  })
}
