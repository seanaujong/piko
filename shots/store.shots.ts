/**
 * The three pictures `docs/chrome-web-store-listing.md`'s Assets checklist asks for — a
 * different capture from the onboarding page's two, at the size the dashboard's own screenshot
 * spec requires (1280×800) rather than the width the panel is actually read at.
 *
 * Same bargain as `capture.shots.ts`, and it shares that file's gestures through `./helpers`: a
 * real capture of Piko working, off the real article the onboarding page sends a reader to,
 * through the real drag and the real click — not drawn, so a stale picture cannot quietly stop
 * matching what ships. Manual because it depends on a live Wikipedia article and is judged by
 * eye; regenerate when the panel's look changes.
 *
 * Written to `store-assets/`, never `public/` — these are dashboard uploads, not shipped bytes,
 * and `esbuild.config.mjs` copies `public/` into `dist/` wholesale.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { it } from 'vitest'
import { buildTestExtension, dragElement, launchWithExtension, SHADOW } from '../e2e/harness'
import { armClipping, clipSentenceIn, hoverSentenceIn, settle } from './helpers'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'store-assets', 'screenshots')

/** Same article the onboarding tutorial sends a reader to, so the shots are of what they'll see. */
const ARTICLE = 'https://en.wikipedia.org/wiki/Commonplace_book'

/** The dashboard's own screenshot size — exact pixels, not a CSS width chosen for readability. */
const VIEWPORT = { width: 1280, height: 800 }

it('captures the three pictures the store listing wants', async () => {
  buildTestExtension()
  const context = await launchWithExtension()
  mkdirSync(OUT_DIR, { recursive: true })

  try {
    const page = await context.newPage()
    await page.setViewportSize(VIEWPORT)

    // Wikipedia's fundraising banner, kept out of the picture — see capture.shots.ts for why
    // this is a route block rather than a style applied after the fact.
    await page.route(/ext\.centralNotice/, (route) => route.abort())
    await page.goto(ARTICLE)

    // Shot 1: the drag surface. A linked article opens over the page it was dragged from — the
    // wide viewport leaves host page visible on both sides of the panel, which is the entire
    // claim this picture makes.
    const link = page.locator('#mw-content-text p a[href*="/wiki/"]').first()
    await link.scrollIntoViewIfNeeded()
    await dragElement(page, link)
    await page.waitForFunction(
      () => {
        const host = [...document.documentElement.children].find((e) => e.shadowRoot)
        return (host?.shadowRoot?.querySelectorAll('.piko-article p').length ?? 0) > 0
      },
      undefined,
      { timeout: 30_000 },
    )
    await settle(page)
    await write(page, '1-preview-over-page.png')

    // Source A. Kept before moving to the next shot, so the journal already holds one source by
    // the time shot 3 needs two.
    await clipSentenceIn(page, `${SHADOW}.querySelector('.piko-article p')`, true)
    await page.keyboard.press('Escape')

    // Shot 2: the hover itself, on the live-page surface rather than the preview, so this reads
    // as the toolbar-icon entry point rather than a repeat of shot 1. No settle() — settle moves
    // the cursor away and re-homes scroll, either of which strands the painted band away from a
    // hover that is still live.
    await armClipping(page, `${ARTICLE}*`)
    await hoverSentenceIn(page, '#mw-content-text p')
    await page.waitForTimeout(300)
    await write(page, '2-sentence-highlighted.png')

    // Source B — the live page itself, clicked at the exact point just hovered rather than
    // recomputed, so the sentence shown highlighted in shot 2 is the one shown kept in shot 3.
    await page.mouse.down()
    await page.mouse.up()

    // Shot 3: the journal with two sources, and the chip row that only renders once there are.
    await settle(page)
    await write(page, '3-journal-two-sources.png')
  } finally {
    await context.close()
  }
}, 180_000)

/** Playwright's own PNG, unconverted — the dashboard wants PNG or JPEG, never WebP. */
async function write(page: Page, name: string): Promise<void> {
  const png = await page.screenshot({ type: 'png' })
  const out = path.join(OUT_DIR, name)
  writeFileSync(out, png)
  console.log(`${path.relative(ROOT, out)}  ${(png.length / 1024).toFixed(0)} kB`)
}
