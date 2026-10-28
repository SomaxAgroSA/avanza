/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.KAMBAN_API_TARGET ?? 'http://127.0.0.1:8090'
// versão mostrada na tela (rodapé do menu): a do package.json, no build; VITE_APP_VERSION sobrescreve
const APP_VERSION = process.env.VITE_APP_VERSION || (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Falha se a porta estiver ocupada (evita subir silenciosamente em outra porta).
    strictPort: true,
    // Mesma origem no navegador: o cookie de sessão (SameSite=Strict, Path=/api/) funciona via proxy.
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
  },
  build: {
    // O build de produção é servido pela própria API (backend/public).
    outDir: '../backend/public',
    emptyOutDir: true,
    sourcemap: false,
    // Fontes sempre como arquivo: a CSP (font-src 'self') bloqueia as pequenas que viriam embutidas em data:.
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
    rolldownOptions: {
      output: {
        // Vendors em chunks estáveis: mudam pouco e ficam em cache entre deploys.
        codeSplitting: {
          groups: [
            // Ids de módulo chegam normalizados com "/" em todas as plataformas.
            { name: 'vendor-react', test: /node_modules\/(react|react-dom|scheduler|react-router)\//, priority: 30 },
            // Os ícones do Lucide ficam fora dos grupos: cada um vai junto de quem usa, e os da galeria
            // (biblioteca de ícones, carregados por nome) viram arquivos próprios, baixados só quando aparecem.
            { name: 'vendor-ui', test: /node_modules\/(@radix-ui|radix-ui|@floating-ui|cmdk|react-toastify|@dnd-kit|lucide-react\/(?!dynamic|dist\/esm\/(icons\/|dynamic|DynamicIcon)))/, priority: 20 },
            { name: 'vendor-forms', test: /node_modules\/(zod|react-hook-form|@hookform)\//, priority: 20 },
            { name: 'vendor-table', test: /node_modules\/@tanstack\/(react-table|table-core|react-store|store)\//, priority: 20 },
            // Editor da documentação: só carrega nas telas /docs. Prioridade mínima: os grupos puxam as
            // dependências junto, e as compartilhadas (floating-ui, use-sync-external-store…) devem ficar
            // nos grupos do carregamento inicial, não aqui.
            { name: 'vendor', test: /node_modules\/(?!@tiptap\/|prosemirror-|linkifyjs\/|orderedmap\/|rope-sequence\/|w3c-keyname\/|lucide-react\/(dynamic|dist\/esm\/(icons\/|dynamic|DynamicIcon)))/, priority: 10 },
            { name: 'vendor-editor', test: /node_modules\/(@tiptap|prosemirror-[a-z-]+|linkifyjs|orderedmap|rope-sequence|w3c-keyname)\//, priority: 5 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    // testes de interface digitam e abrem menus; com a suíte inteira em paralelo, 5 s é pouco
    testTimeout: 15000,
  },
})
