/**
 * Atualizações do elemento do quadro (Gerenciamento de Projetos, GP-3): conversa com respostas
 * (um nível), @menções e imagens/arquivos colados ou anexados na própria atualização, no painel
 * lateral do elemento.
 *
 * - Quem vê o quadro e o projeto não está arquivado publica e responde (inclusive o leitor — como
 *   nos comentários das tarefas).
 * - O autor edita a sua; o autor ou o gestor do projeto exclui (exclusão lógica: fica "removida").
 * - Resposta só na atualização principal (não há resposta de resposta).
 * - Texto obrigatório, salvo quando a atualização leva imagem/arquivo (dá para publicar só o print).
 */

const MAX_CONTENT = 10000
const MAX_MENTIONS = 20
const MAX_FILES = 10
/** Total de uma vez (cada arquivo tem o limite próprio dos anexos). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** `withFiles`: a atualização leva imagem/arquivo, então o texto pode ficar vazio. */
function contentIssue(content, withFiles) {
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) return withFiles ? null : 'required'
  return text.length > MAX_CONTENT ? 'too_long' : null
}

/** Arquivos enviados junto (`[{ size }]`): até 10 e 50 MB no total. */
function uploadIssue(list) {
  if (list.length > MAX_FILES) return 'too_many'
  const total = list.reduce((sum, f) => sum + (f.size || 0), 0)
  return total > MAX_UPLOAD_BYTES ? 'upload_too_large' : null
}

/** `can` = { comment: pode publicar no quadro, manager: gestor do projeto }. */
function capabilities(can, update, userId) {
  const open = !!can.comment && !update.deletedAt
  const author = update.authorId === userId
  return { edit: open && author, delete: open && (author || !!can.manager), reply: open && !update.parentId }
}

const time = (u) => (u.createdAt ? new Date(u.createdAt).getTime() : 0)

/** Principais da mais nova para a mais antiga, cada uma com as respostas em ordem de chegada. */
function threads(list) {
  const tops = list.filter((u) => !u.parentId).sort((a, b) => time(b) - time(a))
  const ids = {}
  tops.forEach((t) => {
    ids[t.id] = true
  })
  return tops.map((top) =>
    Object.assign({}, top, {
      replies: list.filter((r) => r.parentId === top.id && ids[r.parentId]).sort((a, b) => time(a) - time(b)),
    }),
  )
}

/** Contador da linha: atualizações e respostas não excluídas, por elemento. */
function countByItem(list) {
  const out = {}
  list.forEach((u) => {
    if (u.deletedAt) return
    out[u.itemId] = (out[u.itemId] || 0) + 1
  })
  return out
}

module.exports = { MAX_CONTENT, MAX_MENTIONS, MAX_FILES, MAX_UPLOAD_BYTES, contentIssue, uploadIssue, capabilities, threads, countByItem }
