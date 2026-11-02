/**
 * Peças comuns dos documentos impressos do projeto (Informe e Ficha): HTML autocontido, pensado para A4,
 * que vira PDF pela impressão do navegador. As cores desses documentos são do papel (fundo branco em
 * qualquer tema), não tokens da interface.
 */
import figtreeLatin from '@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url'
import figtreeLatinExt from '@fontsource-variable/figtree/files/figtree-latin-ext-wght-normal.woff2?url'
import jakartaLatin from '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2?url'
import jakartaLatinExt from '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-wght-normal.woff2?url'

export type Translate = (key: string, options?: Record<string, unknown>) => string

/** Texto seguro dentro do HTML (conteúdo e atributos). */
export const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Texto dentro de `content: "…"` do CSS (sem < nem >: não fecha o <style>). */
export const cssString = (value: string) =>
  `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3c ')
    .replace(/>/g, '\\3e ')
    .replace(/\n/g, ' ')}"`

/** Texto livre em parágrafos (linha em branco separa; quebra simples vira <br>). */
export const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

/**
 * Fontes do documento: 'Figtree Variable' (texto) e 'Jakarta' (títulos), as mesmas da interface. O
 * documento não tem endereço próprio (srcdoc), então os arquivos vão com a origem da aplicação.
 */
export function printFontFaces(origin: string): string {
  const font = (path: string) => new URL(path, origin).href
  return `
@font-face{font-family:'Figtree Variable';src:url('${font(figtreeLatin)}') format('woff2');font-weight:300 900}
@font-face{font-family:'Figtree Variable';src:url('${font(figtreeLatinExt)}') format('woff2');font-weight:300 900;unicode-range:U+0100-02AF}
@font-face{font-family:'Jakarta';src:url('${font(jakartaLatin)}') format('woff2');font-weight:200 800}
@font-face{font-family:'Jakarta';src:url('${font(jakartaLatinExt)}') format('woff2');font-weight:200 800;unicode-range:U+0100-02AF}`
}

/**
 * Imprime um documento (ou salva em PDF pela janela de impressão): monta num iframe escondido, espera
 * as fontes e abre a impressão; o iframe sai quando a janela de impressão fecha.
 */
export function printDocument(html: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
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
