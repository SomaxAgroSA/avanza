import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'
import type { ProjectCharter } from '@/domain/charter'
import type { Project } from '@/domain/projects'
import { AppButton } from '@/presentation/components'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { renderCharterDocument } from './charter-document'

const todayIso = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * Imprime a ficha (ou salva em PDF pela impressão do navegador): monta o documento A4 num iframe
 * escondido, espera as fontes e abre a impressão; o iframe sai quando a janela de impressão fecha.
 */
export function PrintCharterButton({ project, charter }: { project: Project; charter: ProjectCharter }) {
  const { t, i18n } = useTranslation()
  const platform = usePlatformInfo()

  function print() {
    const html = renderCharterDocument(charter, {
      t: (key, values) => i18n.t(key, values),
      locale: i18n.language,
      project: { key: project.key, name: project.name },
      platformName: platform.name,
      origin: window.location.origin,
      today: todayIso(),
    })
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    frame.onload = () => {
      const win = frame.contentWindow
      if (!win) return frame.remove()
      win.addEventListener('afterprint', () => frame.remove())
      void win.document.fonts.ready.then(() => win.print())
    }
    frame.srcdoc = html
    document.body.appendChild(frame)
  }

  return (
    <AppButton variant="secondary" leftIcon={<Printer />} onClick={print}>
      {t('charter.print')}
    </AppButton>
  )
}
