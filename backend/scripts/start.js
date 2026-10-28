/**
 * Sobe a API (produção ou o servidor da equipe) com as variáveis do backend/.env.
 * Uso: npm start
 *
 * KAMBAN_HTTP_REDIRECT (opcional, ex.: 0.0.0.0:8090): endereço antigo que só redireciona para o
 * KAMBAN_HTTP — quem tinha o link com a porta antiga continua chegando, no mesmo host que digitou.
 */

const http = require('node:http')
const { loadEnv } = require('./env')

function startRedirect(value, targetPort, log) {
  const match = /^(.*):(\d+)$/.exec(String(value))
  if (!match) throw new Error(`KAMBAN_HTTP_REDIRECT inválido: "${value}" (use host:porta)`)
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || 'localhost').replace(/:\d+$/, '')
    const port = Number(targetPort) === 80 ? '' : `:${targetPort}`
    // 307 mantém o método (uma gravação que chegue aqui não vira GET)
    res.writeHead(307, { Location: `http://${host}${port}${req.url || '/'}`, 'Cache-Control': 'no-store' })
    res.end()
  })
  server.listen(Number(match[2]), match[1] || '0.0.0.0', () => log(`redirecionando ${value} → porta ${targetPort}`))
  return server
}

Object.assign(process.env, loadEnv())
require('../src/server')
  .start()
  .then(({ app, runtime, shutdown }) => {
    const redirect = process.env.KAMBAN_HTTP_REDIRECT ? startRedirect(process.env.KAMBAN_HTTP_REDIRECT, runtime.config.http.port, (m) => app.log.info(m)) : null
    ;['SIGINT', 'SIGTERM'].forEach((signal) =>
      process.on(signal, () => {
        if (redirect) redirect.close()
        shutdown(signal).then(() => process.exit(0))
      }),
    )
  })
  .catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
