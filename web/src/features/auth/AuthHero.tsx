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

      <div data-field-clear className="pointer-events-none relative flex items-center gap-3 self-start text-[21px] font-bold [text-shadow:0_1px_10px_var(--kb-brand-ink)]">
        <span className="grid size-[42px] shrink-0 place-items-center rounded-[11px] border border-on-cover/30 bg-[var(--kb-brand-ink)] shadow-[0_0_0_4px_var(--kb-brand-ink)]">
          <img src={logo} alt="" className="size-[26px] object-contain" />
        </span>
        <span className="truncate">{platform.name}</span>
      </div>

      <div className="pointer-events-none relative mt-8 lg:my-auto">
        <h2 data-field-clear className="max-w-[600px] font-display text-[clamp(28px,3.6vw,52px)] font-extrabold leading-[1.12] tracking-[-0.025em] [text-shadow:0_2px_18px_var(--kb-brand-ink)]">
          {t('auth.heroTitle')}
        </h2>
        <p data-field-clear className="mt-4 hidden max-w-[640px] text-[19px] text-on-cover [text-shadow:0_1px_12px_var(--kb-brand-ink)] lg:block">{t('auth.heroSubtitle')}</p>
        <ul className="mt-10 hidden max-w-[880px] grid-cols-3 gap-6 lg:grid">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key} data-field-clear className="grid content-start gap-1.5 text-[15.5px] leading-[1.45] [text-shadow:0_1px_10px_var(--kb-brand-ink)]">
              <span className="mb-2.5 grid size-11 place-items-center rounded-[11px] border border-on-cover/30 bg-[var(--kb-brand-ink)]">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="font-bold">{t(`auth.hero.features.${key}.title`)}</span>
              <span className="text-on-cover/90">{t(`auth.hero.features.${key}.description`)}</span>
            </li>
          ))}
        </ul>
      </div>

      <p data-field-clear className="pointer-events-none relative hidden self-start text-[15px] text-on-cover/80 lg:block">
        {t('auth.footer', { year: new Date().getFullYear(), name: platform.name })}
      </p>
    </aside>
  )
}
