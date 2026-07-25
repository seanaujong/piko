import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * The whole extension, end to end, in a browser that actually loaded it.
 *
 * This is the only suite that exercises the manifest, the background service worker, the
 * message round-trip and `chrome.storage` — everything the unit and geometry suites stub or
 * skip. It replaces the manual "reload at chrome://extensions and drag a link" loop, which
 * was the single most expensive step in developing this project.
 *
 * Two hard-won launch requirements, both measured rather than assumed:
 *  - `channel: 'chromium'`, NOT `channel: 'chrome'`. Branded Chrome now ignores
 *    `--load-extension`, and no amount of `--disable-features` brought it back — the
 *    extension simply never appears in chrome://extensions.
 *  - Full Chromium, not the headless shell. `headless: true` alone resolves to
 *    chrome-headless-shell, which has no extension support at all; pairing it with
 *    `channel: 'chromium'` selects the complete browser in new-headless mode, which does.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const DIST = path.join(ROOT, 'dist')
const FIXTURES = path.join(HERE, 'fixtures')

let server: Server
let context: BrowserContext
let base: string

beforeAll(async () => {
  // Always exercise the shipped bundle rather than the source it was built from.
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' })

  server = createServer((request, response) => {
    const requested = (request.url === '/' ? '/index.html' : (request.url ?? '/')).split('?')[0]!
    const file = path.join(FIXTURES, path.basename(requested))
    if (!existsSync(file)) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(readFileSync(file))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  })

  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent('serviceworker', { timeout: 20_000 })
  }
}, 120_000)

afterAll(async () => {
  await context?.close()
  server?.close()
})

/**
 * One browser profile is shared by every test, so the journal persists between them — which
 * matters because clipping TOGGLES. Without this, a test that clips the same sentence a
 * previous test already clipped silently un-clips it and sees a count of zero.
 */
beforeEach(async () => {
  const [worker] = context.serviceWorkers()
  await worker?.evaluate(() => chrome.storage.local.clear())
})

/** Everything the panel renders lives in one open shadow root on a child of <html>. */
const SHADOW = `[...document.documentElement.children].find(e => e.shadowRoot).shadowRoot`

/**
 * Drives the real gesture. `startDragTracking` never checks `isTrusted`, so dispatching the
 * pair fires exactly the flow a mouse drag does — and unlike a synthesised mouse drag, it
 * fires every time.
 */
async function dragLink(page: Page, linkId: string): Promise<void> {
  await page.evaluate((id) => {
    const anchor = document.getElementById(id)
    if (!anchor) throw new Error(`no link #${id}`)
    anchor.dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
    anchor.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
  }, linkId)
}

async function waitForReader(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const host = [...document.documentElement.children].find((e) => e.shadowRoot)
      return (host?.shadowRoot?.querySelectorAll('.piko-article p').length ?? 0) > 0
    },
    undefined,
    { timeout: 20_000 },
  )
}

/** Clicks the middle of the first line of the first substantial paragraph. */
async function clipFirstSentence(page: Page): Promise<void> {
  const point = await page.evaluate(`(() => {
    const sr = ${SHADOW}
    const p = [...sr.querySelectorAll('.piko-article p')].find(el => el.textContent.trim().length > 80)
    p.scrollIntoView({ block: 'center' })
    const r = p.getBoundingClientRect()
    return { x: r.left + 40, y: r.top + 8 }
  })()`)
  const { x, y } = point as { x: number; y: number }
  await page.mouse.click(x, y)
}

const clippingCount = (page: Page): Promise<number> =>
  page.evaluate(`${SHADOW}.querySelectorAll('.piko-clip').length`) as Promise<number>

/**
 * The clipped sentence alone. The source link is a child of `.piko-clip-body`, so reading
 * the element's textContent would silently concatenate the two.
 */
const firstClippingText = (page: Page): Promise<string> =>
  page.evaluate(`${SHADOW}.querySelector('.piko-clip-body').firstChild.textContent`) as Promise<string>

/** Storage reads are async, so a freshly-opened panel fills in a beat after it renders. */
const POLL = { timeout: 15_000, interval: 150 }

describe('the loaded extension', () => {
  it('mounts its content script on an ordinary page', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)

    await expect
      .poll(
        () => page.evaluate('[...document.documentElement.children].some(e => e.shadowRoot)'),
        POLL,
      )
      .toBe(true)

    await page.close()
  })

  it('opens a dragged link in reader mode, extracted', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)

    const title = await page.evaluate(`${SHADOW}.querySelector('.piko-article h1').textContent`)
    const url = await page.evaluate(`${SHADOW}.querySelector('.piko-url').textContent`)

    expect(title).toBe('The Nature of Tides')
    // Displayed trimmed of its scheme; the copy path still uses the whole string.
    expect(url).toContain('/article.html')
    expect(url).not.toContain('http://')

    await page.close()
  })

  it('ignores a same-page anchor rather than previewing the page you are on', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'fragment-link')
    await page.waitForTimeout(1200)

    const hidden = await page.evaluate(
      '[...document.documentElement.children].find(e => e.shadowRoot).hasAttribute("data-hidden")',
    )
    expect(hidden).toBe(true)

    await page.close()
  })

  it('clips the sentence under the click, and paints a mark for it', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)

    expect(await clippingCount(page)).toBe(0)
    await clipFirstSentence(page)
    await expect.poll(() => clippingCount(page), POLL).toBe(1)

    const text = await firstClippingText(page)
    const marks = await page.evaluate(`${SHADOW}.querySelectorAll('.piko-marks > *').length`)

    // The whole sentence, across the newlines the fixture's markup wraps it with, and with
    // its footnote marker still attached.
    expect(text).toBe(
      'A tide is the rise and fall of a sea level caused by the combined effects of ' +
        'gravitational forces exerted by the Moon and the Sun.[1]',
    )
    expect(marks as number).toBeGreaterThan(0)

    await page.close()
  })

  it('links a clipping back to its source at the sentence', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)
    await clipFirstSentence(page)
    await expect.poll(() => clippingCount(page), POLL).toBe(1)

    const href = (await page.evaluate(
      `${SHADOW}.querySelector('.piko-clip-source').href`,
    )) as string

    // A sentence this long is pointed at by its first and last few words rather than spelled
    // out whole, so the directive carries a textStart,textEnd pair.
    const [textStart, textEnd] = decodeURIComponent(href.split('#:~:text=')[1]!).split(',')
    expect(href).toContain('/article.html#:~:text=')
    expect(textStart).toBe('A tide is the rise and')
    expect(textEnd).toBe('by the Moon and the Sun.[1]')

    await page.close()
  })

  it('un-clips a sentence when it is clicked again', async () => {
    // Clicking accumulates into the journal rather than writing to the clipboard, so the
    // same click has to be the way back out.
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)

    await clipFirstSentence(page)
    await expect.poll(() => clippingCount(page), POLL).toBe(1)
    await clipFirstSentence(page)
    await expect.poll(() => clippingCount(page), POLL).toBe(0)

    await page.close()
  })

  it('restores clippings from chrome.storage after a reload', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)
    await clipFirstSentence(page)
    await expect.poll(() => clippingCount(page), POLL).toBe(1)

    await page.reload()
    await dragLink(page, 'article-link')
    await waitForReader(page)

    await expect.poll(() => clippingCount(page), POLL).toBeGreaterThan(0)

    await page.close()
  })

  it('shows source filter chips only once a second source exists', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)

    await dragLink(page, 'article-link')
    await waitForReader(page)
    await clipFirstSentence(page)
    await expect.poll(() => clippingCount(page), POLL).toBeGreaterThan(0)

    const chipsWithOneSource = await page.evaluate(
      `${SHADOW}.querySelectorAll('.piko-clips-filters .piko-chip').length`,
    )
    expect(chipsWithOneSource).toBe(0)

    await page.keyboard.press('Escape')
    await dragLink(page, 'other-link')
    await waitForReader(page)
    await clipFirstSentence(page)

    await expect
      .poll(
        () => page.evaluate(`${SHADOW}.querySelectorAll('.piko-clips-filters .piko-chip').length`),
        POLL,
      )
      .toBeGreaterThanOrEqual(2)

    await page.close()
  })
})
