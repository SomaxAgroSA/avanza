const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { PERMISSIONS } = require('../../src/domain/permissions')
const { createTestDatabase } = require('../support/db-harness')
const { migrate } = require('../../src/infrastructure/migrate')
const { assertSchemaName } = require('../../src/infrastructure/database')

describe('migrations', () => {
  let t
  before(async () => {
    t = await createTestDatabase()
  })
  after(() => t.drop())

  it('criam as tabelas com RLS e os cadastros iniciais', async () => {
    const tables = await t.db.query('SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = $1', [t.schema])
    assert.ok(tables.length >= 47)
    assert.deepEqual(tables.filter((row) => !row.rowsecurity).map((row) => row.tablename), [])
    const [counts] = await t.db.query(
      'SELECT (SELECT count(*) FROM permissions) AS permissions, (SELECT count(*) FROM roles) AS roles, (SELECT count(*) FROM task_types) AS types',
    )
    assert.deepEqual(counts, { permissions: PERMISSIONS.length, roles: 5, types: 8 })
  })

  it('seções do projeto (§35): todo perfil que via projetos recebeu as quatro; os padrões batem com o catálogo', async () => {
    const { DEFAULT_ROLE_PERMISSIONS } = require('../../src/domain/permissions')
    const sections = ['projects.charter', 'projects.history', 'projects.members', 'projects.report']
    const rows = await t.db.query(
      `SELECT r.code, array_agg(p.code ORDER BY p.code) AS codes FROM roles r
       JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
       GROUP BY r.code`,
    )
    rows.forEach((row) => {
      const seesProjects = row.codes.includes('projects.view')
      sections.forEach((code) => assert.equal(row.codes.includes(code), seesProjects, `${row.code}: ${code}`))
      if (DEFAULT_ROLE_PERMISSIONS[row.code] && row.code !== 'SUPER_ADMIN') {
        sections.forEach((code) => assert.equal(DEFAULT_ROLE_PERMISSIONS[row.code].includes(code), seesProjects, `padrão ${row.code}: ${code}`))
      }
    })
  })

  it('Lista de tarefas (§44): todo perfil que via tarefas recebeu tasks.list; os padrões batem com o catálogo', async () => {
    const { DEFAULT_ROLE_PERMISSIONS } = require('../../src/domain/permissions')
    const catalog = await t.db.one("SELECT code, module FROM permissions WHERE code = 'tasks.list'")
    assert.deepEqual(catalog, { code: 'tasks.list', module: 'task_list' })
    const rows = await t.db.query(
      `SELECT r.code, array_agg(p.code ORDER BY p.code) AS codes FROM roles r
       JOIN role_permissions rp ON rp.role_id = r.id JOIN permissions p ON p.id = rp.permission_id
       GROUP BY r.code`,
    )
    rows.forEach((row) => {
      assert.equal(row.codes.includes('tasks.list'), row.codes.includes('tasks.view'), row.code)
      if (DEFAULT_ROLE_PERMISSIONS[row.code] && row.code !== 'SUPER_ADMIN') {
        assert.equal(DEFAULT_ROLE_PERMISSIONS[row.code].includes('tasks.list'), row.codes.includes('tasks.view'), `padrão ${row.code}`)
      }
    })
  })

  it('não reaplicam o que já rodou', async () => {
    assert.deepEqual(await migrate(t.db), [])
  })

  it('mantêm "updated" em dia e "created" distinto dentro da mesma transação', async () => {
    // a hora de cada gravação (clock_timestamp), não a do início da transação (now)
    await t.db.transaction(async (tx) => {
      await tx.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagaaaaaaaaaaa1', 'a', 'tagaaaaaaaaaaa1', 'red')")
      await tx.exec('SELECT pg_sleep(0.01)')
      await tx.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagaaaaaaaaaaa2', 'b', 'tagaaaaaaaaaaa2', 'red')")
    })
    const [first, second] = await t.db.query("SELECT created, updated FROM tags WHERE id LIKE 'tagaaaaaaaaaaa%' ORDER BY id")
    assert.ok(second.created > first.created)
    await t.db.exec('SELECT pg_sleep(0.01)')
    await t.db.exec("UPDATE tags SET name = 'c' WHERE id = 'tagaaaaaaaaaaa1'")
    const after = await t.db.one("SELECT created, updated FROM tags WHERE id = 'tagaaaaaaaaaaa1'")
    assert.ok(after.updated > first.updated)
    // milissegundos: a data que volta do JS é a mesma gravada
    assert.deepEqual(await t.db.one('SELECT count(*) AS n FROM tags WHERE created = $1', [after.created]), { n: 1 })
  })

  it('a API REST do Supabase (papéis anon/authenticated) não lê nem grava nada do esquema', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(
        t.db.transaction(async (tx) => {
          await tx.exec(`SET LOCAL ROLE ${role}`)
          await tx.query(`SELECT id FROM "${t.schema}".users LIMIT 1`)
        }),
        (err) => err.code === '42501',
        role,
      )
    }
  })

  it('recusam nome de esquema fora do padrão', () => {
    assert.throws(() => assertSchemaName('avanza; DROP TABLE x'), /inválido/)
  })
})

describe('transações', () => {
  let t
  before(async () => {
    // uma conexão só: se uma leitura dentro da transação pedisse outra conexão, o teste travaria
    t = await createTestDatabase({ max: 1 })
  })
  after(() => t.drop())

  it('confirmam no fim e desfazem tudo num erro', async () => {
    await t.db.transaction((tx) => tx.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagbbbbbbbbbbb1', 'ok', 'tagbbbbbbbbbbb1', 'red')"))
    await assert.rejects(
      t.db.transaction(async (tx) => {
        await tx.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagbbbbbbbbbbb2', 'falha', 'tagbbbbbbbbbbb2', 'red')")
        throw new Error('falhou')
      }),
      /falhou/,
    )
    const rows = await t.db.query("SELECT id FROM tags WHERE id LIKE 'tagbbbbbbbbbbb%' ORDER BY id")
    assert.deepEqual(rows.map((row) => row.id), ['tagbbbbbbbbbbb1'])
  })

  it('consultas pelo banco dentro da transação usam a mesma conexão (e veem o que ela gravou)', async () => {
    const seen = await t.db.transaction(async (tx) => {
      await tx.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagccccccccccc1', 'dentro', 'tagccccccccccc1', 'red')")
      return t.db.one("SELECT name FROM tags WHERE id = 'tagccccccccccc1'")
    })
    assert.deepEqual(seen, { name: 'dentro' })
  })

  it('aninhadas juntam-se à de fora', async () => {
    await assert.rejects(
      t.db.transaction(async () => {
        await t.db.transaction((inner) => inner.exec("INSERT INTO tags (id, name, name_key, color) VALUES ('tagddddddddddd1', 'x', 'tagddddddddddd1', 'red')"))
        throw new Error('desfaz a de dentro também')
      }),
    )
    assert.equal(await t.db.one("SELECT id FROM tags WHERE id = 'tagddddddddddd1'"), null)
  })
})

describe('migration 0038 — "O que aparece" por perfil (§48)', () => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { MIGRATIONS_DIR } = require('../../src/infrastructure/migrate')
  const { hiddenScreensIssue } = require('../../src/domain/screens')
  let t
  let before0038
  before(async () => {
    t = await createTestDatabase({ migrate: false })
    // o banco como estava antes da 0038, com perfis gravados pelos ajustes de tela antigos
    before0038 = fs.mkdtempSync(path.join(os.tmpdir(), 'avanza-0038-'))
    fs.readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql') && name < '0038')
      .forEach((name) => fs.copyFileSync(path.join(MIGRATIONS_DIR, name), path.join(before0038, name)))
    await migrate(t.db, { dir: before0038 })
    const roles = [
      ['r_default0000001', 'PADRAO', '', '', '', '', '', ''],
      ['r_director00001', 'DIRETOR', 'executive', 'inbox_all', 'hidden', '', '', 'ongoing'],
      ['r_both000000001', 'AMBAS', 'both', 'inbox_assigned', 'mine', 'hidden', 'received', 'ongoing,archived'],
      ['r_nobox00000001', 'SEMCAIXA', '', '', '', 'hidden', 'received,assigned,requested', 'nada'],
      ['r_nobox00000002', 'SOCAIXA', '', 'inbox', 'hidden', 'hidden', 'received,assigned,requested', ''],
    ]
    for (const [id, code, ongoing, start, list, allBox, boxes, lists] of roles) {
      await t.db.exec(
        'INSERT INTO roles (id, code, name, ongoing_view, tasks_start, tasks_list, tasks_all_box, tasks_hidden_boxes, projects_lists) VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)',
        [id, code, ongoing, start, list, allBox, boxes, lists],
      )
    }
    assert.deepEqual(await migrate(t.db), ['0038_role_hidden_screens.sql'])
  })
  after(async () => {
    fs.rmSync(before0038, { recursive: true, force: true })
    await t.drop()
  })

  const screensOf = async (code) => t.db.one('SELECT hidden_screens AS hidden, screen_starts AS starts FROM roles WHERE code = $1', [code])

  it('convertem o que estava gravado: cada perfil continua vendo o mesmo', async () => {
    assert.deepEqual(await screensOf('PADRAO'), { hidden: ['projects.ongoing_views.executive'], starts: {} })
    assert.deepEqual(await screensOf('DIRETOR'), {
      hidden: ['projects.lists.all', 'projects.lists.finished', 'projects.lists.archived', 'projects.ongoing_views.management', 'tasks.screens.list'],
      starts: { 'tasks.screens': 'inbox', 'tasks.boxes': 'all' },
    })
    assert.deepEqual(await screensOf('AMBAS'), {
      hidden: ['projects.lists.all', 'projects.lists.finished', 'tasks.scopes.all', 'tasks.boxes.received', 'tasks.boxes.all'],
      starts: { 'projects.ongoing_views': 'executive', 'tasks.screens': 'inbox', 'tasks.boxes': 'assigned' },
    })
    // sem caixa nenhuma e com a Lista: sem a Caixa de entrada (lista gravada desconhecida = as quatro)
    assert.deepEqual(await screensOf('SEMCAIXA'), { hidden: ['projects.ongoing_views.executive', 'tasks.screens.inbox'], starts: {} })
    // sem caixa nenhuma e sem a Lista: só Recebidas, como a tela já fazia
    assert.deepEqual(await screensOf('SOCAIXA'), {
      hidden: ['projects.ongoing_views.executive', 'tasks.screens.list', 'tasks.boxes.assigned', 'tasks.boxes.requested', 'tasks.boxes.all'],
      starts: { 'tasks.screens': 'inbox', 'tasks.boxes': 'received' },
    })
  })

  it('o resultado passa na validação do domínio (ao menos uma visível por grupo) e os perfis do sistema ficam como antes', async () => {
    const rows = await t.db.query('SELECT code, hidden_screens FROM roles')
    rows.forEach((row) => assert.equal(hiddenScreensIssue(row.hidden_screens), null, row.code))
    const system = await t.db.query("SELECT code, hidden_screens FROM roles WHERE is_system ORDER BY code")
    system.forEach((row) => assert.deepEqual(row.hidden_screens, ['projects.ongoing_views.executive'], row.code))
  })

  it('é idempotente: rodar de novo não muda nada (nem o que foi escolhido depois)', async () => {
    await t.db.exec("UPDATE roles SET hidden_screens = '[\"docs.actions.pdf\"]'::jsonb WHERE code = 'PADRAO'")
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0038_role_hidden_screens.sql'), 'utf8')
    await t.db.exec(sql)
    assert.deepEqual(await screensOf('PADRAO'), { hidden: ['docs.actions.pdf'], starts: {} })
    assert.deepEqual((await screensOf('DIRETOR')).starts, { 'tasks.screens': 'inbox', 'tasks.boxes': 'all' })
  })
})
