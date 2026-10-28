/**
 * Teste de carga (manual) do cenário "equipe pequena + muitos leitores da documentação":
 * sobe a API isolada (esquema novo no Supabase local) e mede, ao mesmo tempo,
 *  - DOCS_WORKERS pessoas trabalhando (Kanban, listas, tarefa, Gestão, gravações) com pausa de 1–3 s;
 *  - DOCS_READERS leitores logados abrindo páginas da documentação (árvore do espaço + página +
 *    imagens, como o navegador faz), cada um com a conexão do tempo real aberta e a conferência da
 *    sessão e do sino a cada 5 min.
 * Uso: npm --prefix backend run load:docs
 *
 * Variáveis: DOCS_READERS=500  DOCS_ACCOUNTS=100 (contas dos leitores; cada uma em vários "navegadores")
 *   DOCS_LEVELS=60,30,15 (segundos, em média, entre duas páginas abertas por leitor)  DOCS_SECONDS=60
 *   DOCS_WORKERS=10  DOCS_PAGES=40  DOCS_IMAGES=2 (por página)  DOCS_SSE=1  KAMBAN_DB_POOL.
 */

const { startServer, createClient } = require('../tests/support/server-harness')

const READERS = Number(process.env.DOCS_READERS || 500)
const ACCOUNTS = Number(process.env.DOCS_ACCOUNTS || 100)
const LEVELS = (process.env.DOCS_LEVELS || '60,30,15').split(',').map(Number)
const SECONDS = Number(process.env.DOCS_SECONDS || 60)
const WORKERS = Number(process.env.DOCS_WORKERS || 10)
const PAGES = Number(process.env.DOCS_PAGES || 40)
const IMAGES = Number(process.env.DOCS_IMAGES || 2)
const SSE = process.env.DOCS_SSE !== '0'
const PASSWORD = 'SenhaTeste123'
const SESSION_CHECK_S = 300

/** PNG válido de 1x1 seguido de enchimento: ~40 KB, o tamanho de um print comprimido. */
const PNG = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
  Buffer.alloc(40 * 1024, 7),
])
const LOREM =
  'O cadastro de clientes exige a validação do CNPJ e do endereço de cobrança antes da primeira venda. ' +
  'Quando houver divergência, o atendimento abre uma solicitação e acompanha o retorno do financeiro.'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** Intervalo aleatório com média `mean` (chegadas independentes, como pessoas de verdade). */
const exp = (mean) => -Math.log(1 - Math.random()) * mean
const pick = (list) => list[Math.floor(Math.random() * list.length)]

async function pool(items, size, fn) {
  let index = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (index < items.length) await fn(items[index++])
    }),
  )
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

/** Conexão do tempo real como a do navegador: abre o SSE e assina o tópico da pessoa. */
async function openRealtime(baseUrl, client, userId, connections) {
  const controller = new AbortController()
  const res = await fetch(`${baseUrl}/api/realtime`, { signal: controller.signal })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!buffer.includes('PB_CONNECT') || !buffer.includes('\n\n')) {
    const { value, done } = await reader.read()
    if (done) throw new Error('SSE fechou antes do PB_CONNECT')
    buffer += decoder.decode(value)
  }
  const clientId = JSON.parse(/data:(.*)/.exec(buffer)[1]).clientId
  const sub = await fetch(`${baseUrl}/api/realtime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: client.cookie(), 'X-Requested-With': 'kamban' },
    body: JSON.stringify({ clientId, subscriptions: [`user:${userId}`] }),
  })
  if (sub.status !== 204) throw new Error(`assinatura recusada: ${sub.status}`)
  const connection = { controller, open: true }
  connections.push(connection)
  // segue lendo (descarta) para a conexão continuar viva; fechada pelo servidor = não está mais aberta
  ;(async () => {
    try {
      for (;;) if ((await reader.read()).done) break
    } catch (_) {
      /* encerrada no fim do teste */
    }
    connection.open = false
  })()
}

async function main() {
  const pb = await startServer()
  const connections = []
  try {
    await pb.updateSettings({ rateLimits: { enabled: false, rules: [] } })
    const admin = createClient(pb.api)
    await admin.login(pb.admin.email, pb.admin.password)
    const roles = (await admin.get('/roles')).body.data
    const role = (code) => roles.find((r) => r.code === code).id

    console.log(`preparando: ${PAGES} páginas com ${IMAGES} imagens, ${ACCOUNTS} contas de leitura, ${WORKERS} pessoas trabalhando…`)
    const space = (await admin.post('/docs/spaces', { key: 'MANUAL', name: 'Manuais', visibility: 'company' })).body.data
    const pages = []
    await pool(Array.from({ length: PAGES }, (_, i) => i), 4, async (i) => {
      const page = (await admin.post(`/docs/spaces/${space.id}/pages`, { title: `Procedimento ${i + 1}` })).body.data
      const form = new FormData()
      for (let k = 0; k < IMAGES; k++) form.append('files', new Blob([PNG], { type: 'image/png' }), `tela-${k}.png`)
      const files = IMAGES ? (await admin.post(`/docs/pages/${page.id}/files`, form)).body.data : []
      const paragraphs = Array.from({ length: 18 }, (_, n) => ({ type: 'paragraph', content: [{ type: 'text', text: `${n + 1}. ${LOREM}` }] }))
      const images = files.map((file) => ({ type: 'image', attrs: { src: file.url, alt: file.name } }))
      const content = { type: 'doc', content: [paragraphs[0]].concat(images, paragraphs.slice(1)) }
      const published = await admin.post(`/docs/pages/${page.id}/publish`, { title: page.title, content })
      if (published.status !== 200) throw new Error(`publicar: ${JSON.stringify(published.body)}`)
      pages.push({ id: page.id, files: files.map((f) => f.url.replace('/api/v1', '')) })
    })

    const readers = []
    await pool(Array.from({ length: ACCOUNTS }, (_, i) => i), 8, async (i) => {
      const email = `leitor${i}@carga.test`
      const user = (await admin.post('/users', { name: `Leitor ${i}`, email, password: PASSWORD, role_id: role('VIEWER') })).body.data
      const client = createClient(pb.api)
      await client.login(email, PASSWORD)
      readers.push({ user, client })
    })

    // equipe: projeto de tamanho comum para 10 pessoas
    const type = (await admin.get('/task-types')).body.data.find((t) => t.key === 'DOCUMENTACAO').id
    const project = (await admin.post('/projects', { name: 'Projeto da equipe', key: 'EQP' })).body.data
    const team = []
    for (let i = 0; i < WORKERS; i++) {
      const email = `pessoa${i}@carga.test`
      const user = (await admin.post('/users', { name: `Pessoa ${i}`, email, password: PASSWORD, role_id: role('MEMBER') })).body.data
      await admin.post(`/projects/${project.id}/members`, { user_id: user.id, role: 'member' })
      const client = createClient(pb.api)
      await client.login(email, PASSWORD)
      team.push({ user, client })
    }
    const tasks = []
    await pool(Array.from({ length: 150 }, (_, i) => i), 8, async (i) => {
      tasks.push((await admin.post('/tasks', { project_id: project.id, task_type_id: type, title: `Tarefa ${i}`, assignee_id: team[i % team.length].user.id })).body.data)
    })
    const group = (await admin.post(`/projects/${project.id}/groups`, { name: 'Fase 1', color: 'blue' })).body.data
    for (let i = 0; i < 30; i++) await admin.post(`/projects/${project.id}/plan/items`, { group_id: group.id, name: `Elemento ${i}`, estimated_hours: 4 })

    if (SSE) {
      console.log(`abrindo ${READERS + WORKERS} conexões do tempo real…`)
      await pool(Array.from({ length: READERS }, (_, i) => i), 20, async (i) => {
        const r = readers[i % readers.length]
        await openRealtime(pb.baseUrl, r.client, r.user.id, connections)
      })
      for (const member of team) await openRealtime(pb.baseUrl, member.client, member.user.id, connections)
    }

    const WORK = [
      [30, 'kanban', (c) => c.get(`/projects/${project.id}/board`)],
      [20, 'lista de tarefas', (c) => c.get(`/tasks?project_id=${project.id}&perPage=25`)],
      [15, 'tarefa', (c) => c.get(`/tasks/${pick(tasks).id}`)],
      [10, 'quadro da Gestão', (c) => c.get(`/projects/${project.id}/plan`)],
      [10, 'comentários', (c) => c.get(`/tasks/${pick(tasks).id}/comments`)],
      [10, 'editar tarefa', (c) => c.patch(`/tasks/${pick(tasks).id}`, { description: `Atualizada em ${Date.now()}` })],
      [5, 'comentar', (c) => c.post(`/tasks/${pick(tasks).id}/comments`, { content: 'Comentário do teste de carga' })],
    ]
    const workTotal = WORK.reduce((sum, w) => sum + w[0], 0)
    const chooseWork = () => {
      let r = Math.random() * workTotal
      for (const w of WORK) {
        r -= w[0]
        if (r <= 0) return w
      }
      return WORK[0]
    }

    // aquecimento: passa por todas as VMs do pool
    await pool(Array.from({ length: 400 }, (_, i) => i), 60, async (i) => {
      const r = readers[i % readers.length].client
      await r.get(`/docs/pages/${pick(pages).id}`)
      await team[i % team.length].client.get(`/projects/${project.id}/board`)
    })

    const results = []
    for (const meanSeconds of LEVELS) {
      const stats = {}
      let errors = 0
      let requests = 0
      const record = (name, ms, status) => {
        ;(stats[name] = stats[name] || []).push(ms)
        requests++
        if (status === 0 || status >= 500 || status === 429) errors++
      }
      const timed = async (name, fn) => {
        const started = Date.now()
        const res = await fn().catch(() => ({ status: 0 }))
        record(name, Date.now() - started, res.status)
        return res
      }
      const deadline = Date.now() + SECONDS * 1000

      const readerLoops = Array.from({ length: READERS }, async (_, i) => {
        const client = readers[i % readers.length].client
        await sleep(Math.random() * meanSeconds * 1000)
        while (Date.now() < deadline) {
          const started = Date.now()
          const page = pick(pages)
          // o navegador busca a árvore do espaço e a página juntas; depois, as imagens
          await Promise.all([timed('doc: árvore do espaço', () => client.get('/docs/spaces/MANUAL')), timed('doc: página', () => client.get(`/docs/pages/${page.id}`))])
          await Promise.all(page.files.map((path) => timed('doc: imagem', () => client.get(path, { raw: true }))))
          record('doc: abrir página (total)', Date.now() - started, 200)
          requests--
          await sleep(exp(meanSeconds) * 1000)
        }
      })
      // sessão e sino de cada leitor a cada 5 min (em média)
      const backgroundLoops = Array.from({ length: READERS }, async (_, i) => {
        const client = readers[i % readers.length].client
        for (;;) {
          await sleep(exp(SESSION_CHECK_S) * 1000)
          if (Date.now() >= deadline) break
          await Promise.all([timed('sessão e sino', () => client.get('/auth/me')), timed('sessão e sino', () => client.get('/notifications/unread-count'))])
        }
      })
      const workerLoops = team.map(async ({ client }) => {
        while (Date.now() < deadline) {
          const [, name, fn] = chooseWork()
          await timed(`equipe: ${name}`, () => fn(client))
          await sleep(1000 + Math.random() * 2000)
        }
      })
      await Promise.all(readerLoops.concat(workerLoops))
      await Promise.race([Promise.all(backgroundLoops), sleep(100)])

      const all = []
      Object.keys(stats).forEach((name) => {
        if (name !== 'doc: abrir página (total)') all.push(...stats[name])
      })
      all.sort((a, b) => a - b)
      const row = (name) => {
        const list = (stats[name] || []).sort((a, b) => a - b)
        return `${name.padEnd(26)} ${String(list.length).padStart(6)}  p50 ${String(percentile(list, 50)).padStart(5)} ms  p95 ${String(percentile(list, 95)).padStart(5)} ms`
      }
      const pagesPerSecond = (READERS / meanSeconds).toFixed(1)
      console.log(`\n— leitores abrindo uma página a cada ~${meanSeconds} s (${pagesPerSecond} páginas/s) + ${WORKERS} pessoas trabalhando —`)
      if (SSE) console.log(`  conexões do tempo real ainda abertas: ${connections.filter((c) => c.open).length} de ${connections.length}`)
      console.log(`  ${(requests / SECONDS).toFixed(1)} req/s · p50 ${percentile(all, 50)} ms · p95 ${percentile(all, 95)} ms · p99 ${percentile(all, 99)} ms · erros ${errors}`)
      Object.keys(stats)
        .sort()
        .forEach((name) => console.log('  ' + row(name)))
      results.push({ segundos_entre_paginas: meanSeconds, req_por_s: Math.round((requests / SECONDS) * 10) / 10, p95_ms: percentile(all, 95), erros: errors })
    }
    console.log(JSON.stringify(results))
  } finally {
    connections.forEach((c) => c.controller.abort())
    await pb.stop()
  }
}

// as rotinas de fundo (sessão e sino) dormem por minutos: sai ao terminar
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
