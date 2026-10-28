/**
 * Apoio dos repositórios SQL: ids no formato do PocketBase, INSERT/UPDATE a partir de objetos e
 * conversões. Nomes de tabela e coluna vêm sempre do código (nunca da requisição) e passam por
 * `ident`, que recusa qualquer coisa fora de [a-z0-9_].
 */

const crypto = require('node:crypto')

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ID_LENGTH = 15
const IDENT = /^[a-z_][a-z0-9_]*$/

/** Id aleatório de 15 caracteres [a-z0-9] (o mesmo formato dos registros vindos do PocketBase). */
function newId() {
  const bytes = crypto.randomBytes(ID_LENGTH)
  let id = ''
  for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
  return id
}

/** Identificador entre aspas (tabela/coluna escritas no código). */
function ident(name) {
  if (!IDENT.test(name)) throw new Error(`Identificador SQL inválido: ${name}`)
  return `"${name}"`
}

/** Direção de ordenação validada. */
function direction(value) {
  return String(value).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
}

/**
 * ORDER BY de uma lista `[{ column, direction }]` (colunas da whitelist da aplicação) + desempate por id.
 * Vazios primeiro na ordem crescente, como no PocketBase (que guardava data vazia como '').
 */
function orderBy(sort, tiebreak) {
  const parts = (sort || []).map((s) => {
    const dir = direction(s.direction)
    return `${ident(s.column)} ${dir} NULLS ${dir === 'ASC' ? 'FIRST' : 'LAST'}`
  })
  if (tiebreak !== false) parts.push('"id" ASC')
  return parts.length ? `ORDER BY ${parts.join(', ')}` : ''
}

/** Padrão para ILIKE com o texto escapado (como o $dbx.like do PocketBase: contém, sem curingas). */
function likePattern(text) {
  return `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Valor de data para gravar: Date, texto ISO ou vazio (NULL). */
function toDbDate(value) {
  if (value === undefined || value === null || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return isNaN(date.getTime()) ? null : date
}

/**
 * Data no texto que o PocketBase devolvia ao ler um campo de data como string
 * ("2026-10-28 13:45:00.123Z"); '' quando vazia. Só para manter entidades que já usavam esse formato.
 */
function pbDateText(value) {
  const date = toDbDate(value)
  return date ? date.toISOString().replace('T', ' ') : ''
}

/** JSON para colunas jsonb (o driver grava objetos como JSON, mas arrays viram array do Postgres). */
function toJson(value) {
  return value === undefined ? null : JSON.stringify(value)
}

/** Insere `values` ({ coluna: valor }) e devolve a linha gravada; gera o id se não vier. */
async function insertRow(db, table, values) {
  const row = Object.assign({ id: newId() }, values)
  const columns = Object.keys(row)
  const sql = `INSERT INTO ${ident(table)} (${columns.map(ident).join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`
  return db.one(sql, columns.map((c) => row[c]))
}

/** Atualiza as colunas de `values` e devolve a linha (null se o id não existe). */
async function updateRow(db, table, id, values) {
  const columns = Object.keys(values)
  if (columns.length === 0) return findRow(db, table, id)
  const sets = columns.map((c, i) => `${ident(c)} = $${i + 1}`).join(', ')
  return db.one(`UPDATE ${ident(table)} SET ${sets} WHERE "id" = $${columns.length + 1} RETURNING *`, columns.map((c) => values[c]).concat([id]))
}

async function findRow(db, table, id) {
  if (!id) return null
  return db.one(`SELECT * FROM ${ident(table)} WHERE "id" = $1`, [id])
}

async function findRows(db, table, ids) {
  const list = (ids || []).filter(Boolean)
  if (list.length === 0) return []
  return db.query(`SELECT * FROM ${ident(table)} WHERE "id" = ANY($1::text[])`, [list])
}

async function deleteRow(db, table, id) {
  return db.exec(`DELETE FROM ${ident(table)} WHERE "id" = $1`, [id])
}

module.exports = { newId, ident, direction, orderBy, likePattern, toDbDate, pbDateText, toJson, insertRow, updateRow, findRow, findRows, deleteRow }
