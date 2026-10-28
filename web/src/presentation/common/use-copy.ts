import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { copyText } from '@/core/utils/clipboard'
import { notify } from '@/presentation/components'

/**
 * Copiar com aviso: "Copiado…" ou, quando o navegador não deixa (ex.: bloqueio da área de
 * transferência), como copiar à mão. Funciona também no servidor da rede local sem HTTPS.
 */
export function useCopy() {
  const { t } = useTranslation()
  return useCallback(
    async (text: string) => {
      if (await copyText(text)) notify.success(t('common.copied'))
      else notify.error(t('common.copyFailed'))
    },
    [t],
  )
}
