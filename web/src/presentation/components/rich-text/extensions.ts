import type { AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { isSafeDocHref } from '@/domain/docs'
import { safeTaskHref } from '@/domain/markdown-doc'
import { MentionNode, MentionSuggestion } from './mention'
import { Callout, DocImage, TableOfContents } from './nodes'
import { SlashCommand, type SlashCommandOptions } from './slash-menu'

export interface RichTextExtensionOptions {
  /** Só na edição: texto de ajuda da linha vazia e o menu "/". */
  editing?: { placeholder: string; slash: SlashCommandOptions }
}

/** Blocos e marcas comuns aos dois editores (Documentação e textos das tarefas). */
function commonExtensions(isAllowedUri: (url: string) => boolean): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        isAllowedUri,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),
    Highlight,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    DocImage,
  ]
}

/**
 * Mesmo conjunto de blocos na edição e na leitura (a página aparece igual nos dois modos).
 * Só existe o que o servidor aceita — o resto ele removeria ao salvar.
 */
export function richTextExtensions({ editing }: RichTextExtensionOptions = {}): AnyExtension[] {
  const base: AnyExtension[] = [...commonExtensions((url) => isSafeDocHref(url)), Callout, TableOfContents]
  if (!editing) return base
  return [...base, Placeholder.configure({ placeholder: editing.placeholder }), SlashCommand.configure(editing.slash)]
}

export interface MarkdownExtensionOptions {
  placeholder: string
  /** "@" abre a lista de menções (as pessoas vêm de `setMentionPeople`). Sem: menções já gravadas continuam, mas não se cria nova. */
  mention?: boolean
}

/**
 * Editor dos comentários e descrições das tarefas (§53): só o que o Markdown das tarefas guarda
 * (`domain/markdown-doc.ts`) — sem destaque (callout), sumário e menu "/"; links só http(s).
 */
export function markdownExtensions({ placeholder, mention }: MarkdownExtensionOptions): AnyExtension[] {
  const list: AnyExtension[] = [...commonExtensions((url) => !!safeTaskHref(url)), MentionNode, Placeholder.configure({ placeholder })]
  if (mention) list.push(MentionSuggestion)
  return list
}
