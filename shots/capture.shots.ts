/**
 * The two pictures the onboarding page shows of Piko working, captured from Piko working.
 *
 * **Why generated and not drawn.** The pin illustration on that page is drawn, because the thing
 * it points at is browser chrome no script can photograph. These two are the opposite case:
 * they are Piko's own surfaces, they are page content, and a real capture is both easy and the
 * only version that cannot quietly stop matching what ships. A hand-drawn panel would keep
 * looking right long after the panel stopped.
 *
 * **Why the real article and not a fixture.** The page tells the reader to open
 * `Commonplace book` on Wikipedia; a screenshot of some other page under the same instruction is
 * a picture of something they will not see. That costs this script a network dependency and a
 * dependency on Wikipedia's markup, which is why it is a manual command and not part of any
 * gate — the same bargain `npm run icons` makes. The article text and images in the capture are
 * Wikipedia's, under CC BY-SA; the shot shows the site and title it came from.
 *
 * **Why `dist-test`.** The shipped manifest asks for host access optionally and no automation can
 * grant it, so the shipped build can reach nothing on wikipedia.org. `buildTestExtension` is the
 * same substitution the e2e suite runs on, and `harness.ts` has the measurements behind it. The
 * *panel* in the capture is the shipped bundle either way — only how the script got into the page
 * differs, and no picture can show that.
 *
 * **Regenerate when the panel's look changes**, and judge the result with your eyes: this prints
 * where it wrote and asserts nothing, because "does this read as Piko" is not a predicate. The
 * files are committed, so a normal build never runs this.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from 'playwright'
import { it } from 'vitest'
import { buildTestExtension, dragElement, launchWithExtension, SHADOW } from '../e2e/harness'
import { armClipping, clipSentenceIn, settle } from './helpers'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'public', 'shots')

/** The page the onboarding copy sends the reader to, so the pictures are of what they will open. */
const ARTICLE = 'https://en.wikipedia.org/wiki/Commonplace_book'

/**
 * Wide enough for the journal to dock beside a readable column, and no wider. The page renders
 * these at around 400 CSS pixels, so this is already better than twice the resolution they are
 * seen at — every pixel past that is bytes in an install and nothing on screen. It is also what
 * folds Wikipedia's Appearance panel away, which is noise in a picture about Piko.
 */
const VIEWPORT = { width: 1040, height: 660 }

it('captures the two pictures the onboarding page shows of Piko working', async () => {
  buildTestExtension()
  const context = await launchWithExtension()
  mkdirSync(SHOTS, { recursive: true })

  try {
    const page = await context.newPage()
    await page.setViewportSize(VIEWPORT)

    /*
     * Wikipedia's fundraising banner, kept out of the picture.
     *
     * CentralNotice arrives asynchronously and, while a campaign is running, covers the article
     * with a donation form — which turns a picture of Piko reading an article into a picture of
     * a donation form with Piko beside it. It is seasonal, so whether these shots carry it
     * depends on nothing but the day they were last regenerated, and a reader who is signed in
     * or has dismissed it once sees an article where the capture would have shipped an appeal.
     *
     * Blocked at the request, so the banner never exists, rather than hidden afterwards by a
     * style this page would not otherwise have: what is photographed is a state Wikipedia really
     * renders. Its modules are batched into one ResourceLoader request of their own, so aborting
     * that request takes nothing else with it.
     */
    await page.route(/ext\.centralNotice/, (route) => route.abort())

    await page.goto(ARTICLE)

    // The drag first, because that is the order the steps walk through and the order decides
    // what is in the journal. This shot is taken before the page itself has been clipped, so the
    // journal beside the preview holds exactly the one sentence just kept from the dragged
    // article — which is what the step this picture sits under has asked the reader to do, and
    // no more. A journal with something in it either way, because an empty one is a picture of
    // an empty box, and the sentence is clipped through the same click a reader makes, so the
    // mark in the shot is a real mark rather than a state set from script.
    //
    // `href*=` and not `^=`: Wikipedia serves protocol-relative links, so every one of them
    // starts `//en.wikipedia.org`.
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
    await clipSentenceIn(page, `${SHADOW}.querySelector('.piko-article p')`, true)
    await settle(page)
    await write(page, 'preview.webp')

    // Escape puts the preview away and leaves the page it was dragged from, which is where the
    // rest of the sequence happens. The journal holds two sentences from two sources by the time
    // this one is taken, and the step it sits under is the one that just added the second.
    await page.keyboard.press('Escape')
    await armClipping(page, `${ARTICLE}*`)
    await clipSentenceIn(page, '#mw-content-text p')
    await settle(page)
    await write(page, 'armed.webp')
  } finally {
    await context.close()
  }
}, 180_000)

/**
 * PNG out of Playwright, WebP through the browser already running.
 *
 * Playwright encodes PNG and JPEG and nothing else, and a full-viewport PNG of this is around
 * ten times the size of the WebP — worth avoiding in something every install downloads. Chrome
 * has a WebP encoder in it, so the bytes go back into a blank page and come out re-encoded
 * rather than pulling in an image library for one conversion.
 */
async function write(page: Page, name: string): Promise<void> {
  const png = await page.screenshot({ type: 'png' })

  const encoder = await page.context().newPage()
  const webp = (await encoder.evaluate(async (bytes: number[]) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
    return [...new Uint8Array(await blob.arrayBuffer())]
  }, [...png])) as number[]
  await encoder.close()

  const out = path.join(SHOTS, name)
  writeFileSync(out, Buffer.from(webp))
  console.log(`${path.relative(ROOT, out)}  ${(webp.length / 1024).toFixed(0)} kB`)
}
