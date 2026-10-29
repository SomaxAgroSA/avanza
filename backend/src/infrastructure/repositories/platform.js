/**
 * Repositórios Postgres da plataforma: Configurador geral (registro único `platform_settings`), tokens
 * de API pessoais, configuração do e-mail (`email_settings`, senha do SMTP cifrada), fila de saída de
 * e-mails e links de uso único (`auth_tokens`). O envio em si fica em infrastructure/adapters.js.
 */

const { newId, ident, toDbDate, toJson, insertRow, updateRow, findRow } = require('../sql')
const { storedFileName } = require('../storage')

/** Texto para coluna NOT NULL DEFAULT '' (o PocketBase gravava '' para vazio). */
const text = (value) => (value === undefined || value === null ? '' : String(value))
/** Inteiro para coluna NOT NULL DEFAULT 0. */
const int = (value) => Math.trunc(Number(value) || 0)

/** Linha que precisa existir (o PocketBase lançava "no rows in result set" em findRecordById). */
function mustExist(row, table, id) {
  if (!row) throw new Error(`Registro não encontrado: ${table}/${id}`)
  return row
}

// ---------------------------------------------------------------- Configurador geral

const PLATFORM_TABLE = 'platform_settings'
// colunas de arquivo da identidade (domain/platform-settings.js#BRANDING_SLOTS)
const BRANDING_COLUMNS = ['logo_light', 'logo_dark', 'favicon']

function objectOf(value) {
  return value && typeof value === 'object' ? value : {}
}

function brandingColumn(slot) {
  if (BRANDING_COLUMNS.indexOf(slot) < 0) throw new Error(`Arquivo de identidade desconhecido: ${slot}`)
  return slot
}

/**
 * Registro único do Configurador geral (valores alterados e arquivos de identidade). Se o registro
 * sumir, é recriado vazio (vale o padrão do domínio).
 */
function createPlatformSettingsRepository(db, ctx) {
  async function current() {
    const found = await db.one(`SELECT * FROM ${PLATFORM_TABLE} ORDER BY created ASC, id ASC LIMIT 1`)
    if (found) return found
    return insertRow(db, PLATFORM_TABLE, { values: toJson({}), files: toJson({}) })
  }

  return {
    async get() {
      const row = await current()
      return { values: objectOf(row.values), files: objectOf(row.files), updatedAt: row.updated }
    },

    async saveValues(values) {
      const row = await current()
      await updateRow(db, PLATFORM_TABLE, row.id, { values: toJson(values) })
    },

    /**
     * `data.handle` é o arquivo enviado ({ buffer, mime, name, size }); tipo e tamanho já foram
     * conferidos pelo caso de uso. O arquivo anterior vai para a lixeira do Storage pelo gatilho.
     */
    async setFile(slot, data) {
      const column = brandingColumn(slot)
      const row = await current()
      const files = Object.assign({}, objectOf(row.files))
      files[slot] = { name: data.name, mime: data.mime, size: data.size }
      const stored = storedFileName(data.handle.name || data.name)
      await ctx.storage.put(`${PLATFORM_TABLE}/${row.id}/${stored}`, data.handle.buffer, data.mime || data.handle.mime)
      await updateRow(db, PLATFORM_TABLE, row.id, { [column]: stored, files: toJson(files) })
    },

    async clearFile(slot) {
      const column = brandingColumn(slot)
      const row = await current()
      const files = Object.assign({}, objectOf(row.files))
      delete files[slot]
      await updateRow(db, PLATFORM_TABLE, row.id, { [column]: '', files: toJson(files) })
    },

    async fileKeyOf(slot) {
      const column = brandingColumn(slot)
      const row = await current()
      return `${PLATFORM_TABLE}/${row.id}/${row[column]}`
    },
  }
}

// ---------------------------------------------------------------- tokens de API

/** Tokens de API pessoais (só o hash do token é guardado). */
function createApiTokenRepository(db, ctx) {
  const TABLE = 'api_tokens'
  const toEntity = (row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    tokenHash: row.token_hash,
    prefix: row.prefix,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    lastUsedIp: row.last_used_ip,
    revokedAt: row.revoked_at,
    createdAt: row.created,
    // o valor cifrado nunca sai daqui; só se ele existe
    revealable: !!row.value_secret,
  })

  return {
    /** `data.value` (o token) é guardado cifrado com a chave do servidor, para o dono ver de novo. */
    async create(data) {
      const row = await insertRow(db, TABLE, {
        user_id: data.userId,
        name: text(data.name),
        token_hash: text(data.tokenHash),
        value_secret: data.value ? ctx.secrets.encrypt(data.value) : '',
        prefix: text(data.prefix),
        expires_at: toDbDate(data.expiresAt),
      })
      return toEntity(row)
    },

    async findById(id) {
      const row = await findRow(db, TABLE, id)
      return row ? toEntity(row) : null
    },

    async findByHash(hash) {
      const row = await db.one('SELECT * FROM api_tokens WHERE token_hash = $1', [text(hash)])
      return row ? toEntity(row) : null
    },

    async listByUser(userId) {
      return (await db.query('SELECT * FROM api_tokens WHERE user_id = $1 ORDER BY created DESC, id DESC', [userId])).map(toEntity)
    },

    async listAll() {
      return (await db.query('SELECT * FROM api_tokens ORDER BY created DESC, id DESC LIMIT 500')).map(toEntity)
    },

    async countActiveByUser(userId, now) {
      const row = await db.one(
        'SELECT count(*) AS total FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $2)',
        [userId, toDbDate(now)],
      )
      return row.total
    },

    async touch(id, at, ip) {
      const row = await updateRow(db, TABLE, id, { last_used_at: toDbDate(at), last_used_ip: text(ip).slice(0, 64) })
      return toEntity(mustExist(row, TABLE, id))
    },

    async revoke(id, at) {
      return toEntity(mustExist(await updateRow(db, TABLE, id, { revoked_at: toDbDate(at) }), TABLE, id))
    },

    /** O valor em claro (ou null se não foi guardado). */
    async revealValue(id) {
      const row = await db.one('SELECT value_secret FROM api_tokens WHERE id = $1', [id])
      return row && row.value_secret ? ctx.secrets.decrypt(row.value_secret) : null
    },
  }
}

// ---------------------------------------------------------------- e-mail

const EMAIL_SETTINGS_ID = 'default'
const EMAIL_COLUMNS = ['enabled', 'host', 'port', 'username', 'tls', 'sender_name', 'sender_address', 'app_url']

/**
 * Configuração do SMTP, do remetente e do endereço do app (linha única). A senha só sai daqui como
 * `hasPassword`; quem a decifra é o envio (adapters.js).
 */
function createEmailSettingsRepository(db, ctx) {
  async function current() {
    const row = await db.one('SELECT * FROM email_settings WHERE id = $1', [EMAIL_SETTINGS_ID])
    if (row) return row
    // a migration cria a linha; se alguém a apagou, volta com os padrões da tabela
    await db.exec('INSERT INTO email_settings (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [EMAIL_SETTINGS_ID])
    return db.one('SELECT * FROM email_settings WHERE id = $1', [EMAIL_SETTINGS_ID])
  }

  return {
    async get() {
      const row = await current()
      return {
        values: {
          enabled: !!row.enabled,
          host: row.host || '',
          port: row.port || 587,
          username: row.username || '',
          tls: !!row.tls,
          sender_name: row.sender_name || '',
          sender_address: row.sender_address || '',
          app_url: row.app_url || '',
        },
        hasPassword: !!row.password_secret,
      }
    },

    /** `password` undefined mantém a atual; '' apaga. */
    async save(values, password) {
      const row = {
        enabled: !!values.enabled,
        host: text(values.host),
        port: int(values.port),
        username: text(values.username),
        tls: !!values.tls,
        sender_name: text(values.sender_name),
        sender_address: text(values.sender_address),
        app_url: text(values.app_url),
      }
      const columns = EMAIL_COLUMNS.slice()
      if (password !== undefined) {
        row.password_secret = ctx.secrets.encrypt(password)
        columns.push('password_secret')
      }
      const params = [EMAIL_SETTINGS_ID].concat(columns.map((c) => row[c]))
      await db.exec(
        `INSERT INTO email_settings (id, ${columns.map(ident).join(', ')}) VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(', ')}) ` +
          `ON CONFLICT (id) DO UPDATE SET ${columns.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ')}`,
        params,
      )
    },
  }
}

/** Limite opcional como o do PocketBase: 0/vazio = sem limite. */
const limitOf = (limit) => (limit > 0 ? limit : null)

function createEmailOutboxRepository(db) {
  const TABLE = 'email_outbox'
  const toEntity = (row) => ({
    id: row.id,
    to: row.to,
    kind: row.kind,
    subject: row.subject,
    html: row.html,
    text: row.text,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    sentAt: row.sent_at,
    createdAt: row.created,
  })
  const TEXTS = { status: 'status', lastError: 'last_error', html: 'html', text: 'text' }
  const DATES = { nextAttemptAt: 'next_attempt_at', sentAt: 'sent_at' }

  return {
    async enqueue(entry) {
      const row = await insertRow(db, TABLE, {
        to: text(entry.to),
        kind: text(entry.kind),
        subject: text(entry.subject).slice(0, 300),
        html: text(entry.html),
        text: text(entry.text),
        status: 'pending',
        attempts: 0,
      })
      return toEntity(row)
    },

    async listDue(now, limit) {
      const rows = await db.query(
        "SELECT * FROM email_outbox WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= $1) ORDER BY created ASC, id ASC LIMIT $2",
        [toDbDate(now), limitOf(limit)],
      )
      return rows.map(toEntity)
    },

    async update(id, patch) {
      const values = {}
      Object.keys(patch).forEach((key) => {
        if (TEXTS[key]) values[TEXTS[key]] = text(patch[key])
        else if (key === 'attempts') values.attempts = int(patch.attempts)
        else if (DATES[key]) values[DATES[key]] = toDbDate(patch[key])
      })
      return toEntity(mustExist(await updateRow(db, TABLE, id, values), TABLE, id))
    },

    async counts() {
      const row = await db.one(
        "SELECT count(*) FILTER (WHERE status = 'pending') AS pending, count(*) FILTER (WHERE status = 'sent') AS sent, " +
          "count(*) FILTER (WHERE status = 'failed') AS failed FROM email_outbox",
      )
      return { pending: row.pending, sent: row.sent, failed: row.failed }
    },

    async listRecent(limit) {
      return (await db.query('SELECT * FROM email_outbox ORDER BY created DESC, id DESC LIMIT $1', [limitOf(limit)])).map(toEntity)
    },
  }
}

/** Links de uso único (convite e "Esqueci minha senha"); só o hash do token é guardado. */
function createAuthTokenRepository(db) {
  const TABLE = 'auth_tokens'
  const toEntity = (row) => ({
    id: row.id,
    userId: row.user_id,
    purpose: row.purpose,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created,
  })

  return {
    async create(data) {
      const row = await insertRow(db, TABLE, {
        user_id: data.userId,
        purpose: text(data.purpose),
        token_hash: text(data.tokenHash),
        expires_at: toDbDate(data.expiresAt),
      })
      return toEntity(row)
    },

    async findByHash(hash) {
      const row = await db.one('SELECT * FROM auth_tokens WHERE token_hash = $1', [text(hash)])
      return row ? toEntity(row) : null
    },

    async markUsed(id, at) {
      mustExist(await updateRow(db, TABLE, id, { used_at: toDbDate(at) }), TABLE, id)
    },

    async invalidateForUser(userId, purpose, at) {
      await db.exec('UPDATE auth_tokens SET used_at = $3 WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, text(purpose), toDbDate(at)])
    },

    async countSince(userId, purpose, since) {
      const row = await db.one('SELECT count(*) AS total FROM auth_tokens WHERE user_id = $1 AND purpose = $2 AND created >= $3', [userId, text(purpose), toDbDate(since)])
      return row.total
    },
  }
}

// ---------------------------------------------------------------- biblioteca de ícones

/** Ícones da galeria importados para a plataforma (regras §25); a chave é o nome do Lucide. */
function createIconLibraryRepository(db) {
  const toEntity = (row) => ({ name: row.name, createdBy: row.created_by || null, createdAt: row.created })
  const USED_IN = { projects: 'projects', task_types: 'task_types', doc_spaces: 'doc_spaces' }
  return {
    /** Mais recentes primeiro. */
    async list() {
      return (await db.query('SELECT * FROM icon_library ORDER BY created DESC, name ASC')).map(toEntity)
    },
    async exists(name) {
      return !!(await db.one('SELECT 1 AS found FROM icon_library WHERE name = $1', [name]))
    },
    /** Grava os que ainda não estão (concorrência: ON CONFLICT) e devolve só os nomes novos, na ordem pedida. */
    async addMany(names, userId) {
      const added = []
      for (const name of names) {
        const row = await db.one('INSERT INTO icon_library (name, created_by) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING RETURNING name', [name, userId || null])
        if (row) added.push(row.name)
      }
      return added
    },
    async remove(name) {
      await db.exec('DELETE FROM icon_library WHERE name = $1', [name])
    },
    /** Onde cada ícone está em uso: { [name]: { projects, task_types, doc_spaces } } (só os usados). */
    async usage(names) {
      const out = {}
      for (const [key, table] of Object.entries(USED_IN)) {
        const rows = await db.query(`SELECT icon, count(*)::int AS total FROM ${ident(table)} WHERE icon = ANY($1::text[]) GROUP BY icon`, [names])
        rows.forEach((row) => {
          out[row.icon] = Object.assign({ projects: 0, task_types: 0, doc_spaces: 0 }, out[row.icon])
          out[row.icon][key] = row.total
        })
      }
      return out
    },
  }
}

/** Preferências por pessoa e chave (uma linha cada; gravar de novo substitui). */
function createUserPreferenceRepository(db) {
  const toEntity = (row) => ({ userId: row.user_id, key: row.key, value: row.value, updatedAt: row.updated })
  return {
    async find(userId, key) {
      const row = await db.one('SELECT * FROM user_preferences WHERE user_id = $1 AND key = $2', [userId, key])
      return row ? toEntity(row) : null
    },
    async save(userId, key, value) {
      const row = await db.one(
        'INSERT INTO user_preferences (id, user_id, key, value) VALUES ($1, $2, $3, $4::jsonb) ' +
          'ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value RETURNING *',
        [newId(), userId, key, toJson(value)],
      )
      return toEntity(row)
    },
    async remove(userId, key) {
      await db.exec('DELETE FROM user_preferences WHERE user_id = $1 AND key = $2', [userId, key])
    },
  }
}

module.exports = {
  createUserPreferenceRepository,
  createIconLibraryRepository,
  createPlatformSettingsRepository,
  createApiTokenRepository,
  createEmailSettingsRepository,
  createEmailOutboxRepository,
  createAuthTokenRepository,
}
