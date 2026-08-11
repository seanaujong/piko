/**
 * Renders the Chrome Web Store's own icon tile — separate from what ships in `manifest.json`.
 *
 * The dashboard drops the icon into its own rounded frame, so `public/icons/icon128.png` (which
 * already runs edge to edge, for the toolbar) reads as doubly-rounded and cramped there. This
 * instead rasterizes the same SVG at 96px, through the same `rasterizeSvg` the shipped icons and
 * the contact sheet use, and composes it onto a transparent 128px canvas with 16px of padding a
 * side — the size and margin the dashboard's own tile spec asks for.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rasterizeSvg, screenshot } from './rasterize.mjs'

const OUT_DIR = 'store-assets'
const OUT = `${OUT_DIR}/store-icon-128.png`
const ART = 96
const CANVAS = 128
const PAD = (CANVAS - ART) / 2

const svg = readFileSync('public/icons/icon.svg', 'utf8')
const staging = mkdtempSync(join(tmpdir(), 'piko-store-icon-'))
try {
  const inner = join(staging, 'inner.png')
  rasterizeSvg(svg, ART, inner)
  const dataUri = `data:image/png;base64,${readFileSync(inner).toString('base64')}`

  mkdirSync(OUT_DIR, { recursive: true })
  screenshot(
    `<!doctype html><meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; width:${CANVAS}px; height:${CANVAS}px; }
  img { display:block; position:absolute; left:${PAD}px; top:${PAD}px; width:${ART}px; height:${ART}px; }
</style>
<img src="${dataUri}">`,
    OUT,
    CANVAS,
    CANVAS,
  )
} finally {
  rmSync(staging, { recursive: true, force: true })
}

console.log(`${OUT}  (${ART}px art, ${PAD}px padding a side)`)
