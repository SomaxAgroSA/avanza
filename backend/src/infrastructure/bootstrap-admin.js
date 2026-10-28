/**
 * Cria ou atualiza o usuário SUPER_ADMIN (npm run create-admin e os testes). As credenciais vêm do
 * ambiente (KAMBAN_ADMIN_EMAIL, KAMBAN_ADMIN_PASSWORD, KAMBAN_ADMIN_NAME), nunca do código nem de
 * argumentos de linha de comando. O painel do banco é o Supabase Studio (não há superusuário à parte).
 */

const userDomain = require('../domain/user')
const { ROLE_CODES } = require('../domain/permissions')
const { createContainer } = require('./container')

/** @returns {Promise<{ id: string, email: string, created: boolean }>} */
async function bootstrapAdmin(runtime, input) {
  const email = userDomain.normalizeEmail(input.email)
  const password = input.password
  const name = input.name || 'Administrador'
  if (!email || email.indexOf('@') < 0) throw new Error('KAMBAN_ADMIN_EMAIL inválido ou ausente')
  const issue = userDomain.passwordIssue(password)
  if (issue) throw new Error(`KAMBAN_ADMIN_PASSWORD inválida: ${issue} (mín. ${userDomain.PASSWORD_MIN} caracteres, letras e números)`)

  const { deps } = createContainer(runtime)
  return runtime.db.transaction(async () => {
    const role = await deps.roleRepository.findByCode(ROLE_CODES.SUPER_ADMIN)
    if (!role) throw new Error('Perfil SUPER_ADMIN não encontrado (rode as migrations)')
    const existing = await deps.userRepository.findByEmail(email)
    const patch = { name, password, status: userDomain.USER_STATUS.ACTIVE, roleId: role.id }
    if (existing) {
      await deps.userRepository.update(existing.id, patch)
      return { id: existing.id, email, created: false }
    }
    const user = await deps.userRepository.create(Object.assign({ email, locale: 'pt-BR', theme: 'system' }, patch))
    return { id: user.id, email, created: true }
  })
}

module.exports = { bootstrapAdmin }
