/**
 * The one place that knows how to turn markup into a PNG through headless Chrome.
 *
 * Both consumers go through here deliberately. `render-icons.mjs` produces what ships;
 * `icon-sheet.mjs` produces the sheet those icons are judged on, and the sheet's only claim
 * is that it shows what Chrome actually produces. It stops being able to make that claim the
 * moment it rasterizes differently from the build — so the flags live here rather than being
 * copied, and a change to them reaches the shipping icons and the sheet in the same edit.
 *
 * Chrome does the rasterizing because it is the renderer the icons are actually viewed in,
 * and it needs no toolchain beyond the browser already required to load the extension.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** The sizes `manifest.json` declares. */
export const SIZES = [16, 32, 48, 128]

/** Screenshots `html` into `out` at exactly `width` by `height`. */
export function screenshot(html, out, width, height) {
  const staging = mkdtempSync(join(tmpdir(), 'piko-shot-'))
  try {
    const page = join(staging, 'page.html')
    writeFileSync(page, html)
    execFileSync(CHROME, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      `file://${page}`,
    ], { stdio: 'ignore' })
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * Rasterizes a 128-box SVG at `size`, on a page sized exactly to the icon and stripped of
 * every default margin, so the screenshot viewport and the artwork are the same box.
 */
export function rasterizeSvg(svg, size, out) {
  screenshot(
    `<!doctype html><meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; width:${size}px; height:${size}px; }
  svg { display:block; width:${size}px; height:${size}px; }
</style>
${svg}`,
    out, size, size,
  )
}
