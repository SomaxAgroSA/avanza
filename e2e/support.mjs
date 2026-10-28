/**
 * Apoio dos testes de ponta a ponta (Fase 9).
 *
 * - Sobe um PocketBase isolado (dados temporários, migrations e hooks reais) servindo o build de
 *   produção do front (`backend/pb_public` — rode `npm run build` antes; `npm run e2e` já faz isso).
 * - Navegador: Edge instalado na máquina (playwright-core, sem baixar navegadores). Para usar o
 *   Chrome: KAMBAN_E2E_CHANNEL=chrome.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const require = createRequire(import.meta.url)
const { startPocketBase, createClient } = require('../backend/tests/support/pb-harness.js')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = path.join(ROOT, 'backend', 'pb_public')
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

export const ADMIN = { email: 'admin@kamban.test', password: 'AdminTest12345' }
export const PASSWORD = 'SenhaTeste123'

const RULES = [
  { label: 'POST /api/v1/auth/login', audience: '', duration: 60, maxRequests: 1000 },
  { label: '/api/v1/', audience: '', duration: 60, maxRequests: 100000 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 100000 },
]

export async function startApp() {
  if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) throw new Error('Build do front não encontrado: rode "npm run build" (ou "npm run e2e").')
  const pb = await startPocketBase({}, { publicDir: PUBLIC_DIR })
  await pb.updateSettings({ rateLimits: { enabled: true, rules: RULES } })
  const admin = createClient(pb.api)
  await admin.login(ADMIN.email, ADMIN.password)
  return { pb, admin, baseUrl: pb.baseUrl, client: () => createClient(pb.api) }
}

export async function launchBrowser() {
  const browser = await chromium.launch({ channel: process.env.KAMBAN_E2E_CHANNEL || 'msedge', headless: process.env.KAMBAN_E2E_HEADED !== '1' })
  // os testes esperam a interface em pt-BR, qualquer que seja o idioma da máquina (no macOS o
  // Chrome ignora --lang e segue o idioma do sistema); um teste pode pedir outro locale
  const newContext = browser.newContext.bind(browser)
  browser.newContext = (options = {}) => newContext({ locale: 'pt-BR', ...options })
  return browser
}

/** Erros do navegador (exceções e console.error), exceto respostas HTTP esperadas nos fluxos. */
export function watchErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    // respostas tratadas pela tela (validação, sessão, permissão, conflito) não são erro do app
    if (/status of (400|401|403|404|409)/.test(text)) return
    errors.push(`console: ${text}`)
  })
  return errors
}

export async function login(browser, baseUrl, email, password, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1366, height: 900 }, colorScheme: options.colorScheme, bypassCSP: !!options.axe })
  const page = await context.newPage()
  const errors = watchErrors(page)
  await page.goto(`${baseUrl}/login`)
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL('**/dashboard')
  return { page, context, errors }
}

/** Chamada à API a partir da página (usa o cookie da sessão do navegador). */
export function api(page, method, apiPath, body) {
  return page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(`/api/v1${p}`, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kamban' }, body: b ? JSON.stringify(b) : undefined })
      return { status: res.status, json: await res.json().catch(() => null) }
    },
    [method, apiPath, body],
  )
}

/** Violações de acessibilidade graves/críticas (axe-core, WCAG 2.1 A/AA). */
export async function axeViolations(page) {
  await page.evaluate(AXE_SOURCE)
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
    const detail = (n) => {
      const data = n.any[0] && n.any[0].data
      // contraste: mostra as cores medidas para facilitar o ajuste do token
      return data && data.contrastRatio ? ` (${data.fgColor} em ${data.bgColor} = ${data.contrastRatio}:1)` : ''
    }
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + detail(n)) }))
  })
  return result.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}

/**
 * Nas telas internas só o <main> rola: se o documento também rolar, surge uma 2ª barra e a tela
 * treme quando um menu/seletor trava a rolagem do body (ex.: tabela sr-only sem âncora).
 */
export function documentVerticalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
}

/** A página não pode rolar na horizontal (o conteúdo cabe na largura). */
export function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

/** Dados base: projeto, membro e leitor (via API do administrador). */
export async function seedBase(admin) {
  const roles = (await admin.get('/roles')).body.data
  const role = (code) => roles.find((r) => r.code === code).id
  const member = (await admin.post('/users', { name: 'Mário Membro', email: 'mario@kamban.test', password: PASSWORD, role_id: role('MEMBER') })).body.data
  const viewer = (await admin.post('/users', { name: 'Lia Leitora', email: 'lia@kamban.test', password: PASSWORD, role_id: role('VIEWER') })).body.data
  const project = (await admin.post('/projects', { name: 'Projeto E2E', key: 'E2E' })).body.data
  await admin.post(`/projects/${project.id}/members`, { user_id: member.id, role: 'member' })
  await admin.post(`/projects/${project.id}/members`, { user_id: viewer.id, role: 'viewer' })
  const types = (await admin.get('/task-types')).body.data
  const statuses = (await admin.get('/statuses')).body.data
  const doc = types.find((t) => t.key === 'DOCUMENTACAO')
  const task = async (title, extra) => (await admin.post('/tasks', Object.assign({ project_id: project.id, task_type_id: doc.id, title }, extra))).body.data
  return { member, viewer, project, types, statuses, doc, task }
}
