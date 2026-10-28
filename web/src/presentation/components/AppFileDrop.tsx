import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { UploadCloud } from 'lucide-react'
import { cn } from '@/core/utils/cn'

export interface AppFileDropProps {
  onFiles: (files: File[]) => void
  /** Atributo `accept` (ex.: ".png,.jpg"). */
  accept?: string
  multiple?: boolean
  disabled?: boolean
  /** Texto de apoio (tipos e tamanho aceitos). */
  hint?: ReactNode
  className?: string
}

/**
 * Área de envio de arquivos: arrastar e soltar ou escolher pelo botão (teclado e leitores de tela).
 * O seletor nativo fica oculto; toda a interface segue o tema do app.
 */
export function AppFileDrop({ onFiles, accept, multiple = true, disabled, hint, className }: AppFileDropProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function take(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (files.length > 0 && !disabled) onFiles(multiple ? files : files.slice(0, 1))
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setOver(false)
    take(event.dataTransfer.files)
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
        over ? 'border-primary bg-primary-soft' : 'border-border bg-surface-2/40',
        disabled && 'opacity-60',
        className,
      )}
    >
      <UploadCloud className={cn('size-7', over ? 'text-primary-text' : 'text-subtle')} aria-hidden />
      <p className="text-sm text-fg">
        {t('files.dropHere')}{' '}
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="rounded font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed"
        >
          {t('files.choose')}
        </button>
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      <input
        ref={input}
        id={inputId}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          take(event.target.files)
          // permite escolher o mesmo arquivo de novo
          event.target.value = ''
        }}
      />
    </div>
  )
}
