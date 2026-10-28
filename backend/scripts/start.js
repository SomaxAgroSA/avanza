/**
 * Sobe a API (produção ou o servidor da equipe) com as variáveis do backend/.env.
 * Uso: npm start
 */

const { loadEnv } = require('./env')

Object.assign(process.env, loadEnv())
require('../src/server').start()
  .then(({ shutdown }) => {
    ;['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal).then(() => process.exit(0))))
  })
  .catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
