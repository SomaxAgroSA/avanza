import type { ReactNode } from 'react'
import { PreferencesQuickBar } from '@/features/preferences/PreferencesQuickBar'
import { AuthHero } from './AuthHero'

/** Moldura das telas sem sessão (login, esqueci minha senha, nova senha): capa da marca + conteúdo. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[52%_1fr]">
      <AuthHero />

      <main className="flex flex-col px-4 py-6 sm:px-9">
        <div className="flex justify-end">
          <PreferencesQuickBar />
        </div>
        <div className="m-auto w-full max-w-[432px] py-8">
          <h1 className="text-[29px] font-bold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  )
}
