/**
 * Carrega backend/.env (formato CHAVE=valor) sem dependências externas.
 * Variáveis já definidas no ambiente têm prioridade.
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

function parseEnv(text) {
  const vars = {}
  String(text)
    .split(/\r?\n/)
    .forEach((line) => {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!match || line.trim().startsWith('#')) return
      vars[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
    })
  return vars
}

function loadEnv() {
  const file = path.join(ROOT, '.env')
  const env = Object.assign({}, process.env)
  if (!fs.existsSync(file)) return env
  const vars = parseEnv(fs.readFileSync(file, 'utf8'))
  Object.keys(vars).forEach((key) => {
    if (env[key] === undefined) env[key] = vars[key]
  })
  return env
}

module.exports = { ROOT, loadEnv, parseEnv }
