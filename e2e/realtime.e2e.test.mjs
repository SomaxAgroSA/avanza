/**
 * Tempo real no navegador: com o Kanban, uma tarefa ou o sino abertos, o que outra pessoa faz aparece
 * sozinho — sem recarregar a página.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PASSWORD, launchBrowser, login, seedBase, startApp } from './support.mjs'

describe('E2E — Tempo real', { timeout: 180000 }, () => {
  let app
  let browser
  let seed
  const contexts = []

  before(async () => {
    app = await startApp()
    browser = await launchBrowser()
    seed = await seedBase(app.admin)
  })

  after(async () => {
    for (const context of contexts) await context.close().catch(() => {})
    if (browser) await browser.close()
    if (app) await app.pb.stop()
  })

  it('cartão novo no Kanban, comentário na tarefa aberta e o sino atualizam sem recarregar', async () => {
    const { page, context, errors } = await login(browser, app.baseUrl, 'mario@kamban.test', PASSWORD)
    contexts.push(context)
    let reloads = 0
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloads++
    })

    await page.goto(`${app.baseUrl}/projects/${seed.project.id}/kanban`)
    await page.waitForSelector('[data-testid=kanban-board]')
    const onBoard = reloads
    // outra pessoa cria uma tarefa (pela API, como faria em outra aba)
    await seed.task('Chegou sozinha pelo tempo real')
    await page.getByText('Chegou sozinha pelo tempo real').waitFor({ timeout: 10000 })
    assert.equal(reloads, onBoard, 'o quadro não recarregou')

    // tarefa aberta: comentário de outra pessoa aparece
    const task = await seed.task('Tarefa com conversa')
    await page.goto(`${app.baseUrl}/tasks/${task.id}`)
    await page.getByRole('heading', { name: 'Tarefa com conversa' }).waitFor()
    await page.getByRole('tab', { name: /^Comentários/ }).click()
    await app.admin.post(`/tasks/${task.id}/comments`, { content: 'Comentário que chegou ao vivo' })
    await page.getByText('Comentário que chegou ao vivo').waitFor({ timeout: 10000 })

    // atribuir uma tarefa a ele: o sino mostra a notificação
    const before = reloads
    await seed.task('Para o Mário', { assignee_id: seed.member.id })
    await page.getByRole('button', { name: /^Notificações: 1 não lida/ }).waitFor({ timeout: 10000 })
    assert.equal(reloads, before, 'a página não recarregou')
    assert.deepEqual(errors, [])
  })
})
