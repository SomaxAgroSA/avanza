/**
 * Cores (regras de negócio §24): cada lugar tem a sua paleta de nomes (ex.: OPTION_COLORS) e aceita também
 * uma cor livre "#rrggbb". A interface usa o tom da cor livre e ajusta a luminosidade ao tema (texto
 * legível no claro e no escuro), como faz com as cores da paleta.
 */

const CUSTOM_COLOR = /^#[0-9a-f]{6}$/

/** Cor aceita normalizada (hex em minúsculas) ou null. */
function normalizeColor(value, palette) {
  if (typeof value !== 'string') return null
  if (palette.indexOf(value) >= 0) return value
  const hex = value.trim().toLowerCase()
  return CUSTOM_COLOR.test(hex) ? hex : null
}

function isColor(value, palette) {
  return normalizeColor(value, palette) !== null
}

/** Regra para `assertValid` (core/validation): a cor normalizada ou `invalid_option`. */
function colorRule(palette) {
  return (value) => {
    const color = normalizeColor(value, palette)
    return color === null ? { error: 'invalid_option' } : { value: color }
  }
}

module.exports = { CUSTOM_COLOR, normalizeColor, isColor, colorRule }
