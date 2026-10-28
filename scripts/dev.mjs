/**
 * Sobe API (Node, :8090 — precisa do Supabase local: supabase start) e web (Vite, :5173) juntos, com saída prefixada.
 * Ctrl+C encerra os dois — incluindo processos filhos (no Windows, via taskkill /T).
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'

/** Endereço da API pelo KAMBAN_HTTP do backend/.env, para o proxy do Vite apontar para ela (e não para o servidor da equipe). */
function apiTarget() {
  try {
    const line = fs.readFileSync(path.join(root, 'backend', '.env'), 'utf8').split(/\r?\n/).find((l) => /^\s*KAMBAN_HTTP\s*=/.test(l))
    const match = line && /^(.*):(\d+)$/.exec(line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2'))
    if (match) return `http://${!match[1] || match[1] === '0.0.0.0' ? '127.0.0.1' : match[1]}:${match[2]}`
  } catch {
    // sem backend/.env: o Vite usa o padrão dele
  }
  return undefined
}

const webEnv = { ...process.env }
if (!webEnv.KAMBAN_API_TARGET && apiTarget()) webEnv.KAMBAN_API_TARGET = apiTarget()

// Executa os scripts diretamente com o Node (sem shell): sinais e encerramento funcionam corretamente.
const services = [
  { name: 'api', color: '\x1b[35m', cwd: path.join(root, 'backend'), args: ['scripts/dev.js'], env: process.env },
  { name: 'web', color: '\x1b[36m', cwd: path.join(root, 'web'), args: ['node_modules/vite/bin/vite.js'], env: webEnv },
]

let stopping = false

const children = services.map(({ name, color, cwd, args, env }) => {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = `${color}[${name}]\x1b[0m `
  const forward = (stream) => (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => stream.write(prefix + line + '\n'))
  child.stdout.on('data', forward(process.stdout))
  child.stderr.on('data', forward(process.stderr))
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}encerrado (${code ?? 0})\n`)
    shutdown(code ?? 0)
  })
  return child
})

/** Encerra o processo e todos os descendentes (o servidor é filho do script da API). */
function killTree(child) {
  if (child.exitCode !== null || !child.pid) return
  if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGTERM')
}

function shutdown(code) {
  if (stopping) return
  stopping = true
  children.forEach(killTree)
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
