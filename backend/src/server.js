/**
 * Ponto de entrada da API do Avanza (Node + Supabase, ADR-044): confere a configuração, aplica as
 * migrations, prepara o bucket do Storage, sobe o HTTP, o tempo real e as rotinas.
 *
 * Lê só as variáveis de ambiente (process.env); `npm start` e `npm run dev` carregam o backend/.env antes.
 * Uso: node src/server.js
 */

const config = require('./infrastructure/config')
const { createRuntime, configIssues } = require('./infrastructure/runtime')
const { createRealtimeHub } = require('./infrastructure/realtime')
const { startScheduler } = require('./infrastructure/jobs')
const { createContainer } = require('./infrastructure/container')
const { buildServer } = require('./http/server')

async function start(options) {
  const settings = (options && options.config) || config.load()
  const issues = configIssues(settings)
  if (issues.length > 0) throw new Error(`Configuração incompleta:\n- ${issues.join('\n- ')}`)

  // o logger do Fastify (pino) vale para tudo; o runtime usa o mesmo
  const bootLog = { info: (m) => console.log(m), warn: (o, m) => console.warn(m || o, o && o.err ? o.err.message : '') }
  const runtime = await createRuntime(settings, bootLog)
  const app = buildServer(runtime)
  runtime.log = app.log
  if (!settings.secretKey) app.log.warn('KAMBAN_SECRET_KEY não definida: usando a chave de desenvolvimento para os segredos')

  runtime.realtime = createRealtimeHub(runtime, (change) => createContainer(runtime).realtime.eventFor(change))
  await runtime.realtime.start()
  const scheduler = startScheduler(runtime)

  await app.listen({ host: settings.http.host, port: settings.http.port })

  let closing = false
  async function shutdown(signal) {
    if (closing) return
    closing = true
    app.log.info(`${signal}: encerrando`)
    scheduler.stop()
    await runtime.realtime.stop()
    await app.close()
    await runtime.db.close()
  }
  return { app, runtime, shutdown }
}

if (require.main === module) {
  start()
    .then(({ shutdown }) => {
      ;['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal).then(() => process.exit(0))))
    })
    .catch((err) => {
      console.error(err.message)
      process.exit(1)
    })
}

module.exports = { start, createRuntime, configIssues }
