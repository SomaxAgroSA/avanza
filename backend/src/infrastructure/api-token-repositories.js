/** Repositório PocketBase dos tokens de API pessoais (só o hash do token é guardado). */

const { toDate, toPbDate, findOrNull } = require('./pb-helpers')

function createApiTokenRepository(app) {
  const COLLECTION = 'api_tokens'
  const toEntity = (record) => ({
    id: record.id,
    userId: record.getString('user_id'),
    name: record.getString('name'),
    tokenHash: record.getString('token_hash'),
    prefix: record.getString('prefix'),
    expiresAt: toDate(record.getDateTime('expires_at')),
    lastUsedAt: toDate(record.getDateTime('last_used_at')),
    lastUsedIp: record.getString('last_used_ip'),
    revokedAt: toDate(record.getDateTime('revoked_at')),
    createdAt: toDate(record.getDateTime('created')),
  })
  return {
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('user_id', data.userId)
      record.set('name', data.name)
      record.set('token_hash', data.tokenHash)
      record.set('prefix', data.prefix)
      record.set('expires_at', toPbDate(data.expiresAt))
      app.save(record)
      return toEntity(record)
    },
    findById(id) {
      const record = findOrNull(() => app.findRecordById(COLLECTION, id))
      return record ? toEntity(record) : null
    },
    findByHash(hash) {
      const record = findOrNull(() => app.findFirstRecordByFilter(COLLECTION, 'token_hash = {:h}', { h: hash }))
      return record ? toEntity(record) : null
    },
    listByUser(userId) {
      return app.findRecordsByFilter(COLLECTION, 'user_id = {:u}', '-created', 0, 0, { u: userId }).map(toEntity)
    },
    listAll() {
      return app.findRecordsByFilter(COLLECTION, '', '-created', 500, 0).map(toEntity)
    },
    countActiveByUser(userId, now) {
      return app.countRecords(
        COLLECTION,
        $dbx.hashExp({ user_id: userId }),
        $dbx.exp("revoked_at = '' AND (expires_at = '' OR expires_at > {:now})", { now: toPbDate(now) }),
      )
    },
    touch(id, at, ip) {
      const record = app.findRecordById(COLLECTION, id)
      record.set('last_used_at', toPbDate(at))
      record.set('last_used_ip', String(ip || '').slice(0, 64))
      app.save(record)
      return toEntity(record)
    },
    revoke(id, at) {
      const record = app.findRecordById(COLLECTION, id)
      record.set('revoked_at', toPbDate(at))
      app.save(record)
      return toEntity(record)
    },
  }
}

module.exports = { createApiTokenRepository }
