/**
 * Casos de uso das empresas (regras de negócio §46, ADR-058): cadastro da plataforma.
 *
 * - Ler: qualquer pessoa autenticada vê as ativas (os formulários de projeto e de demanda interna oferecem
 *   só essas). `include_inactive=true` traz também as inativas e as contagens de uso (projetos e demandas
 *   internas) — só para quem gerencia a plataforma (`platform.manage`); sem a permissão, é ignorado.
 * - Criar e alterar (nome, sigla, ativa): `platform.manage`, com histórico (`company.created`/`company.updated`).
 * - Não se exclui: desativa-se. A inativa continua nos registros que já a usam.
 */

const { appError } = require('../core/errors')
const { assertValid, rules } = require('../core/validation')
const rbac = require('../domain/rbac')
const companyDomain = require('../domain/company')
const { buildAuditEntry, diff } = require('./audit')
const { iso } = require('./presenters')

const PERMISSION = 'platform.manage'

const FIELD_RULES = {
  name: [rules.custom((value) => companyDomain.nameIssue(value))],
  short_code: [rules.custom((value) => companyDomain.shortCodeIssue(value))],
  active: [rules.boolean()],
}

/** Resumo da empresa nos registros que a usam (projeto, tarefa, demanda). */
function companyRef(company) {
  return company ? { id: company.id, name: company.name, short_code: company.shortCode || '' } : null
}

function present(company, usage) {
  const dto = {
    id: company.id,
    name: company.name,
    short_code: company.shortCode || '',
    active: company.active !== false,
    created_at: iso(company.createdAt),
    updated_at: iso(company.updatedAt),
  }
  if (usage) {
    dto.project_count = usage.projects || 0
    dto.demand_count = usage.demands || 0
    dto.usage_count = dto.project_count + dto.demand_count
  }
  return dto
}

function auditView(company) {
  return { name: company.name, short_code: company.shortCode || '', active: company.active !== false }
}

function createCompanyService(deps) {
  const companies = () => deps.companyRepository

  async function findOrFail(id) {
    const company = typeof id === 'string' && id ? await companies().findById(id) : null
    if (!company) throw appError('COMPANY_NOT_FOUND')
    return company
  }

  async function assertUniqueName(name, exceptId) {
    const existing = await companies().findByNameKey(companyDomain.nameKey(name))
    if (existing && existing.id !== exceptId) throw appError('COMPANY_NAME_IN_USE')
  }

  async function audit(repos, ctx, id, action, oldValue, newValue) {
    await repos.auditRepository.record(buildAuditEntry(ctx, { entityType: 'company', entityId: id, action, oldValue, newValue }))
  }

  async function list(ctx, query) {
    rbac.assertAuthenticated(ctx.principal)
    const q = query || {}
    const manage = (q.include_inactive === 'true' || q.include_inactive === '1') && rbac.can(ctx.principal, PERMISSION)
    const items = await companies().list({ includeInactive: manage })
    if (!manage) return items.map((c) => present(c))
    const usage = items.length ? await companies().countUsage(items.map((c) => c.id)) : {}
    return items.map((c) => present(c, usage[c.id] || {}))
  }

  async function create(ctx, input) {
    rbac.assertCan(ctx.principal, PERMISSION)
    const source = input || {}
    const data = assertValid({ name: source.name === undefined ? '' : source.name, short_code: source.short_code, active: source.active }, FIELD_RULES)
    const name = companyDomain.normalizeName(data.name)
    await assertUniqueName(name)
    const created = await deps.unitOfWork.run(async (repos) => {
      const company = await repos.companyRepository.create({
        name,
        nameKey: companyDomain.nameKey(name),
        shortCode: companyDomain.normalizeShortCode(data.short_code),
        active: data.active !== false,
      })
      await audit(repos, ctx, company.id, 'company.created', null, auditView(company))
      return company
    })
    return present(created, {})
  }

  async function update(ctx, id, input) {
    rbac.assertCan(ctx.principal, PERMISSION)
    const company = await findOrFail(id)
    const source = input || {}
    const schema = {}
    Object.keys(FIELD_RULES).forEach((field) => {
      if (source[field] !== undefined) schema[field] = FIELD_RULES[field]
    })
    const data = assertValid(source, schema)
    const next = Object.assign({}, company)
    if (data.name !== undefined) {
      next.name = companyDomain.normalizeName(data.name)
      if (next.name !== company.name) await assertUniqueName(next.name, company.id)
    }
    if (source.short_code !== undefined) next.shortCode = companyDomain.normalizeShortCode(data.short_code)
    if (data.active !== undefined) next.active = data.active
    const before = auditView(company)
    const changes = diff(before, auditView(next), Object.keys(before))
    if (!changes) return present(company)
    const saved = await deps.unitOfWork.run(async (repos) => {
      const result = await repos.companyRepository.update(company.id, {
        name: next.name,
        nameKey: companyDomain.nameKey(next.name),
        shortCode: next.shortCode || '',
        active: next.active !== false,
      })
      await audit(repos, ctx, company.id, 'company.updated', changes.oldValue, changes.newValue)
      return result
    })
    return present(saved)
  }

  return { list, create, update }
}

module.exports = { createCompanyService, companyRef }
