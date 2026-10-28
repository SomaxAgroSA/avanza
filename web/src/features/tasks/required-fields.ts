import { isAppError } from '@/core/errors/app-error'

/** Campos que faltam para a tarefa ficar no status (erro do servidor só com "obrigatório"); null = outro erro. */
export function missingForStatus(error: unknown): { status: { id: string; name: string } | null; fieldNames: string[] } | null {
  if (!isAppError(error) || error.code !== 'VALIDATION_ERROR') return null
  const fields = error.fieldErrors()
  const keys = Object.keys(fields)
  const names = keys.filter((key) => key.startsWith('custom_values.') && fields[key] === 'required').map((key) => key.slice('custom_values.'.length))
  if (names.length === 0 || names.length !== keys.length) return null
  const status = error.details.status as { id: string; name: string } | null | undefined
  return { status: status ?? null, fieldNames: names }
}

/** Projetos visíveis como opções dos campos do tipo "projeto" (e do seletor de projeto da tarefa). */
export const PROJECT_OPTIONS_QUERY = { view: 'all' as const, page: 1, perPage: 100, sort: { id: 'name', direction: 'asc' as const }, search: '', filters: {} }
