import { useEffect, useRef, useState } from 'react'

/** Respiro abaixo do conteúdo (o py-6 da área principal). */
const BOTTOM_GAP = 24

/**
 * Altura que sobra na área principal (`<main>`) abaixo do elemento — para telas como o Kanban ocuparem
 * só a tela visível e rolarem por dentro, em vez de esticar a página. Recalcula quando a janela muda de
 * tamanho ou o que vem antes muda de altura (ex.: a barra de filtros quebra em duas linhas).
 * Sem `<main>` medido (testes), devolve `undefined`: o elemento fica com a altura natural.
 */
export function useFillHeight<T extends HTMLElement>(minPx = 320) {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)

  useEffect(() => {
    const element = ref.current
    const main = element?.closest('main')
    if (!element || !main) return
    const measure = () => {
      if (main.clientHeight === 0) return setHeight(undefined)
      // posição dentro do conteúdo do main (independe de quanto a página já rolou)
      const top = element.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
      setHeight(Math.max(minPx, Math.floor(main.clientHeight - top - BOTTOM_GAP)))
    }
    // o observador avisa logo ao começar a observar e a cada mudança de tamanho
    const observer = new ResizeObserver(measure)
    observer.observe(main)
    if (element.parentElement) observer.observe(element.parentElement)
    return () => observer.disconnect()
  }, [minPx])

  return [ref, height] as const
}
