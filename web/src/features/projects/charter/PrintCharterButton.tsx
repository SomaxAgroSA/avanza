import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'
import { formatDayValue, today } from '@/core/utils/calendar'
import type { ProjectCharter } from '@/domain/charter'
import type { Project } from '@/domain/projects'
import { AppButton } from '@/presentation/components'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { printDocument } from '../print-document'
import { renderCharterDocument } from './charter-document'

/** Imprime a ficha (ou salva em PDF pela impressão do navegador): documento A4 com rodapé e página. */
export function PrintCharterButton({ project, charter }: { project: Project; charter: ProjectCharter }) {
  const { t, i18n } = useTranslation()
  const platform = usePlatformInfo()

  function print() {
    printDocument(
      renderCharterDocument(charter, {
        t: (key, values) => i18n.t(key, values),
        locale: i18n.language,
        project: { key: project.key, name: project.name },
        platformName: platform.name,
        origin: window.location.origin,
        today: formatDayValue(today()),
      }),
    )
  }

  return (
    // na linha das abas, em tela estreita só o ícone
    <AppButton variant="secondary" leftIcon={<Printer />} aria-label={t('charter.print')} onClick={print}>
      <span className="hidden sm:inline">{t('charter.print')}</span>
    </AppButton>
  )
}
