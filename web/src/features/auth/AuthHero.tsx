import { useTranslation } from 'react-i18next'
import { ChartGantt, KanbanSquare, RefreshCw, type LucideIcon } from 'lucide-react'
import { logoFor } from '@/domain/platform'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { GrowingField } from './GrowingField'

const FEATURES: { key: 'kanban' | 'plan' | 'live'; icon: LucideIcon }[] = [
  { key: 'kanban', icon: KanbanSquare },
  { key: 'plan', icon: ChartGantt },
  { key: 'live', icon: RefreshCw },
]

/**
 * Capa das telas sem sessão (Modelo G da referência, "Campo que responde · oscuro"): marca, proposta, o que
 * o produto faz e o rodapé sobre o verde quase preto da marca, com o campo de brotos que cresce onde o cursor
 * passa (GrowingField). No celular fica compacta (marca e título) para o formulário aparecer logo abaixo.
 */
export function AuthHero() {
  const { t } = useTranslation()
  const platform = usePlatformInfo()
  // a capa tem fundo da marca (escuro): usa a versão escura do logo
  const logo = logoFor(platform, 'dark')

  return (
    <aside className="relative flex flex-col overflow-hidden bg-[var(--kb-brand-ink)] px-5 py-7 text-on-cover lg:px-10 lg:py-10">
      <GrowingField />

      <div className="pointer-events-none relative flex items-center gap-3 text-[21px] font-bold">
        <span className="grid size-[42px] shrink-0 place-items-center rounded-[11px] border border-on-cover/20 bg-on-cover/10">
          <img src={logo} alt="" className="size-[26px] object-contain" />
        </span>
        <span className="truncate">{platform.name}</span>
      </div>

      <div className="pointer-events-none relative mt-8 lg:my-auto">
        <h2 className="max-w-[600px] font-display text-[clamp(28px,3.6vw,52px)] font-extrabold leading-[1.12] tracking-[-0.025em]">
          {t('auth.heroTitle')}
        </h2>
        <p className="mt-4 hidden text-[19px] text-on-cover/90 lg:block">{t('auth.heroSubtitle')}</p>
        <ul className="mt-10 hidden max-w-[880px] grid-cols-3 gap-6 lg:grid">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key} className="grid content-start gap-1.5 text-[15.5px] leading-[1.45]">
              <span className="mb-2.5 grid size-11 place-items-center rounded-[11px] border border-on-cover/20 bg-on-cover/15">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="font-bold">{t(`auth.hero.features.${key}.title`)}</span>
              <span className="text-on-cover/85">{t(`auth.hero.features.${key}.description`)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="pointer-events-none relative hidden text-[15px] text-on-cover/75 lg:block">
        {t('auth.footer', { year: new Date().getFullYear(), name: platform.name })}
      </p>
    </aside>
  )
}
