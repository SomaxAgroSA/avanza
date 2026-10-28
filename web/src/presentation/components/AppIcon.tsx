import { lazy, Suspense } from 'react'
import type { LucideIcon, LucideProps } from 'lucide-react'
import type { IconName } from 'lucide-react/dynamic'

// a galeria inteira (~1.700 ícones) só carrega quando um ícone importado aparece, e cada ícone vem sozinho
const DynamicIcon = lazy(() => import('lucide-react/dynamic').then((m) => ({ default: m.DynamicIcon })))

export interface AppIconProps extends Omit<LucideProps, 'ref'> {
  /** Nome do ícone: um dos padrões do lugar (`builtins`) ou um da biblioteca (nome do Lucide). */
  name: string
  builtins: Partial<Record<string, LucideIcon>>
  /** Enquanto carrega, e para nome desconhecido. */
  fallback: LucideIcon
}

/** Ícone de projeto, tipo de tarefa ou espaço: o padrão do lugar ou o importado da galeria (regras §25). */
export function AppIcon({ name, builtins, fallback: Fallback, ...props }: AppIconProps) {
  const Builtin = builtins[name]
  if (Builtin) return <Builtin {...props} />
  const placeholder = () => <Fallback {...props} />
  return (
    <Suspense fallback={<Fallback {...props} />}>
      <DynamicIcon name={name as IconName} fallback={placeholder} {...props} />
    </Suspense>
  )
}
