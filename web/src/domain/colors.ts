/**
 * Cor livre (regras de negócio §24): além da paleta de cada lugar, aceita "#rrggbb". A interface usa o
 * TOM da cor livre (matiz e saturação em OKLCH) e controla a luminosidade, para o texto continuar legível
 * no tema claro e no escuro — como faz com as cores da paleta.
 */

export type HexColor = `#${string}`

const HEX = /^#[0-9a-f]{6}$/i

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === 'string' && HEX.test(value)
}

/** Cor vinda da API: da paleta, hex (em minúsculas) ou o padrão. */
export function toColor<T extends string>(palette: readonly T[], value: string | null | undefined, fallback: T): T | HexColor {
  if (value && (palette as readonly string[]).includes(value)) return value as T
  return isHexColor(value) ? (value.toLowerCase() as HexColor) : fallback
}

/** Hex digitado (com ou sem "#", 3 ou 6 dígitos) → "#rrggbb", ou null. */
export function parseHexInput(text: string): HexColor | null {
  let hex = text.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(hex)) hex = hex.replace(/./g, (c) => c + c)
  return /^[0-9a-f]{6}$/.test(hex) ? (`#${hex}` as HexColor) : null
}

/** OKLCH de um "#rrggbb": l (0–1), c (croma, ~0–0.37) e h (matiz, 0–360). */
export function hexToOklch(hex: HexColor): { l: number; c: number; h: number } {
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const r = channel(1)
  const g = channel(3)
  const b = channel(5)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return { l: L, c: Math.sqrt(A * A + B * B), h: h < 0 ? h + 360 : h }
}

/**
 * Tom usado nas fórmulas de cor: matiz e croma da cor livre, com o croma limitado (cores quase neutras
 * viram cinza; cores muito saturadas não estouram no tema escuro).
 */
export function hexTone(hex: HexColor): { hue: number; chroma: number } {
  const { c, h } = hexToOklch(hex)
  if (c < 0.03) return { hue: h, chroma: 0.02 }
  return { hue: Math.round(h), chroma: Math.min(c, 0.2) }
}
