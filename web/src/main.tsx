import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/index.css'
import { i18nReady } from '@/core/i18n'
import { App } from '@/app/App'
import { reloadForNewVersion } from '@/app/chunk-reload'

// arquivos pré-carregados de uma versão anterior (publicação com a aba aberta): recarrega uma vez
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewVersion()) event.preventDefault()
})

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root não encontrado')

// espera o idioma inicial (en/es são carregados sob demanda) para não piscar texto em outro idioma
void i18nReady.finally(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
