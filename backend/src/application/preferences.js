/**
 * Preferências da própria pessoa (regras de negócio §27): cada um lê e grava só as suas, por chave
 * (ex.: o configurador do filtro de projetos de cada tela). Não entram no histórico de auditoria: são
 * ajustes pessoais de visualização, sem efeito para os outros.
 */

const { appError } = require('../core/errors')
const rbac = require('../domain/rbac')
const preferences = require('../domain/preferences')

function createPreferenceService(deps) {
  const repo = deps.userPreferenceRepository

  function check(key, value) {
    const result = preferences.normalizePreference(key, value)
    if (result.fields) throw appError('VALIDATION_ERROR', undefined, { fields: result.fields })
    return result.value
  }

  async function getPreference(ctx, key) {
    rbac.assertAuthenticated(ctx.principal)
    check(key, null)
    const found = await repo.find(ctx.principal.userId, key)
    return { key, value: found ? found.value : null }
  }

  /** `input.value` nulo apaga (volta ao padrão). */
  async function savePreference(ctx, key, input) {
    rbac.assertAuthenticated(ctx.principal)
    const raw = input && Object.prototype.hasOwnProperty.call(input, 'value') ? input.value : undefined
    if (raw === undefined) throw appError('VALIDATION_ERROR', undefined, { fields: { value: 'required' } })
    const value = check(key, raw)
    if (value === null) {
      await repo.remove(ctx.principal.userId, key)
      return { key, value: null }
    }
    const saved = await repo.save(ctx.principal.userId, key, value)
    return { key, value: saved.value }
  }

  return { getPreference, savePreference }
}

module.exports = { createPreferenceService }
