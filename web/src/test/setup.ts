import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@/core/i18n'

// Com a suíte inteira em paralelo, 1 s (padrão) é pouco para telas que carregam dados falsos + Radix.
configure({ asyncUtilTimeout: 4000 })

afterEach(() => {
  cleanup()
})

// jsdom não implementa matchMedia/ResizeObserver/scrollIntoView, usados por Radix e pelo tema.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

// jsdom não desenha em <canvas> (avisaria "not implemented"): sem contexto, os desenhos decorativos não rodam
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}

// ProseMirror (editor da documentação) mede a seleção; o jsdom não tem layout.
const emptyRect = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect
const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= emptyRect
Range.prototype.getClientRects ??= emptyRects
document.elementFromPoint ??= () => null
