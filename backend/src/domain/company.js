/**
 * Empresas do grupo (regras de negócio §46, ADR-058): cadastro da plataforma (Configurações → Empresas),
 * ligado ao projeto e à demanda interna.
 *
 * - Nome único sem diferença de maiúsculas/minúsculas (espaços repetidos viram um só); sigla opcional, em
 *   maiúsculas. Não se exclui: desativa-se. A inativa continua nos registros que já a usam, mas não é
 *   oferecida para os novos.
 * - Projeto: `projects.company_id`. Obrigatória ao criar quando existe ao menos uma empresa ativa (assim
 *   instalações sem empresas continuam funcionando); os projetos antigos começam sem empresa.
 * - Tarefa de projeto não guarda empresa: herda a do projeto. Só a demanda interna (caixa de sistema) guarda
 *   a sua (`tasks.company_id`), com a mesma regra de obrigatoriedade.
 */

const NAME_MAX = 120
const SHORT_CODE_MAX = 10
const SHORT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9.&-]*$/

/** Nome como fica gravado: sem espaços nas pontas e sem espaços repetidos. */
function normalizeName(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .replace(/\s+/g, ' ')
}

/** Chave da unicidade (sem diferença de maiúsculas/minúsculas). */
function nameKey(value) {
  return normalizeName(value).toLowerCase()
}

function nameIssue(value) {
  if (typeof value !== 'string') return 'invalid_type'
  const name = normalizeName(value)
  if (!name) return 'required'
  return name.length > NAME_MAX ? 'too_long' : null
}

/** Sigla gravada: maiúsculas, sem espaços nas pontas ('' = sem sigla). */
function normalizeShortCode(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .toUpperCase()
}

/** Sigla opcional: letras, dígitos e . & - (começa por letra ou dígito), até 10 caracteres. */
function shortCodeIssue(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return 'invalid_type'
  const code = normalizeShortCode(value)
  if (!code) return null
  if (code.length > SHORT_CODE_MAX) return 'too_long'
  return SHORT_CODE_PATTERN.test(code) ? null : 'invalid_format'
}

/** Com ao menos uma empresa ativa, projeto novo e demanda interna nova precisam de uma. */
function companyRequired(companies) {
  return (companies || []).some((company) => company.active !== false)
}

/**
 * Empresa que vale para a tarefa: a da própria demanda interna (caixa de sistema) ou a do projeto (tarefa de
 * projeto, inclusive a que tem o fluxo do responsável).
 */
function effectiveCompanyId(task, project) {
  if (!task || !project) return null
  if (project.kind) return task.companyId || null
  return project.companyId || null
}

module.exports = { NAME_MAX, SHORT_CODE_MAX, normalizeName, nameKey, nameIssue, normalizeShortCode, shortCodeIssue, companyRequired, effectiveCompanyId }
