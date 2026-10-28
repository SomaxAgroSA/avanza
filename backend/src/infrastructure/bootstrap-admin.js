/**
 * Cria ou atualiza o usuário SUPER_ADMIN a partir de variáveis de ambiente
 * e, opcionalmente, o superusuário do painel do PocketBase (/_/).
 * Executado pelo comando `pocketbase kamban-admin` (ver scripts/create-admin.js).
 * As credenciais nunca ficam em código nem em argumentos de linha de comando.
 */

const userDomain = require('../domain/user')
const { ROLE_CODES } = require('../domain/permissions')

function run(app) {
  const email = userDomain.normalizeEmail($os.getenv('KAMBAN_ADMIN_EMAIL'))
  const password = $os.getenv('KAMBAN_ADMIN_PASSWORD')
  const name = $os.getenv('KAMBAN_ADMIN_NAME') || 'Administrador'

  if (!email || email.indexOf('@') < 0) throw new Error('KAMBAN_ADMIN_EMAIL inválido ou ausente')
  const issue = userDomain.passwordIssue(password)
  if (issue) throw new Error(`KAMBAN_ADMIN_PASSWORD inválida: ${issue} (mín. ${userDomain.PASSWORD_MIN} caracteres, letras e números)`)

  app.runAllMigrations()

  const role = app.findFirstRecordByData('roles', 'code', ROLE_CODES.SUPER_ADMIN)
  let record
  try {
    record = app.findAuthRecordByEmail('users', email)
  } catch (_) {
    record = new Record(app.findCollectionByNameOrId('users'))
    record.setEmail(email)
    record.set('locale', 'pt-BR')
    record.set('theme', 'system')
  }
  record.set('name', name)
  record.setPassword(password)
  record.setVerified(true)
  record.set('status', userDomain.USER_STATUS.ACTIVE)
  record.set('role_id', role.id)
  app.save(record)

  console.log(`SUPER_ADMIN pronto: ${email}`)

  upsertSuperuser(app)
}

/** Superusuário do painel /_/ (acesso direto ao banco) — só se KAMBAN_SUPERUSER_* estiverem definidos. */
function upsertSuperuser(app) {
  const email = userDomain.normalizeEmail($os.getenv('KAMBAN_SUPERUSER_EMAIL'))
  const password = $os.getenv('KAMBAN_SUPERUSER_PASSWORD')
  if (!email && !password) return
  if (!email || email.indexOf('@') < 0) throw new Error('KAMBAN_SUPERUSER_EMAIL inválido')
  const issue = userDomain.passwordIssue(password)
  if (issue) throw new Error(`KAMBAN_SUPERUSER_PASSWORD inválida: ${issue}`)

  let record
  try {
    record = app.findAuthRecordByEmail('_superusers', email)
  } catch (_) {
    record = new Record(app.findCollectionByNameOrId('_superusers'))
    record.setEmail(email)
  }
  record.setPassword(password)
  app.save(record)
  console.log(`Superusuário do painel pronto: ${email}`)
}

module.exports = { run }
