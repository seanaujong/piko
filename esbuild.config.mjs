import * as esbuild from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'

await esbuild.build({
  entryPoints: {
    content: 'src/content/index.ts',
    background: 'src/background/index.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome115',
  sourcemap: true,
  jsx: 'automatic',
  jsxImportSource: 'preact',
})

mkdirSync('dist/icons', { recursive: true })
cpSync('manifest.json', 'dist/manifest.json')
cpSync('public/icons', 'dist/icons', { recursive: true })
