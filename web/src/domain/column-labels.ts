/**
 * Nomes das colunas das tabelas (regras de negócio §44): cada pessoa pode dar outro nome a uma coluna
 * (guardado no navegador, com as colunas da tabela) e quem tem `platform.manage` pode definir o nome para
 * todos (Configurações da plataforma, um texto só para os três idiomas). Vale o da pessoa, depois o de
 * todos, depois o nome do sistema (traduzido).
 */

export const COLUMN_LABEL_MAX = 40

/** `{ coluna: nome }` de uma tabela. */
export type ColumnLabels = Record<string, string>
/** `{ tabela: { coluna: nome } }`. */
export type TableColumnLabels = Record<string, ColumnLabels>

/** Nome guardado para a coluna (só o próprio do mapa, nunca algo herdado como `constructor`). */
export function labelOf(labels: ColumnLabels | undefined, id: string): string | undefined {
  return labels && Object.prototype.hasOwnProperty.call(labels, id) ? labels[id] : undefined
}

export function resolveColumnLabel(id: string, builtIn: string, own: ColumnLabels | undefined, company: ColumnLabels | undefined): string {
  return labelOf(own, id) || labelOf(company, id) || builtIn
}

/** Mapa com o nome da coluna trocado; vazio (ou igual a `fallback`, o que valeria sem ele) tira o nome. */
export function withColumnLabel(labels: ColumnLabels, id: string, value: string, fallback: string): ColumnLabels {
  const name = value.trim().slice(0, COLUMN_LABEL_MAX).trim()
  const next = { ...labels }
  if (!name || name === fallback) delete next[id]
  else next[id] = name
  return next
}
