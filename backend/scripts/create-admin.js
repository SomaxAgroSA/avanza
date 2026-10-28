/**
 * Cria/atualiza o SUPER_ADMIN usando KAMBAN_ADMIN_EMAIL, KAMBAN_ADMIN_PASSWORD e KAMBAN_ADMIN_NAME
 * (do ambiente ou de backend/.env). Aplica as migrations pendentes antes.
 * Uso: npm run create-admin
 */

const { loadEnv } = require('./env')

async function main() {
  const env = loadEnv()
  if (!env.KAMBAN_ADMIN_EMAIL || !env.KAMBAN_ADMIN_PASSWORD) {
    throw new Error('Defina KAMBAN_ADMIN_EMAIL e KAMBAN_ADMIN_PASSWORD (em backend/.env ou no ambiente).')
  }
  const config = require('../src/infrastructure/config').load(env)
  const { createRuntime, configIssues } = require('../src/infrastructure/runtime')
  const issues = configIssues(config)
  if (issues.length > 0) throw new Error(`Configuração incompleta:\n- ${issues.join('\n- ')}`)
  const log = { info: (m) => console.log(m), warn: (o, m) => console.warn(m || o) }
  const runtime = await createRuntime(config, log)
  try {
    const { bootstrapAdmin } = require('../src/infrastructure/bootstrap-admin')
    const result = await bootstrapAdmin(runtime, { email: env.KAMBAN_ADMIN_EMAIL, password: env.KAMBAN_ADMIN_PASSWORD, name: env.KAMBAN_ADMIN_NAME })
    console.log(`SUPER_ADMIN ${result.created ? 'criado' : 'atualizado'}: ${result.email}`)
  } finally {
    await runtime.db.close()
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
