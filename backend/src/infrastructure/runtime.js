/**
 * Runtime compartilhado pela API, pelos scripts (create-admin, importação do PocketBase) e pelos testes:
 * conferência da configuração, banco (já migrado), Storage (bucket pronto) e segredos.
 */

const fs = require('node:fs')
const { createDatabase } = require('./database')
const { migrate } = require('./migrate')
const { createStorage } = require('./storage')
const { createSecrets } = require('./secrets')

/** Problemas de configuração que impedem a API de subir (lista vazia = ok). */
function configIssues(settings) {
  const issues = []
  if (!settings.database.url) issues.push('KAMBAN_DATABASE_URL (conexão do Postgres do Supabase) não definida')
  if (!settings.storage.url) issues.push('KAMBAN_SUPABASE_URL (endereço do Supabase) não definido')
  if (!settings.storage.secretKey) issues.push('KAMBAN_SUPABASE_SECRET_KEY (chave secreta do Supabase) não definida')
  if (settings.isProduction && !settings.secretKey) issues.push('KAMBAN_SECRET_KEY é obrigatória em produção (cifra os segredos guardados no banco)')
  if (['disable', 'require', 'verify-full'].indexOf(settings.database.sslMode) < 0) issues.push('KAMBAN_DB_SSL deve ser disable, require ou verify-full')
  return issues
}

function sslOptions(database) {
  if (database.sslMode === 'disable') return undefined
  if (database.sslMode === 'require') return { rejectUnauthorized: false }
  return { rejectUnauthorized: true, ca: database.caFile ? fs.readFileSync(database.caFile, 'utf8') : undefined }
}

/** Banco (migrado), Storage e segredos — o que a API, os scripts e os testes compartilham. */
async function createRuntime(settings, log) {
  const db = createDatabase({
    url: settings.database.url,
    schema: settings.database.schema,
    max: settings.database.poolSize,
    ssl: sslOptions(settings.database),
    onError: (message, err) => log.warn({ err }, message),
  })
  await migrate(db, { log: (message) => log.info(message) })
  const storage = createStorage(settings.storage)
  if (await storage.ensureBucket()) log.info(`bucket criado: ${settings.storage.bucket}`)
  return { config: settings, db, storage, secrets: createSecrets(settings.secretKey), log }
}

module.exports = { createRuntime, configIssues }
