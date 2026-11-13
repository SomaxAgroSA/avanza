/** Endereços da documentação na aplicação. */
export const spacePath = (spaceKey: string) => `/docs/${encodeURIComponent(spaceKey)}`
export const pagePath = (spaceKey: string, pageId: string) => `${spacePath(spaceKey)}/${encodeURIComponent(pageId)}`
export const editPath = (spaceKey: string, pageId: string) => `${pagePath(spaceKey, pageId)}/edit`
/** Tarefa vinculada a uma página. */
export const taskPath = (taskId: string) => `/tasks/${encodeURIComponent(taskId)}`
