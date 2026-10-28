import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlatformInfo } from '@/presentation/common/use-platform'
import { PreferencesQuickBar } from '@/features/preferences/PreferencesQuickBar'
import { AuthHero } from './AuthHero'

/** Símbolo Avanza (cinco barras de progresso), usado enquanto ninguém envia outro logo no Configurador geral. */
const AVANZA_SYMBOL = { light: '/brand/avanza/avanza-simbolo-claro.svg', dark: '/brand/avanza/avanza-simbolo-oscuro.svg' }

/** Marca de água da capa: só as barras do símbolo, em branco. */
function Watermark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      className="pointer-events-none absolute -bottom-10 -right-16 w-[340px] fill-on-cover opacity-[0.07]"
    >
      <rect x="22" y="8" width="72" height="12" rx="6" />
      <rect x="63" y="26" width="31" height="12" rx="6" />
      <rect x="16" y="44" width="78" height="12" rx="6" />
      <rect x="35" y="62" width="59" height="12" rx="6" />
      <rect x="41" y="80" width="53" height="12" rx="6" />
    </svg>
  )
}

/** Moldura das telas sem sessão (login, esqueci minha senha, nova senha): capa da marca + conteúdo. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { t } = useTranslation()
  const platform = usePlatformInfo()
  // a capa tem fundo verde-escuro: usa a versão escura do logo enviado ou o símbolo Avanza
  const heroLogo = platform.logoDarkUrl ?? platform.logoLightUrl ?? AVANZA_SYMBOL.dark

  return (
    <div className="kb-avanza grid min-h-dvh lg:grid-cols-[52%_1fr]">
      <aside className="relative hidden overflow-hidden bg-login-gradient px-10 py-10 text-on-cover lg:flex lg:flex-col lg:justify-between lg:gap-8 xl:px-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgb(255_255_255/0.13)_1px,transparent_1.5px)] [background-size:26px_26px]"
        />
        <Watermark />
        <div className="relative flex items-center gap-3">
          <span className="flex size-[42px] items-center justify-center rounded-[11px] border border-on-cover/20 bg-on-cover/10">
            <img src={heroLogo} alt="" className="size-[26px] object-contain" />
          </span>
          <span className="text-[21px] font-bold tracking-tight">{platform.name}</span>
        </div>
        <AuthHero />
        <p className="relative text-[15px] text-on-cover-muted">
          © {new Date().getFullYear()} {platform.name}
        </p>
      </aside>

      <main className="relative flex flex-col items-center justify-center px-4 py-10 sm:px-9">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-subtle-gradient lg:hidden" />
        <div className="absolute right-4 top-4 sm:right-9 sm:top-6">
          <PreferencesQuickBar />
        </div>
        <div className="relative w-full max-w-[432px]">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2.5">
              <span className="flex size-[34px] items-center justify-center rounded-[9px] border border-border bg-surface">
                {platform.logoLightUrl ? (
                  <img src={platform.logoLightUrl} alt="" className="size-5 object-contain" />
                ) : (
                  <>
                    <img src={AVANZA_SYMBOL.light} alt="" className="size-5 dark:hidden" />
                    <img src={AVANZA_SYMBOL.dark} alt="" className="hidden size-5 dark:block" />
                  </>
                )}
              </span>
              <span className="truncate text-[17px] font-bold tracking-tight text-fg">{platform.name}</span>
            </div>
            <p className="mt-3 text-sm text-muted">{t('auth.heroTitle')}</p>
          </div>
          <h1 className="text-[29px] font-bold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  )
}
