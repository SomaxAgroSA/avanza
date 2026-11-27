import { lazy, Suspense } from 'react'
import type { AppMarkdownEditorProps } from './rich-text/AppMarkdownEditor'
import { AppFormField } from './AppFormField'

// o editor (TipTap/ProseMirror) só carrega quando um campo aparece na tela
const Editor = lazy(() => import('./rich-text/AppMarkdownEditor').then((module) => ({ default: module.AppMarkdownEditor })))

export type AppMarkdownFieldProps = AppMarkdownEditorProps

/**
 * Campo de texto com formatação dos comentários e descrições das tarefas (§53): a barra do editor da
 * Documentação, gravando Markdown. Carrega o editor sob demanda (o mesmo pacote das telas /docs).
 */
export function AppMarkdownField(props: AppMarkdownFieldProps) {
  return (
    <Suspense
      fallback={
        <AppFormField label={props.label} hint={props.hint} error={props.error} required={props.required} className={props.className}>
          {() => <div aria-busy="true" className="min-h-[172px] rounded-md border border-border bg-surface shadow-xs" />}
        </AppFormField>
      }
    >
      <Editor {...props} />
    </Suspense>
  )
}
