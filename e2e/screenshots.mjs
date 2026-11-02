/**
 * Prints do README (docs/images/*.png) a partir dos dados de demonstraÃ§Ã£o, num PocketBase isolado
 * servindo o build â€” nada toca o banco local. Uso: npm run screenshots
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { ADMIN, launchBrowser, login, startApp } from './support.mjs'

const require = createRequire(import.meta.url)
const { seedDemo } = require('../backend/scripts/demo-data.js')
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'images')

const app = await startApp()
const browser = await launchBrowser()
try {
  const demo = await seedDemo(app.admin)
  const p = demo.project.id
  fs.mkdirSync(OUT, { recursive: true })

  const shots = [
    ['gestao-quadro', `/projects/${p}/management`, 'light'],
    ['gestao-cronograma', `/projects/${p}/management?view=timeline`, 'light'],
    // a visão Relatórios saiu do quadro: a saúde do projeto fica na visão geral do projeto
    ['gestao-relatorios', `/projects/${p}`, 'light'],
    ['kanban', `/projects/${p}/kanban`, 'light'],
    ['tarefa', `/tasks/${demo.task.id}`, 'light'],
    ['documentacao', `/docs/DEMO/${demo.page.id}`, 'light'],
    ['gestao-quadro-escuro', `/projects/${p}/management`, 'dark'],
  ]
  for (const [name, url, colorScheme] of shots) {
    const { page, context } = await login(browser, app.baseUrl, ADMIN.email, ADMIN.password, { viewport: { width: 1600, height: 940 }, colorScheme })
    await page.goto(`${app.baseUrl}${url}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(OUT, `${name}.png`) })
    await context.close()
    console.log(`docs/images/${name}.png`)
  }
} finally {
  await browser.close()
  await app.pb.stop()
}
