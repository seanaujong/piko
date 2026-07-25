/**
 * Rasterizes public/icons/icon.svg into the PNG sizes the manifest declares.
 *
 * The SVG is the source of truth; the PNGs are build inputs that esbuild.config.mjs copies
 * into dist/. `rasterize.mjs` owns how a PNG gets made, so that `icon-sheet.mjs` judges the
 * same output this writes.
 */
import { readFileSync } from 'node:fs'
import { SIZES, rasterizeSvg } from './rasterize.mjs'

const svg = readFileSync('public/icons/icon.svg', 'utf8')

for (const size of SIZES) {
  rasterizeSvg(svg, size, `public/icons/icon${size}.png`)
  console.log(`rendered icon${size}.png`)
}
