/**
 * Conteúdo rico (documentação). Ponto de importação separado de `@/presentation/components`
 * para o editor (TipTap/ProseMirror) só carregar nas telas que o usam.
 */
export { AppRichTextEditor, type AppRichTextEditorProps, type RichTextUpload } from './AppRichTextEditor'
export { AppRichTextView, type AppRichTextViewProps } from './AppRichTextView'
export { scrollToHeading } from './headings'
export { AppMarkdownEditor, type AppMarkdownEditorProps } from './AppMarkdownEditor'
