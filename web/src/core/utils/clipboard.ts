/**
 * Copia texto para a área de transferência e diz se conseguiu.
 *
 * A API moderna (`navigator.clipboard`) só existe em contexto seguro — HTTPS ou localhost. No servidor
 * da rede local (`http://avanza.local`, `http://192.168…`) ela não existe, então a cópia cai no método
 * antigo do navegador: um campo temporário selecionado + `execCommand('copy')`, que funciona em http
 * porque roda dentro do clique.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // permissão negada ou documento sem foco: tenta o método antigo
    }
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // dentro de um pop-up ou menu, o campo fica nele: a trava de foco devolveria o foco e desfaria a seleção
  const host = previous?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') ?? document.body
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  area.style.pointerEvents = 'none'
  host.appendChild(area)
  area.focus()
  area.select()
  area.setSelectionRange(0, text.length)
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  previous?.focus()
  return copied
}
