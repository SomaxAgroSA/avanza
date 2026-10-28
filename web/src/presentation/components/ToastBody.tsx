import type { ToastContentProps } from 'react-toastify'

export interface ToastBodyData {
  title: string
  description?: string | undefined
  undo?: { label: string; onClick: () => void } | undefined
}

/** Conteúdo padrão dos toasts: título, descrição opcional e ação "Desfazer". */
export function ToastBody({ data, closeToast }: ToastContentProps<ToastBodyData>) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <p className="text-sm font-medium leading-snug">{data.title}</p>
      {data.description && <p className="text-xs leading-snug opacity-75">{data.description}</p>}
      {data.undo && (
        <button
          type="button"
          onClick={() => {
            data.undo?.onClick()
            closeToast()
          }}
          className="mt-1 self-start rounded text-xs font-semibold text-primary-text underline-offset-2 hover:underline"
        >
          {data.undo.label}
        </button>
      )}
    </div>
  )
}
