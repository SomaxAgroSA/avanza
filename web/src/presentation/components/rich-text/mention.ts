/**
 * Menções no editor dos textos das tarefas (§53): o nó `mention` (gravado como `@[Nome](id)` pelo
 * `domain/markdown-doc.ts`) e a lista de pessoas do "@". A lista abre **ao lado do @, na linha em que
 * se escreve** (à direita do que já foi digitado e acompanhando; se não cabe, à esquerda do @), filtra
 * por nome ou sobrenome sem acentos; ↑↓ movem, Enter/Tab escolhem, Esc fecha. `palavra@` não abre
 * (e-mails): o "@" precisa estar no começo, depois de espaço ou de "(".
 */
import { Extension, mergeAttributes, Node, type Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { exitSuggestion, type SuggestionProps } from '@tiptap/suggestion'
import type { MentionPerson } from '@/domain/tasks'
import { MentionList, type MentionListHandle, type MentionListProps } from './MentionList'

export const MentionNode = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (element) => element.getAttribute('data-id'), renderHTML: (attributes) => ({ 'data-id': attributes.id }) },
      label: { default: null, parseHTML: (element) => element.getAttribute('data-label'), renderHTML: (attributes) => ({ 'data-label': attributes.label }) },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-mention]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-mention': '' }, HTMLAttributes), `@${String(node.attrs.label ?? '')}`]
  },
  renderText({ node }) {
    return `@${String(node.attrs.label ?? '')}`
  },
})

const MAX_RESULTS = 8
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Pessoas para o que se digitou depois do "@": quem tem um nome que começa assim vem antes. */
export function matchMentionPeople(people: MentionPerson[], query: string): MentionPerson[] {
  const q = fold(query.trim())
  if (!q) return people.slice(0, MAX_RESULTS)
  const startsWord = (person: MentionPerson) => fold(person.name).split(/\s+/).some((word) => word.startsWith(q))
  return people
    .filter((person) => fold(person.name).includes(q))
    .sort((a, b) => Number(!startsWord(a)) - Number(!startsWord(b)))
    .slice(0, MAX_RESULTS)
}

declare module '@tiptap/core' {
  interface Storage {
    /** Quem pode ser mencionado agora (a tela atualiza; lido a cada tecla — a lista pode chegar depois). */
    mentionSuggestion: { people: MentionPerson[] }
  }
}

/** A tela informa quem pode ser mencionado (a lista pode chegar depois de o editor abrir). */
export function setMentionPeople(editor: Editor, people: MentionPerson[]) {
  if (!editor.isDestroyed && editor.storage.mentionSuggestion) editor.storage.mentionSuggestion.people = people
}

const mentionKey = new PluginKey('mentionSuggestion')
const MENU_WIDTH = 256
const MENU_HEIGHT = 256
const GAP = 6

/** Ao lado do que se digita: à direita do texto (na mesma linha); sem espaço, à esquerda do "@". */
export function placeBeside(element: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return
  const width = element.offsetWidth || MENU_WIDTH
  const height = element.offsetHeight || MENU_HEIGHT
  let left = rect.right + GAP
  if (left + width > window.innerWidth - 8) left = rect.left - width - GAP
  left = Math.max(8, left)
  let top = rect.top - 4
  if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8)
  Object.assign(element.style, { position: 'fixed', zIndex: '60', top: `${top}px`, left: `${left}px`, pointerEvents: 'auto' })
}

export const MentionSuggestion = Extension.create({
  name: 'mentionSuggestion',
  addStorage() {
    return { people: [] as MentionPerson[] }
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<MentionPerson, MentionPerson>({
        editor: this.editor,
        pluginKey: mentionKey,
        char: '@',
        allowedPrefixes: [' ', '(', '\u00a0'],
        // nada de lista dentro de código
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          return $from.parent.type.name !== 'codeBlock' && !$from.marks().some((mark) => mark.type.name === 'code')
        },
        items: ({ query, editor }) => matchMentionPeople(editor.storage.mentionSuggestion.people, query),
        command: ({ editor, range, props }) =>
          void editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'mention', attrs: { id: props.id, label: props.name } },
              { type: 'text', text: ' ' },
            ])
            .run(),
        render: () => {
          let renderer: ReactRenderer<MentionListHandle, MentionListProps> | null = null
          let escape: ((event: KeyboardEvent) => void) | null = null
          const close = () => {
            if (escape) window.removeEventListener('keydown', escape, true)
            escape = null
            renderer?.element.remove()
            renderer?.destroy()
            renderer = null
          }
          const show = (props: SuggestionProps<MentionPerson, MentionPerson>) => {
            if (!renderer) return
            const element = renderer.element as HTMLElement
            element.hidden = props.items.length === 0
            placeBeside(element, props.clientRect?.())
          }
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(MentionList, { props: { items: props.items, command: props.command, editor: props.editor }, editor: props.editor })
              const element = renderer.element as HTMLElement
              // dentro de uma janela (Radix), o clique na lista não pode contar como "clique fora"
              element.addEventListener('pointerdown', (event) => event.stopPropagation())
              document.body.appendChild(element)
              // Esc fecha só a lista (antes de a janela ou a gaveta em volta ouvirem a tecla)
              escape = (event) => {
                if (event.key !== 'Escape' || !renderer || element.hidden) return
                event.preventDefault()
                event.stopPropagation()
                exitSuggestion(props.editor.view, mentionKey)
                close()
              }
              window.addEventListener('keydown', escape, true)
              show(props)
            },
            onUpdate: (props) => {
              renderer?.updateProps({ items: props.items, command: props.command, editor: props.editor })
              show(props)
            },
            onKeyDown: ({ event }) => {
              if (!renderer || (renderer.element as HTMLElement).hidden) return false
              return renderer.ref?.onKeyDown(event) ?? false
            },
            onExit: close,
          }
        },
      }),
    ]
  },
})
