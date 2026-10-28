/**
 * Sobe a API em desenvolvimento (reinicia sozinha ao salvar um arquivo de src/ ou db/).
 * Precisa do Supabase local rodando: `supabase start` na raiz do repositório.
 * Uso: npm run dev
 */

const path = require('node:path')
const { spawn } = require('node:child_process')
const { ROOT, loadEnv } = require('./env')

const env = loadEnv()
const args = ['--watch-path=src', '--watch-path=db', path.join(ROOT, 'src', 'server.js')]
const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code || 0))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
