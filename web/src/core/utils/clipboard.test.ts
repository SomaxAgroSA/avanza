import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

/** O jsdom não implementa execCommand: o teste define o resultado e guarda o que estava selecionado. */
function stubExecCommand(result: boolean) {
  const copied: string[] = []
  const exec = vi.fn((command: string) => {
    if (command === 'copy') {
      const active = document.activeElement
      copied.push(active instanceof HTMLTextAreaElement ? active.value.slice(active.selectionStart, active.selectionEnd) : '')
    }
    return result
  })
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
  return { exec, copied }
}

function setClipboard(value: unknown, secure: boolean) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true })
}

afterEach(() => {
  setClipboard(undefined, false)
  document.body.innerHTML = ''
})

describe('copyText', () => {
  it('em HTTPS usa a área de transferência do navegador', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    setClipboard({ writeText }, true)
    const { exec } = stubExecCommand(true)
    expect(await copyText('kb_pat_abc')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('kb_pat_abc')
    expect(exec).not.toHaveBeenCalled()
  })

  it('em http (servidor da rede local, sem a API) copia pelo método antigo e não deixa rastro na página', async () => {
    setClipboard(undefined, false)
    const { copied } = stubExecCommand(true)
    expect(await copyText('kb_pat_abc')).toBe(true)
    expect(copied).toEqual(['kb_pat_abc'])
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('se a API recusar (permissão), tenta o método antigo', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('NotAllowedError')) }, true)
    const { copied } = stubExecCommand(true)
    expect(await copyText('segredo')).toBe(true)
    expect(copied).toEqual(['segredo'])
  })

  it.each(['dialog', 'menu'])('dentro de um %s, o campo temporário fica nele (a trava de foco não desfaz a seleção) e o foco volta', async (role) => {
    setClipboard(undefined, false)
    document.body.innerHTML = `<div role="${role}"><button id="copiar">Copiar</button></div>`
    const button = document.getElementById('copiar') as HTMLButtonElement
    button.focus()
    let parent: Element | null = null
    const exec = vi.fn(() => {
      parent = document.activeElement?.parentElement ?? null
      return true
    })
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    expect(await copyText('kb_pat_abc')).toBe(true)
    expect(parent).toBe(document.querySelector(`[role="${role}"]`))
    expect(document.activeElement).toBe(button)
  })

  it('devolve false quando nada funciona', async () => {
    setClipboard(undefined, false)
    stubExecCommand(false)
    expect(await copyText('x')).toBe(false)
  })
})
