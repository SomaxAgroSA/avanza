import type { ChainedCommands } from '@tiptap/core'
import {
  AlertTriangle,
  AtSign,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Info,
  List,
  ListOrdered,
  ListTree,
  Minus,
  Paperclip,
  Pilcrow,
  Quote,
  Table,
  type LucideIcon,
} from 'lucide-react'

export type UploadKind = 'image' | 'document'

export interface BlockCommandContext {
  /** Abre o seletor de arquivos (imagem ou anexo) do editor. */
  requestUpload: (kind: UploadKind) => void
}

export interface BlockCommand {
  key: string
  icon: LucideIcon
  /** Termos extras para o filtro do "/" (sem acento, minúsculas), além do nome traduzido. */
  keywords: string
  run: (chain: ChainedCommands, context: BlockCommandContext) => void
}

/** Blocos que o "/" insere (o nome/descrição vêm de richText.blocks.<key>). */
export const BLOCK_COMMANDS: BlockCommand[] = [
  { key: 'paragraph', icon: Pilcrow, keywords: 'text texto paragrafo parrafo', run: (c) => void c.setParagraph().run() },
  { key: 'heading1', icon: Heading1, keywords: 'h1 titulo title', run: (c) => void c.setHeading({ level: 1 }).run() },
  { key: 'heading2', icon: Heading2, keywords: 'h2 titulo subtitle', run: (c) => void c.setHeading({ level: 2 }).run() },
  { key: 'heading3', icon: Heading3, keywords: 'h3 titulo', run: (c) => void c.setHeading({ level: 3 }).run() },
  { key: 'bulletList', icon: List, keywords: 'ul lista bullets vinetas', run: (c) => void c.toggleBulletList().run() },
  { key: 'orderedList', icon: ListOrdered, keywords: 'ol numerada numbered', run: (c) => void c.toggleOrderedList().run() },
  { key: 'taskList', icon: CheckSquare, keywords: 'todo checklist tarefas tareas', run: (c) => void c.toggleTaskList().run() },
  { key: 'quote', icon: Quote, keywords: 'citacao cita blockquote', run: (c) => void c.toggleBlockquote().run() },
  { key: 'codeBlock', icon: Code2, keywords: 'codigo code snippet', run: (c) => void c.toggleCodeBlock().run() },
  { key: 'calloutInfo', icon: Info, keywords: 'callout nota note destaque aviso info', run: (c) => void c.setCallout('info').run() },
  { key: 'calloutWarning', icon: AlertTriangle, keywords: 'callout atencao warning alerta cuidado', run: (c) => void c.setCallout('warning').run() },
  { key: 'table', icon: Table, keywords: 'tabela tabla grid', run: (c) => void c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { key: 'image', icon: ImagePlus, keywords: 'imagem imagen foto print screenshot', run: (c, ctx) => (c.run(), ctx.requestUpload('image')) },
  { key: 'file', icon: Paperclip, keywords: 'arquivo archivo anexo attachment pdf', run: (c, ctx) => (c.run(), ctx.requestUpload('document')) },
  { key: 'divider', icon: Minus, keywords: 'hr separador divisor linha', run: (c) => void c.setHorizontalRule().run() },
  { key: 'toc', icon: ListTree, keywords: 'sumario indice toc conteudo', run: (c) => void c.insertTableOfContents().run() },
]

/**
 * "Menção (@)" do "Inserir" nos textos das tarefas (§53): escreve o "@" (com espaço antes, se colado
 * numa palavra — `palavra@` não abre a lista) e a lista de pessoas abre ao lado.
 */
export const MENTION_COMMAND: BlockCommand = {
  key: 'mention',
  icon: AtSign,
  keywords: 'mencao mencion mention pessoa persona arroba',
  run: (c) =>
    void c
      .command(({ tr, state }) => {
        const before = state.selection.$from.nodeBefore
        const last = before?.isText ? (before.text ?? '').slice(-1) : ''
        tr.insertText(last && !/[\s(]/.test(last) ? ' @' : '@')
        return true
      })
      .run(),
}

/** O "Inserir" dos textos das tarefas: menção (quando há), bloco de código e separador. */
export function markdownInsertCommands(withMention: boolean): BlockCommand[] {
  const blocks = BLOCK_COMMANDS.filter((c) => c.key === 'codeBlock' || c.key === 'divider')
  return withMention ? [MENTION_COMMAND, ...blocks] : blocks
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Filtra pelo nome traduzido e pelos termos extras (sem acento/maiúsculas). */
export function filterBlockCommands(query: string, label: (key: string) => string): BlockCommand[] {
  const q = fold(query.trim())
  if (!q) return BLOCK_COMMANDS
  return BLOCK_COMMANDS.filter((command) => fold(`${label(command.key)} ${command.keywords}`).includes(q))
}
