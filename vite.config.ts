import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
  resolve: { preserveSymlinks: true },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})
