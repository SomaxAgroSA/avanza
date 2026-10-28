/**
 * Repositórios Postgres do núcleo: usuários, perfis, permissões, sessões, histórico de auditoria e
 * tentativas de login. Portas em application/ports.js; mesmo contrato dos repositórios do PocketBase.
 */

const crypto = require('node:crypto')
const bcrypt = require('bcryptjs')
const { appError } = require('../../core/errors')
const { storedFileName } = require('../storage')
const { newId, orderBy, likePattern, toDbDate, toJson, insertRow, updateRow, findRow, deleteRow } = require('../sql')

const UNIQUE_VIOLATION = '23505'
// mesmo custo do PocketBase quando não configurado
const DEFAULT_BCRYPT_COST = 10

/** Texto para coluna NOT NULL DEFAULT '' (o PocketBase gravava '' para vazio). */
const text = (value) => (value === undefined || value === null ? '' : String(value))

/** Linha que precisa existir (o PocketBase lançava "no rows in result set" em findRecordById). */
function mustExist(row, table, id) {
  if (!row) throw new Error(`Registro não encontrado: ${table}/${id}`)
  return row
}

function isUniqueViolation(err, constraint) {
  return !!err && err.code === UNIQUE_VIOLATION && (!constraint || err.constraint === constraint)
}

const USER_FIELDS = { name: 'name', roleId: 'role_id', status: 'status', locale: 'locale', theme: 'theme' }
// nunca carregar o hash da senha junto com o usuário
const USER_COLUMNS = '"id", "name", "email", "avatar", "status", "role_id", "locale", "theme", "email_notifications_off", "created", "updated", "last_login_at"'

function createUserRepository(db, ctx) {
  const cost = (ctx && ctx.bcryptCost) || DEFAULT_BCRYPT_COST

  function toEntity(row) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      // a versão muda a cada foto nova (o navegador guarda a anterior em cache)
      avatarUrl: row.avatar ? `/api/v1/users/${row.id}/avatar?v=${crypto.createHash('sha1').update(row.avatar).digest('hex').slice(0, 10)}` : null,
      status: row.status,
      roleId: row.role_id,
      locale: row.locale || 'pt-BR',
      theme: row.theme || 'system',
      emailNotifications: !row.email_notifications_off,
      createdAt: row.created,
      updatedAt: row.updated,
      lastLoginAt: row.last_login_at,
    }
  }

  /** E-mail repetido (índice único em lower(email)) vira o mesmo erro da checagem da aplicação. */
  async function guardEmail(fn) {
    try {
      return await fn()
    } catch (err) {
      if (isUniqueViolation(err, 'idx_email__pb_users_auth_')) throw appError('EMAIL_ALREADY_IN_USE')
      throw err
    }
  }

  function buildWhere(query, params) {
    const where = []
    if (query.search) {
      params.push(likePattern(query.search))
      where.push(`("name" ILIKE $${params.length} OR "email" ILIKE $${params.length})`)
    }
    if (query.status) {
      params.push(query.status)
      where.push(`"status" = $${params.length}`)
    }
    if (query.roleId) {
      params.push(query.roleId)
      where.push(`"role_id" = $${params.length}`)
    }
    return where.length ? `WHERE ${where.join(' AND ')}` : ''
  }

  return {
    async findById(id) {
      if (!id) return null
      const row = await db.one(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id])
      return row ? toEntity(row) : null
    },

    /** Sem diferenciar maiúsculas (como o findAuthRecordByEmail do PocketBase e o índice único). */
    async findByEmail(email) {
      const row = await db.one(`SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1)`, [text(email)])
      return row ? toEntity(row) : null
    },

    async findManyByIds(ids) {
      const list = (ids || []).filter(Boolean)
      if (list.length === 0) return []
      return (await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ANY($1::text[])`, [list])).map(toEntity)
    },

    async emailExists(email, exceptId) {
      const row = await db.one('SELECT 1 AS found FROM users WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1', [text(email), exceptId || ''])
      return !!row
    },

    async list(query) {
      const params = []
      const where = buildWhere(query, params)
      // colunas de ordenação vêm de whitelist na camada de aplicação
      const rows = await db.query(
        `SELECT ${USER_COLUMNS} FROM users ${where} ${orderBy(query.sort)} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        params.concat([query.pagination.perPage, query.pagination.offset]),
      )
      const count = await db.one(`SELECT count(*) AS total FROM users ${where}`, params)
      return { items: rows.map(toEntity), total: count.total }
    },

    async create(data) {
      const passwordHash = await bcrypt.hash(String(data.password), cost)
      const row = await guardEmail(() =>
        insertRow(db, 'users', {
          name: text(data.name),
          email: text(data.email),
          password_hash: passwordHash,
          role_id: data.roleId,
          status: text(data.status),
          locale: text(data.locale),
          theme: text(data.theme),
        }),
      )
      return toEntity(row)
    },

    /**
     * Foto do usuário em "users/<id>/<nome guardado>" (`handle`: arquivo enviado — http/files.js; tipo e
     * tamanho já conferidos). A anterior vai para a lixeira do Storage pelo gatilho.
     */
    async setAvatar(id, handle, mime) {
      const stored = storedFileName(handle.name)
      await ctx.storage.put(`users/${id}/${stored}`, handle.buffer, mime || handle.mime)
      return toEntity(mustExist(await updateRow(db, 'users', id, { avatar: stored }), 'users', id))
    },

    async clearAvatar(id) {
      return toEntity(mustExist(await updateRow(db, 'users', id, { avatar: '' }), 'users', id))
    },

    /** Chave da foto no Storage, ou null sem foto. */
    async avatarKeyOf(id) {
      const row = id ? await db.one('SELECT id, avatar FROM users WHERE id = $1', [id]) : null
      return row && row.avatar ? `users/${row.id}/${row.avatar}` : null
    },

    async update(id, patch) {
      const values = {}
      for (const key of Object.keys(patch)) {
        if (key === 'email') values.email = text(patch.email)
        else if (key === 'password') values.password_hash = await bcrypt.hash(String(patch.password), cost)
        else if (key === 'lastLoginAt') values.last_login_at = toDbDate(patch.lastLoginAt)
        else if (key === 'emailNotifications') values.email_notifications_off = !patch.emailNotifications
        else if (key === 'roleId') values.role_id = patch.roleId
        else if (USER_FIELDS[key]) values[USER_FIELDS[key]] = text(patch[key])
      }
      const row = await guardEmail(() => updateRow(db, 'users', id, values))
      return toEntity(mustExist(row, 'users', id))
    },

    /** bcrypt — as senhas vindas do PocketBase ($2a$) continuam valendo. */
    async verifyPassword(id, password) {
      if (!id) return false
      const row = await db.one('SELECT password_hash FROM users WHERE id = $1', [id])
      if (!row || !row.password_hash) return false
      try {
        return await bcrypt.compare(String(password), row.password_hash)
      } catch (_) {
        return false
      }
    },

    async countByRole(roleId) {
      return (await db.one('SELECT count(*) AS total FROM users WHERE role_id = $1', [roleId])).total
    },

    /** Usuários ativos (busca por nome/e-mail), excluindo `excludeIds`. */
    async searchActive(query) {
      const params = ['active']
      const where = ['"status" = $1']
      if (query.search) {
        params.push(likePattern(query.search))
        where.push(`("name" ILIKE $${params.length} OR "email" ILIKE $${params.length})`)
      }
      if (query.excludeIds && query.excludeIds.length > 0) {
        params.push(query.excludeIds)
        where.push(`NOT ("id" = ANY($${params.length}::text[]))`)
      }
      params.push(query.limit || null)
      const rows = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE ${where.join(' AND ')} ORDER BY "name" ASC, "id" ASC LIMIT $${params.length}`, params)
      return rows.map(toEntity)
    },
  }
}

function createRoleRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      isSystem: row.is_system,
    }
  }

  return {
    async findById(id) {
      const row = await findRow(db, 'roles', id)
      return row ? toEntity(row) : null
    },

    async findByCode(code) {
      const row = await db.one('SELECT * FROM roles WHERE code = $1', [text(code)])
      return row ? toEntity(row) : null
    },

    async list() {
      return (await db.query('SELECT * FROM roles ORDER BY "name" ASC, "id" ASC')).map(toEntity)
    },

    async getPermissionCodes(roleId) {
      const rows = await db.query(
        'SELECT p.code AS code FROM role_permissions rp INNER JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1 ORDER BY p.code',
        [roleId],
      )
      return rows.map((row) => row.code)
    },

    /** Deixa o perfil exatamente com `codes` (códigos desconhecidos são ignorados). */
    async setPermissionCodes(roleId, codes) {
      const list = (codes || []).filter(Boolean)
      const keep = list.length ? (await db.query('SELECT id FROM permissions WHERE code = ANY($1::text[])', [list])).map((row) => row.id) : []
      await db.exec('DELETE FROM role_permissions WHERE role_id = $1 AND NOT (permission_id = ANY($2::text[]))', [roleId, keep])
      if (keep.length === 0) return
      await db.exec(
        'INSERT INTO role_permissions (id, role_id, permission_id) SELECT t.id, $1, t.permission_id FROM unnest($2::text[], $3::text[]) AS t(id, permission_id) ' +
          'ON CONFLICT (role_id, permission_id) DO NOTHING',
        [roleId, keep.map(() => newId()), keep],
      )
    },

    async create(data) {
      try {
        const row = await insertRow(db, 'roles', { code: text(data.code), name: text(data.name), description: text(data.description), is_system: false })
        return toEntity(row)
      } catch (err) {
        if (isUniqueViolation(err, 'idx_roles_code')) throw appError('ROLE_CODE_IN_USE')
        throw err
      }
    },

    async update(id, patch) {
      const values = {}
      if (patch.name !== undefined) values.name = text(patch.name)
      if (patch.description !== undefined) values.description = text(patch.description)
      return toEntity(mustExist(await updateRow(db, 'roles', id, values), 'roles', id))
    },

    async delete(id) {
      await deleteRow(db, 'roles', id)
    },
  }
}

function createPermissionRepository(db) {
  return {
    async list() {
      const rows = await db.query('SELECT id, code, module FROM permissions ORDER BY "module" ASC, "code" ASC')
      return rows.map((row) => ({ id: row.id, code: row.code, module: row.module }))
    },
  }
}

function createSessionRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      ip: row.ip,
      userAgent: row.user_agent,
      remember: row.remember,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
      createdAt: row.created,
    }
  }

  return {
    async create(data) {
      const row = await insertRow(db, 'sessions', {
        user_id: data.userId,
        token_hash: text(data.tokenHash),
        ip: text(data.ip),
        user_agent: text(data.userAgent),
        remember: !!data.remember,
        expires_at: toDbDate(data.expiresAt),
        last_seen_at: toDbDate(data.lastSeenAt),
      })
      return toEntity(row)
    },

    async findById(id) {
      const row = await findRow(db, 'sessions', id)
      return row ? toEntity(row) : null
    },

    async findByTokenHash(hash) {
      const row = await db.one('SELECT * FROM sessions WHERE token_hash = $1', [text(hash)])
      return row ? toEntity(row) : null
    },

    async touch(id, lastSeenAt, expiresAt) {
      const row = await updateRow(db, 'sessions', id, { last_seen_at: toDbDate(lastSeenAt), expires_at: toDbDate(expiresAt) })
      return toEntity(mustExist(row, 'sessions', id))
    },

    /** Revogar de novo não muda a data da primeira revogação. */
    async revoke(id, at) {
      await db.exec('UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [id, toDbDate(at)])
    },

    /** Revoga as sessões ativas do usuário (exceto `exceptId`); retorna quantas foram revogadas. */
    async revokeAllForUser(userId, at, exceptId) {
      return db.exec('UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL AND id <> $3', [userId, toDbDate(at), exceptId || ''])
    },

    async listActiveForUser(userId, now) {
      const rows = await db.query(
        'SELECT * FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY last_seen_at DESC, id DESC LIMIT 50',
        [userId, toDbDate(now)],
      )
      return rows.map(toEntity)
    },
  }
}

const AUDIT_PURGE_BATCH = 1000

function createAuditRepository(db) {
  function toEntity(row) {
    return {
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      oldValue: row.old_value,
      newValue: row.new_value,
      userId: row.user_id || null,
      ip: row.ip,
      userAgent: row.user_agent,
      correlationId: row.correlation_id,
      createdAt: row.created,
    }
  }

  return {
    async list(query) {
      const f = query.filters || {}
      const params = []
      const where = []
      const equal = (column, value) => {
        if (!value) return
        params.push(value)
        where.push(`"${column}" = $${params.length}`)
      }
      equal('entity_type', f.entityType)
      equal('entity_id', f.entityId)
      equal('user_id', f.userId)
      equal('action', f.action)
      if (f.from) {
        params.push(toDbDate(f.from))
        where.push(`"created" >= $${params.length}`)
      }
      if (f.to) {
        params.push(toDbDate(f.to))
        where.push(`"created" <= $${params.length}`)
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const rows = await db.query(
        `SELECT * FROM audit_logs ${clause} ORDER BY "created" DESC, "id" DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        params.concat([query.pagination.perPage, query.pagination.offset]),
      )
      const count = await db.one(`SELECT count(*) AS total FROM audit_logs ${clause}`, params)
      return { items: rows.map(toEntity), total: count.total }
    },

    async record(entry) {
      await insertRow(db, 'audit_logs', {
        entity_type: text(entry.entityType),
        entity_id: text(entry.entityId),
        action: text(entry.action),
        old_value: toJson(entry.oldValue),
        new_value: toJson(entry.newValue),
        user_id: entry.userId || null,
        ip: text(entry.ip),
        user_agent: text(entry.userAgent),
        correlation_id: text(entry.correlationId),
      })
    },

    async countBefore(date) {
      return (await db.one('SELECT count(*) AS total FROM audit_logs WHERE created < $1', [toDbDate(date)])).total
    },

    /** Retenção (Configurador geral): apaga em lotes o que é anterior à data; o histórico não tem arquivos. */
    async purgeBefore(date) {
      const cutoff = toDbDate(date)
      let total = 0
      for (;;) {
        const removed = await db.exec(
          'DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created < $1 ORDER BY created LIMIT $2)',
          [cutoff, AUDIT_PURGE_BATCH],
        )
        total += removed
        if (removed < AUDIT_PURGE_BATCH) return total
      }
    },
  }
}

function createLoginAttemptRepository(db) {
  return {
    async record(key, at) {
      await insertRow(db, 'login_attempts', { key: text(key), attempted_at: toDbDate(at) })
    },

    /** Datas das falhas desde `since`. */
    async listSince(key, since) {
      const rows = await db.query(
        'SELECT attempted_at FROM login_attempts WHERE key = $1 AND attempted_at >= $2 ORDER BY attempted_at DESC LIMIT 200',
        [text(key), toDbDate(since)],
      )
      return rows.map((row) => row.attempted_at).filter(Boolean)
    },

    async clear(key) {
      await db.exec('DELETE FROM login_attempts WHERE key = $1', [text(key)])
    },

    /** Limpeza diária das tentativas antigas. */
    async purgeBefore(date) {
      return db.exec('DELETE FROM login_attempts WHERE attempted_at < $1', [toDbDate(date)])
    },
  }
}

module.exports = {
  createUserRepository,
  createRoleRepository,
  createPermissionRepository,
  createSessionRepository,
  createAuditRepository,
  createLoginAttemptRepository,
}
