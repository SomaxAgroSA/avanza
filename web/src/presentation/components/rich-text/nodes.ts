/**
 * Nós próprios do editor rico: destaque (callout), sumário e imagem com largura.
 * Os nomes e atributos espelham o que o servidor aceita (backend/src/domain/doc-content.js).
 */
import { mergeAttributes, Node } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { IMAGE_WIDTHS, type CalloutTone } from '@/domain/docs'
import { toneOf } from './callout-icons'
import { CalloutView, TableOfContentsView } from './node-views'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Envolve os blocos selecionados num destaque (ou troca o tom, se já estiver dentro de um). */
      setCallout: (tone?: CalloutTone) => ReturnType
      unsetCallout: () => ReturnType
    }
    tableOfContents: {
      insertTableOfContents: () => ReturnType
    }
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      tone: {
        default: 'info',
        parseHTML: (element) => toneOf(element.getAttribute('data-callout')),
        renderHTML: (attributes) => ({ 'data-callout': toneOf(attributes.tone) }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },
  addCommands() {
    return {
      setCallout:
        (tone = 'info') =>
        ({ editor, commands }) =>
          editor.isActive('callout') ? commands.updateAttributes('callout', { tone }) : commands.wrapIn('callout', { tone }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift('callout'),
    }
  },
})

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  parseHTML() {
    return [{ tag: 'div[data-toc]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsView)
  },
  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    }
  },
})

/** Imagem com largura em % (25/50/75/100); sem altura fixa, sem base64 (só arquivos enviados). */
export const DocImage = Image.extend({
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: {
        default: null,
        parseHTML: (element) => {
          const value = Number(element.getAttribute('data-width'))
          return IMAGE_WIDTHS.includes(value as (typeof IMAGE_WIDTHS)[number]) ? value : null
        },
        renderHTML: (attributes) => (attributes.width ? { 'data-width': attributes.width, style: `width: ${attributes.width}%` } : {}),
      },
    }
  },
}).configure({ inline: false, allowBase64: false })
