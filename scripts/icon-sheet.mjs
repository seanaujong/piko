/**
 * Builds the contact sheet an icon edit is judged on: every declared size, magnified with
 * hard pixel edges, on both a light and a dark toolbar grey.
 *
 *   npm run icons:sheet                    the icons that currently ship
 *   npm run icons:sheet -- a.svg b.svg     candidates, side by side
 *
 * Judging an icon on the 128 alone is how every icon bug in this project has gotten in, and
 * each one was invisible until a small size was looked at directly:
 *
 *   - A contrasting wingtip marking detaches into a floating speck, because out there the
 *     wing is only a couple of pixels across.
 *   - Two wing arcs without a downward wedge between them read as a mountain range.
 *   - A closed bright disc under a symmetrical dark mark reads as a face — wings for
 *     eyebrows, bands for a mouth.
 *   - A shape grazing another by a pixel is neither in front of it nor clear of it, so the
 *     two fuse into one object.
 *
 * The magnified images are real rasterizer output scaled up with nearest-neighbour, never
 * the vector redrawn larger. That distinction is the whole point: re-rendering the SVG at
 * 128 and calling it the 16 hides exactly the collapse this exists to expose. The true-size
 * cluster is there because magnification flatters — the actual size is what ships.
 *
 * The sheet prints; it asserts nothing. "Does this read as a gull" is not a predicate, so
 * this stays out of the gate and stays a thing a human looks at.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { SIZES, screenshot, rasterizeSvg } from './rasterize.mjs'

const OUT = 'icon-sheet.png'

/**
 * Magnifications, chosen to be whole numbers no larger than the 128 itself. Whole numbers
 * because a fractional scale gives nearest-neighbour uneven pixels, which would read as a
 * flaw in the artwork rather than in the sheet; no larger than 128 so every image fits the
 * row and none of them spills over the strip that is supposed to contain it.
 */
const ZOOM = { 16: 8, 32: 4, 48: 2, 128: 1 }

const dataUri = (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`

const staging = mkdtempSync(join(tmpdir(), 'piko-sheet-'))
const args = process.argv.slice(2)

let subjects
if (args.length === 0) {
  subjects = [{
    name: 'shipped — public/icons',
    rasters: Object.fromEntries(SIZES.map((s) => [s, dataUri(`public/icons/icon${s}.png`)])),
  }]
} else {
  subjects = args.map((path) => {
    if (!path.endsWith('.svg')) throw new Error(`expected an .svg candidate, got ${path}`)
    const svg = readFileSync(path, 'utf8')
    const name = basename(path, '.svg')
    const rasters = {}
    for (const size of SIZES) {
      const png = join(staging, `${name}-${size}.png`)
      rasterizeSvg(svg, size, png)
      rasters[size] = dataUri(png)
    }
    console.log(`rendered ${name}`)
    return { name, rasters }
  })
}

const strip = (subject, tone) => `
  <div class="strip ${tone}">
    ${SIZES.map((s) => `
      <figure>
        <img src="${subject.rasters[s]}" style="width:${s * ZOOM[s]}px;height:${s * ZOOM[s]}px">
        <figcaption>${s}px${ZOOM[s] > 1 ? ` @${ZOOM[s]}×` : ''}</figcaption>
      </figure>`).join('')}
    <figure>
      <div class="true">
        ${SIZES.filter((s) => s < 128).map((s) =>
          `<img src="${subject.rasters[s]}" style="width:${s}px;height:${s}px">`).join('')}
      </div>
      <figcaption>true size</figcaption>
    </figure>
  </div>`

// Chrome screenshots the viewport, not the document, so the page has to be sized to its
// content up front. The strip and section boxes below are pinned rather than left to grow
// from what is inside them, so this arithmetic is exact instead of an estimate that clips
// the last block once a subject is added.
const W = 830
const PAD = 13      // .grid padding, top and bottom
const GAP = 14      // between sections
const STRIP = 174   // 128 image + 6 gap + 12 caption + 14 padding twice
const SECTION = 408 // 11 + 26 heading + STRIP + 8 + STRIP + 13, plus slack
const H = PAD * 2 + subjects.length * SECTION + (subjects.length - 1) * GAP

screenshot(`<!doctype html><meta charset="utf-8">
<style>
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; width:${W}px; height:${H}px; background:#6E7175;
              font:13px/1.3 system-ui,sans-serif; color:#fff; }
  .grid { display:flex; flex-direction:column; gap:${GAP}px; padding:${PAD}px; }
  section { background:#565A5E; border-radius:9px; padding:11px 13px 13px;
            height:${SECTION}px; }
  h2 { margin:0 0 9px; font-size:13px; font-weight:600; letter-spacing:.02em; }
  .strip { display:flex; align-items:flex-end; gap:16px; padding:14px;
           border-radius:7px; margin-bottom:8px; height:${STRIP}px; }
  .strip:last-child { margin-bottom:0; }
  .light { background:#F1F3F4; color:#3C4043; }
  .dark  { background:#292A2D; color:#C9CCD0; }
  figure { margin:0; display:flex; flex-direction:column; align-items:center; gap:6px; }
  figcaption { font:500 10px/1 ui-monospace,Menlo,monospace; opacity:.75; }
  img { image-rendering:pixelated; display:block; }
  .true { display:flex; align-items:flex-end; gap:9px; height:48px; }
</style>
<div class="grid">
${subjects.map((s) => `<section><h2>${s.name}</h2>${strip(s, 'light')}${strip(s, 'dark')}</section>`).join('')}
</div>`, OUT, W, H)

rmSync(staging, { recursive: true, force: true })
console.log(`\nsheet -> ${OUT}  (${W}×${H})`)
