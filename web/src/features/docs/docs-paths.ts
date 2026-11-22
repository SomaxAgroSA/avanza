import { printSearch, type ExportOptions, type ExportOrigin } from '@/domain/doc-export'

/** Endereços da documentação na aplicação. */
export const spacePath = (spaceKey: string) => `/docs/${encodeURIComponent(spaceKey)}`
export const pagePath = (spaceKey: string, pageId: string) => `${spacePath(spaceKey)}/${encodeURIComponent(pageId)}`
export const editPath = (spaceKey: string, pageId: string) => `${pagePath(spaceKey, pageId)}/edit`
/** Vista de impressão da documentação (exportar PDF, §43): fora do menu e da barra do app. */
export const printPath = (origin: ExportOrigin, options: ExportOptions) => `/print/docs?${printSearch(origin, options)}`
/** Tarefa vinculada a uma página. */
export const taskPath = (taskId: string) => `/tasks/${encodeURIComponent(taskId)}`
