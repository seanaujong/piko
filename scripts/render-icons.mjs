/**
 * Rasterizes public/icons/icon.svg into the PNG sizes the manifest declares.
 *
 * The SVG is the source of truth; the PNGs are build inputs that esbuild.config.mjs
 * copies into dist/. Chrome does the rasterizing because it is the renderer the icons
 * are actually viewed in, and it needs no toolchain beyond the browser already required
 * to load the extension.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SIZES = [16, 32, 48, 128]

const svg = readFileSync('public/icons/icon.svg', 'utf8')
const staging = mkdtempSync(join(tmpdir(), 'piko-icons-'))

for (const size of SIZES) {
  // A page sized exactly to the icon, with every default margin stripped, so the
  // screenshot viewport and the artwork are the same box.
  const page = `<!doctype html><meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; width:${size}px; height:${size}px; }
  svg { display:block; width:${size}px; height:${size}px; }
</style>
${svg}`

  const htmlPath = join(staging, `icon${size}.html`)
  writeFileSync(htmlPath, page)

  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${size},${size}`,
    `--screenshot=public/icons/icon${size}.png`,
    `file://${htmlPath}`,
  ], { stdio: 'ignore' })

  console.log(`rendered icon${size}.png`)
}

rmSync(staging, { recursive: true, force: true })
