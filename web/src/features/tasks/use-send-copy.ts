import { useTranslation } from 'react-i18next'
import { notify } from '@/presentation/components'
import { useTaskMutations } from './queries'

/**
 * "Com cópia" na edição (ajuste 24/11/2026): depois de salvar a tarefa, manda o aviso dela aos endereços e diz
 * na tela para quem foi. `after` roda quando o servidor respondeu — também com o envio de e-mails desligado
 * (nada sai e a tela avisa); `onError` recebe o erro (endereço inválido volta no próprio campo).
 */
export function useSendCopy(): {
  send: (task: { id: string; code: string }, emails: string[], after: () => void, onError: (error: unknown) => void) => void
  pending: boolean
} {
  const { t } = useTranslation()
  const { sendCopy } = useTaskMutations()
  return {
    pending: sendCopy.isPending,
    send: (task, emails, after, onError) =>
      sendCopy.mutate(
        { id: task.id, emails },
        {
          onSuccess: (sent) => {
            if (sent.length > 0) notify.success(t('tasks.copy.sent', { code: task.code, emails: sent.join(', ') }))
            else notify.warning(t('tasks.copy.notSent'))
            after()
          },
          onError,
        },
      ),
  }
}
