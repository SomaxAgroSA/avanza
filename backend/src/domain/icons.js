/**
 * Ícones (regras de negócio §25): cada lugar tem os seus ícones padrão (PROJECT_ICONS, TASK_TYPE_ICONS,
 * SPACE_ICONS) e também aceita os da biblioteca da plataforma — ícones da galeria Lucide importados em
 * Configurações → Ícones. O nome é o do Lucide, em minúsculas com hífens ("file-spreadsheet").
 */

const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ICON_NAME_MAX = 64
/** Quantos ícones por importação. */
const MAX_IMPORT = 60

function iconNameIssue(name) {
  if (typeof name !== 'string' || !name) return 'required'
  if (name.length > ICON_NAME_MAX || !ICON_NAME.test(name)) return 'invalid_format'
  return null
}

/**
 * Regra para `assertValid`: ícone padrão do lugar ou um nome com o formato da galeria. Se o nome está na
 * biblioteca, o caso de uso confere depois (application/icon-library.js#assertIconAvailable).
 */
function iconRule(builtins) {
  return (value) => (typeof value === 'string' && (builtins.indexOf(value) >= 0 || !iconNameIssue(value)) ? { value } : { error: 'invalid_option' })
}

module.exports = { ICON_NAME_MAX, MAX_IMPORT, iconNameIssue, iconRule }
