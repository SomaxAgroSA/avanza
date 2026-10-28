/** Texto para comparar e buscar: sem acentos, maiúsculas e espaços repetidos ("  Crítica  Alta" → "critica alta"). */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase()
}
