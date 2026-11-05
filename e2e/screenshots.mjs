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
  // nome da plataforma como na instalação da Somax (Configurações → Geral)
  const named = await app.admin.patch('/settings/platform', { platform_name: 'Avanza' })
  if (named.status >= 300) throw new Error(`nome da plataforma: ${named.status}`)
  fs.mkdirSync(OUT, { recursive: true })

  const shots = [
    ['projeto-resumo', `/projects/${p}`, 'light'],
    ['projeto-ficha', `/projects/${p}?tab=charter`, 'light'],
    ['projeto-informe', `/projects/${p}?tab=report`, 'light'],
    ['controle-acesso', '/settings/access?tab=matrix', 'light'],
    ['gestao-quadro', `/project-management/${p}`, 'light'],
    ['gestao-cronograma', `/project-management/${p}?view=timeline`, 'light'],
    ['gestao-relatorios', `/project-management/${p}?view=reports`, 'light'],
    ['kanban', `/kanban/${p}`, 'light'],
    ['tarefa', `/tasks/${demo.task.id}`, 'light'],
    ['documentacao', `/docs/DEMO/${demo.page.id}`, 'light'],
    ['gestao-quadro-escuro', `/project-management/${p}`, 'dark'],
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
