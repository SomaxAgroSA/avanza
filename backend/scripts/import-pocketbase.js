/**
 * Migração dos dados do PocketBase para o Supabase (ADR-044; plano §8): copia todas as tabelas do
 * `data.db` (SQLite) para o esquema do Avanza no Postgres e os arquivos de `pb_data/storage` para o
 * bucket do Storage. Ids, datas, senhas (bcrypt), sessões e tokens (hashes) são mantidos — quem já usava
 * continua logado e as integrações seguem funcionando. As configurações de e-mail (SMTP) também vêm.
 *
 * Uso (com o backend/.env apontando para o Supabase de destino):
 *   npm run import:pocketbase -- --from /caminho/pb_data [--dry-run] [--replace]
 *
 * - Pare o servidor do PocketBase antes (o script lê uma cópia do banco, mas assim nada muda no meio).
 * - O destino precisa estar vazio (sem usuários); `--replace` apaga o que houver nele antes.
 * - `--dry-run` só lê a origem e mostra o que seria copiado.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { loadEnv } = require('./env')

// colunas internas da collection de autenticação que não existem no Postgres
const SKIP_AUTH = new Set(['tokenKey', 'emailVisibility', 'verified'])
// campos de texto no PocketBase que no Postgres são relação (vazio = NULL): a área responsável (§32)
const TEXT_RELATIONS = new Set(['area_id'])
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp4: 'video/mp4', mp3: 'audio/mpeg',
}
const BATCH = 200

function parseArgs(argv) {
  const args = { from: '', dryRun: false, replace: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') args.from = argv[++i] || ''
    else if (argv[i] === '--dry-run') args.dryRun = true
    else if (argv[i] === '--replace') args.replace = true
    else throw new Error(`Opção desconhecida: ${argv[i]}`)
  }
  if (!args.from) throw new Error('Informe a pasta do PocketBase: --from /caminho/pb_data')
  return args
}

/** Cópia do banco (data.db + WAL) numa pasta temporária: lê um retrato consistente sem tocar na origem. */
function openSnapshot(dataDir) {
  const source = path.join(dataDir, 'data.db')
  if (!fs.existsSync(source)) throw new Error(`Não encontrei ${source}`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avanza-import-'))
  ;['data.db', 'data.db-wal', 'data.db-shm'].forEach((name) => {
    if (fs.existsSync(path.join(dataDir, name))) fs.copyFileSync(path.join(dataDir, name), path.join(dir, name))
  })
  return { db: new DatabaseSync(path.join(dir, 'data.db')), dir }
}

/** PocketBase "2026-10-28 13:45:00.123Z" → Date (vazio → null). */
function pbDate(value) {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(String(value).replace(' ', 'T'))
  return isNaN(date.getTime()) ? null : date
}

function jsonText(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  try {
    return JSON.stringify(JSON.parse(value))
  } catch (_) {
    return fallback
  }
}

/** Colunas de destino e conversão de cada valor, a partir dos campos da collection. */
function columnsOf(collection) {
  return JSON.parse(collection.fields)
    .filter((f) => !(collection.type === 'auth' && SKIP_AUTH.has(f.name)))
    .map((f) => {
      const multi = f.maxSelect > 1
      const name = f.type === 'password' ? 'password_hash' : f.name
      let convert
      switch (f.type) {
        case 'bool':
          convert = (v) => v === 1 || v === true || v === '1' || v === 'true'
          break
        case 'number':
          convert = (v) => (v === null || v === '' ? 0 : Number(v))
          break
        case 'date':
        case 'autodate':
          convert = (v) => pbDate(v) || (f.type === 'autodate' ? new Date() : null)
          break
        case 'json':
          convert = (v) => jsonText(v, null)
          break
        case 'relation':
          convert = multi ? (v) => jsonText(v, '[]') : (v) => (v ? String(v) : null)
          break
        case 'select':
        case 'file':
          convert = multi ? (v) => jsonText(v, '[]') : (v) => (v === null || v === undefined ? '' : String(v))
          break
        default:
          convert = TEXT_RELATIONS.has(f.name) ? (v) => (v ? String(v) : null) : (v) => (v === null || v === undefined ? '' : String(v))
      }
      return { name, source: f.name, type: f.type, multi, convert }
    })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dataDir = path.resolve(args.from)
  const snapshot = openSnapshot(dataDir)
  const src = snapshot.db
  const collections = src.prepare("SELECT id, name, type, fields FROM _collections WHERE system = 0 AND type != 'view' ORDER BY name").all()
  const plan = collections.map((c) => ({ collection: c, columns: columnsOf(c), count: src.prepare(`SELECT count(*) AS n FROM "${c.name}"`).get().n }))
  const files = []
  plan.forEach(({ collection, columns }) => {
    const fileColumns = columns.filter((c) => c.type === 'file')
    if (fileColumns.length === 0) return
    src.prepare(`SELECT * FROM "${collection.name}"`).all().forEach((row) => {
      fileColumns.forEach((c) => {
        const names = c.multi ? JSON.parse(row[c.source] || '[]') : row[c.source] ? [row[c.source]] : []
        names.forEach((name) => files.push({ table: collection.name, collectionId: collection.id, id: row.id, name, mime: row.mime || '' }))
      })
    })
  })

  console.log(`Origem: ${dataDir}`)
  plan.filter((p) => p.count > 0).forEach((p) => console.log(`  ${p.collection.name}: ${p.count}`))
  console.log(`  arquivos: ${files.length}`)
  if (args.dryRun) {
    fs.rmSync(snapshot.dir, { recursive: true, force: true })
    return console.log('Simulação (--dry-run): nada foi gravado.')
  }

  const env = loadEnv()
  const config = require('../src/infrastructure/config').load(env)
  const { createRuntime, configIssues } = require('../src/infrastructure/runtime')
  const issues = configIssues(config)
  if (issues.length > 0) throw new Error(`Configuração incompleta:\n- ${issues.join('\n- ')}`)
  const log = { info: (m) => console.log(m), warn: (o, m) => console.warn(m || o) }
  const runtime = await createRuntime(config, log)
  const { db, storage, secrets } = runtime

  try {
    const users = await db.one('SELECT count(*) AS n FROM users')
    if (users.n > 0 && !args.replace) throw new Error(`O destino (esquema "${db.schema}") já tem ${users.n} usuário(s). Use --replace para apagar e importar de novo.`)

    console.log(`Destino: esquema "${db.schema}" e bucket "${storage.bucket}"`)
    await db.transaction(async (tx) => {
      // tabelas da origem (inclusive os cadastros iniciais, que vêm com os ids de lá)
      await tx.exec(`TRUNCATE ${plan.map((p) => `"${p.collection.name}"`).join(', ')}, storage_trash CASCADE`)
      await tx.exec('SET CONSTRAINTS ALL DEFERRED')
      for (const { collection, columns } of plan) {
        const rows = src.prepare(`SELECT * FROM "${collection.name}"`).all()
        for (let start = 0; start < rows.length; start += BATCH) {
          const chunk = rows.slice(start, start + BATCH)
          const params = []
          const values = chunk.map((row) => {
            const slots = columns.map((c) => {
              params.push(c.convert(row[c.source]))
              return `$${params.length}${c.type === 'json' || c.multi ? '::jsonb' : ''}`
            })
            return `(${slots.join(', ')})`
          })
          await tx.exec(`INSERT INTO "${collection.name}" (${columns.map((c) => `"${c.name}"`).join(', ')}) VALUES ${values.join(', ')}`, params)
        }
      }
      // SMTP e endereço do app (nas configurações internas do PocketBase); a senha vai cifrada
      const param = src.prepare('SELECT value FROM _params WHERE id = ?').get('settings')
      if (param) {
        const settings = JSON.parse(Buffer.isBuffer(param.value) || param.value instanceof Uint8Array ? Buffer.from(param.value).toString('utf8') : param.value)
        const smtp = settings.smtp || {}
        const meta = settings.meta || {}
        await tx.exec(
          `UPDATE email_settings SET enabled = $1, host = $2, port = $3, username = $4, password_secret = $5, tls = $6,
             sender_name = $7, sender_address = $8, app_url = $9 WHERE id = 'default'`,
          [!!smtp.enabled, smtp.host || '', Number(smtp.port) || 587, smtp.username || '', secrets.encrypt(smtp.password || ''), !!smtp.tls, meta.senderName || '', meta.senderAddress || '', meta.appURL || ''],
        )
      }
    })

    let copied = 0
    const missing = []
    for (const file of files) {
      const source = path.join(dataDir, 'storage', file.collectionId, file.id, file.name)
      if (!fs.existsSync(source)) {
        missing.push(`${file.table}/${file.id}/${file.name}`)
        continue
      }
      const ext = path.extname(file.name).slice(1).toLowerCase()
      await storage.put(`${file.table}/${file.id}/${file.name}`, fs.readFileSync(source), file.mime || MIME[ext] || 'application/octet-stream')
      copied++
    }

    // conferência: mesma quantidade de linhas em cada tabela
    const diffs = []
    for (const { collection, count } of plan) {
      const target = await db.one(`SELECT count(*) AS n FROM "${collection.name}"`)
      if (target.n !== count) diffs.push(`${collection.name}: origem ${count}, destino ${target.n}`)
    }
    console.log(`Arquivos copiados: ${copied}${missing.length ? ` (${missing.length} não encontrados na origem)` : ''}`)
    missing.slice(0, 20).forEach((key) => console.warn(`  sem arquivo: ${key}`))
    if (diffs.length > 0) throw new Error(`Contagens diferentes:\n- ${diffs.join('\n- ')}`)
    console.log(`Pronto: ${plan.length} tabelas conferidas.`)
  } finally {
    await db.close()
    fs.rmSync(snapshot.dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
