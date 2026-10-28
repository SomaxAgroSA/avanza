import type { UserSummary } from './projects'

/**
 * Ícones (regras de negócio §25): cada lugar tem os seus ícones padrão e aceita também os da biblioteca
 * da plataforma — ícones da galeria Lucide importados em Configurações → Ícones. O nome é o do Lucide
 * ("file-spreadsheet").
 */

export const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Quantos ícones por importação (o mesmo limite do servidor). */
export const MAX_ICON_IMPORT = 60

export interface IconUsage {
  projects: number
  taskTypes: number
  docSpaces: number
}

export interface LibraryIcon {
  name: string
  createdAt: Date | null
  createdBy: UserSummary | null
  usage: IconUsage
}

export function isIconName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && ICON_NAME.test(value)
}

/** Ícone vindo da API: padrão do lugar, um nome da galeria ou o padrão. */
export function toIcon<T extends string>(builtins: readonly T[], value: string | null | undefined, fallback: T): T | (string & {}) {
  if (value && (builtins as readonly string[]).includes(value)) return value as T
  return isIconName(value) ? value : fallback
}

/** Rótulo de um ícone da galeria (os nomes do Lucide são em inglês): "file-spreadsheet" → "file spreadsheet". */
export function iconLabel(name: string): string {
  return name.replace(/-/g, ' ')
}

export function usageTotal(usage: IconUsage): number {
  return usage.projects + usage.taskTypes + usage.docSpaces
}
