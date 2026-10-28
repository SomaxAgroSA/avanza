/**
 * Repositório PocketBase do Configurador geral: registro único `platform_settings` (valores alterados
 * e arquivos de identidade). Se o registro sumir, é recriado vazio (vale o padrão do domínio).
 */

const { appError } = require('../core/errors')
const { toDate } = require('./pb-helpers')

const COLLECTION = 'platform_settings'

function parseJson(record, field) {
  const raw = record.getString(field)
  if (!raw || raw === 'null') return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : {}
  } catch (_) {
    return {}
  }
}

function createPlatformSettingsRepository(app) {
  function current() {
    const found = app.findRecordsByFilter(COLLECTION, '', 'created', 1, 0)
    if (found.length > 0) return found[0]
    const record = new Record(app.findCollectionByNameOrId(COLLECTION))
    record.set('values', {})
    record.set('files', {})
    app.save(record)
    return record
  }

  return {
    get() {
      const record = current()
      return { values: parseJson(record, 'values'), files: parseJson(record, 'files'), updatedAt: toDate(record.getDateTime('updated')) }
    },
    saveValues(values) {
      const record = current()
      record.set('values', values)
      app.save(record)
    },
    /** `data.handle` é o arquivo enviado; o PocketBase revalida tipo e tamanho ao salvar. */
    setFile(slot, data) {
      const record = current()
      const files = parseJson(record, 'files')
      files[slot] = { name: data.name, mime: data.mime, size: data.size }
      record.set(slot, data.handle)
      record.set('files', files)
      try {
        app.save(record)
      } catch (_err) {
        throw appError('VALIDATION_ERROR', undefined, { fields: { file: 'invalid_file' } })
      }
    },
    clearFile(slot) {
      const record = current()
      const files = parseJson(record, 'files')
      delete files[slot]
      record.set(slot, null)
      record.set('files', files)
      app.save(record)
    },
    fileKeyOf(slot) {
      const record = current()
      return `${record.baseFilesPath()}/${record.getString(slot)}`
    },
  }
}

module.exports = { createPlatformSettingsRepository }
