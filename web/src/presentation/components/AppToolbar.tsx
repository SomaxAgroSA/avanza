import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/core/utils/cn'

export interface AppToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

/**
 * Linha de ferramentas (regra da coordenação, 22/11/2026, para todos os módulos): se adapta à largura,
 * mas **nunca quebra em outra linha nem muda as coisas de lugar**. A linha mede a si mesma
 * (`@container`) e os itens se compactam em etapas, pela largura dela:
 *
 * - sempre: a busca é a primeira a encolher (até ~110px) e os seletores param em ~132px;
 * - < 1250px: grupos de botões com nome (Prioridade, Urgência) viram seletores ("Prioridade: todas");
 * - < 1150px: "Colunas e ações" fica só com o ícone (o nome segue no aria-label e na dica);
 * - < 1060px: os botões de criar encurtam o texto ("＋ Tarefa"; o nome inteiro no aria-label);
 * - < 960px: os números dos controles segmentados somem.
 *
 * A linha só rola na horizontal quando, mesmo compactada, não cabe (celular, abaixo de ~780px). As
 * classes de cada etapa ficam nos próprios componentes (`@max-[1250px]:…`), escritas por extenso para o
 * Tailwind encontrá-las.
 */
export function AppToolbar({ children, className, ...rest }: AppToolbarProps) {
  return (
    <div className="@container min-w-0">
      <div
        {...rest}
        data-toolbar=""
        // o respiro em volta (compensado pela margem) evita cortar o contorno do foco quando a linha rola
        className={cn('-m-1 flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap p-1 [scrollbar-width:thin]', className)}
      >
        {children}
      </div>
    </div>
  )
}
