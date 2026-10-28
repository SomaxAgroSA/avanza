/**
 * Infraestrutura do e-mail: configurações do SMTP (nas configurações do próprio PocketBase — smtp +
 * meta), fila de saída, links de uso único e o envio (mailer do PocketBase).
 */

const { toDate, toPbDate, findOrNull } = require('./pb-helpers')

function createEmailSettingsRepository(app) {
  return {
    get() {
      const settings = app.settings()
      return {
        values: {
          enabled: !!settings.smtp.enabled,
          host: settings.smtp.host || '',
          port: settings.smtp.port || 587,
          username: settings.smtp.username || '',
          tls: !!settings.smtp.tls,
          sender_name: settings.meta.senderName || '',
          sender_address: settings.meta.senderAddress || '',
          app_url: settings.meta.appURL || '',
        },
        hasPassword: !!settings.smtp.password,
      }
    },
    /** `password` undefined mantém a atual. */
    save(values, password) {
      const settings = app.settings()
      settings.smtp.enabled = values.enabled
      settings.smtp.host = values.host
      settings.smtp.port = values.port
      settings.smtp.username = values.username
      settings.smtp.tls = values.tls
      if (password !== undefined) settings.smtp.password = password
      settings.meta.senderName = values.sender_name
      settings.meta.senderAddress = values.sender_address
      settings.meta.appURL = values.app_url
      app.save(settings)
    },
  }
}

function createEmailOutboxRepository(app) {
  const COLLECTION = 'email_outbox'
  const toEntity = (record) => ({
    id: record.id,
    to: record.getString('to'),
    kind: record.getString('kind'),
    subject: record.getString('subject'),
    html: record.getString('html'),
    text: record.getString('text'),
    status: record.getString('status'),
    attempts: record.getInt('attempts'),
    lastError: record.getString('last_error'),
    nextAttemptAt: toDate(record.getDateTime('next_attempt_at')),
    sentAt: toDate(record.getDateTime('sent_at')),
    createdAt: toDate(record.getDateTime('created')),
  })
  const FIELDS = { status: 'status', attempts: 'attempts', lastError: 'last_error', html: 'html', text: 'text' }
  const DATES = { nextAttemptAt: 'next_attempt_at', sentAt: 'sent_at' }
  return {
    enqueue(entry) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('to', entry.to)
      record.set('kind', entry.kind)
      record.set('subject', String(entry.subject || '').slice(0, 300))
      record.set('html', entry.html || '')
      record.set('text', entry.text || '')
      record.set('status', 'pending')
      record.set('attempts', 0)
      app.save(record)
      return toEntity(record)
    },
    listDue(now, limit) {
      return app
        .findRecordsByFilter(COLLECTION, "status = 'pending' && (next_attempt_at = '' || next_attempt_at <= {:now})", 'created', limit, 0, { now: toPbDate(now) })
        .map(toEntity)
    },
    update(id, patch) {
      const record = app.findRecordById(COLLECTION, id)
      Object.keys(patch).forEach((key) => {
        if (FIELDS[key]) record.set(FIELDS[key], patch[key])
        else if (DATES[key]) record.set(DATES[key], toPbDate(patch[key]))
      })
      app.save(record)
      return toEntity(record)
    },
    counts() {
      const count = (status) => app.countRecords(COLLECTION, $dbx.hashExp({ status }))
      return { pending: count('pending'), sent: count('sent'), failed: count('failed') }
    },
    listRecent(limit) {
      return app.findRecordsByFilter(COLLECTION, '', '-created', limit, 0).map(toEntity)
    },
  }
}

function createAuthTokenRepository(app) {
  const COLLECTION = 'auth_tokens'
  const toEntity = (record) => ({
    id: record.id,
    userId: record.getString('user_id'),
    purpose: record.getString('purpose'),
    expiresAt: toDate(record.getDateTime('expires_at')),
    usedAt: toDate(record.getDateTime('used_at')),
    createdAt: toDate(record.getDateTime('created')),
  })
  return {
    create(data) {
      const record = new Record(app.findCollectionByNameOrId(COLLECTION))
      record.set('user_id', data.userId)
      record.set('purpose', data.purpose)
      record.set('token_hash', data.tokenHash)
      record.set('expires_at', toPbDate(data.expiresAt))
      app.save(record)
      return toEntity(record)
    },
    findByHash(hash) {
      const record = findOrNull(() => app.findFirstRecordByFilter(COLLECTION, 'token_hash = {:h}', { h: hash }))
      return record ? toEntity(record) : null
    },
    markUsed(id, at) {
      const record = app.findRecordById(COLLECTION, id)
      record.set('used_at', toPbDate(at))
      app.save(record)
    },
    invalidateForUser(userId, purpose, at) {
      app.findRecordsByFilter(COLLECTION, "user_id = {:u} && purpose = {:p} && used_at = ''", '', 0, 0, { u: userId, p: purpose }).forEach((record) => {
        record.set('used_at', toPbDate(at))
        app.save(record)
      })
    },
    countSince(userId, purpose, since) {
      return app.countRecords(COLLECTION, $dbx.hashExp({ user_id: userId, purpose }), $dbx.exp('created >= {:s}', { s: toPbDate(since) }))
    },
  }
}

/** Envio pelo mailer do PocketBase (usa as configurações de SMTP do momento). */
function createMailer(app) {
  return {
    send(message) {
      const mail = new MailerMessage({
        from: { address: message.fromAddress, name: message.fromName || '' },
        to: [{ address: message.to }],
        subject: message.subject,
        html: message.html,
        text: message.text,
      })
      app.newMailClient().send(mail)
    },
  }
}

function createEmailRepositories(app) {
  return {
    emailSettingsRepository: createEmailSettingsRepository(app),
    emailOutboxRepository: createEmailOutboxRepository(app),
    authTokenRepository: createAuthTokenRepository(app),
  }
}

module.exports = { createEmailRepositories, createMailer }
