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
    await page.goto(ARTICLE)

    // A journal with something in it, because an empty one is a picture of an empty box. The
    // sentence is clipped through the same click a reader makes, so the mark in the shot is a
    // real mark rather than a state set from script.
    await armClipping(page)
    await clipSentenceIn(page, '#mw-content-text p')
    await settle(page)
    await write(page, 'armed.webp')

    // A drag wins over host clipping, so this arrives in the preview with the rail already put
    // away — exactly the sequence the onboarding steps walk through. `href*=` and not `^=`:
    // Wikipedia serves protocol-relative links, so every one of them starts `//en.wikipedia.org`.
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
  } finally {
    await context.close()
  }
}, 180_000)

/**
 * The toolbar click, which no script can perform — the message it sends is what arms the page.
 *
 * Retried, because the content script arrives at `document_idle` and nothing in the page
 * announces it: Piko adds nothing until a gesture asks it to. So the message is its own
 * detector, and "receiving end does not exist" means not yet rather than not at all.
 */
async function armClipping(page: Page): Promise<void> {
  const [worker] = page.context().serviceWorkers()

  for (let attempt = 0; ; attempt++) {
    const armed = await worker!.evaluate(async (match) => {
      const [tab] = await chrome.tabs.query({ url: match })
      if (tab?.id === undefined) return false
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_CLIPPING' })
        return true
      } catch {
        return false
      }
    }, `${ARTICLE}*`)

    if (armed) break
    if (attempt >= 60) throw new Error('the content script never reached the article')
    await page.waitForTimeout(250)
  }

  await page.waitForFunction(() =>
    [...document.documentElement.children].some((e) => e.shadowRoot?.querySelector('.piko-rail')),
  )
}

/** Clicks into the first line of a substantial paragraph, the way a reader picks a sentence. */
async function clipSentenceIn(page: Page, selector: string, inShadow = false): Promise<void> {
  const target = inShadow
    ? selector
    : `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim().length > 200)`
  const point = (await page.evaluate(`(() => {
    const el = ${target}
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + 60, y: r.top + 10 }
  })()`)) as { x: number; y: number }

  await page.mouse.move(point.x, point.y)
  await page.mouse.click(point.x, point.y)
}

/**
 * Composes the shot, once the clicking is done.
 *
 * The cursor goes somewhere with no prose under it, because Piko paints a hover band wherever it
 * rests and a half-cut band at the edge of the frame is noise in a picture about the *kept* mark.
 * The scroll goes home for the same reason: `scrollIntoView` leaves the article's header sliced
 * through the middle, which reads as a broken capture rather than a page. Both marks stay in
 * frame from the top, because the sentence worth clipping in this article is its first.
 */
async function settle(page: Page): Promise<void> {
  await page.mouse.move(4, 4)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(700)
}

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
