import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BrowserContext, Page } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  buildExtension,
  launchWithExtension,
  serveFixtures,
  SHADOW,
  type FixtureServer,
} from './harness'

/**
 * The whole extension, end to end, in a browser that actually loaded it.
 *
 * This is the only suite that exercises the manifest, the background service worker, the
 * message round-trip and `chrome.storage` — everything the unit and geometry suites stub or
 * skip. It replaces the manual "reload at chrome://extensions and drag a link" loop, which
 * was the single most expensive step in developing this project.
 *
 * How the browser has to be launched, and why, is in `harness.ts`.
 */

let server: FixtureServer
let context: BrowserContext
let base: string

beforeAll(async () => {
  buildExtension()
  server = await serveFixtures()
  base = server.base
  context = await launchWithExtension()
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

/**
 * Drives the real gesture, with real input.
 *
 * Dispatching a DragEvent pair is far easier and no longer works: `startDragTracking` refuses
 * an untrusted event, because a page that can synthesise one can choose what the background
 * worker fetches. That guard is only worth having if the shipped bundle is what gets tested, so
 * this suite pays the cost of driving the mouse — which also makes it the only place the
 * trusted path is exercised at all (`dragTracking.test.ts` explains the split).
 *
 * The move happens in steps because Chrome starts a native drag on movement *while* the button
 * is down; a single jump can be delivered as one event and never crosses the threshold.
 */
async function dragLink(page: Page, linkId: string): Promise<void> {
  const box = await page.locator(`#${linkId}`).boundingBox()
  if (!box) throw new Error(`no link #${linkId}`)

  const fromX = box.x + box.width / 2
  const fromY = box.y + box.height / 2
  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(fromX + 30, fromY + 30, { steps: 12 })
  await page.mouse.move(fromX + 90, fromY + 70, { steps: 12 })
  await page.mouse.up()
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
  it('puts nothing in the page until the reader asks for something', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)

    // Settle well past document_idle — the content script has certainly run by now, and the
    // point is that having run, it has added nothing. Piko's claim on every site it can reach
    // is that it does nothing until gestured at; this is that claim as an assertion.
    await page.waitForTimeout(750)
    expect(
      await page.evaluate('[...document.documentElement.children].some(e => e.shadowRoot)'),
    ).toBe(false)

    // …and it is listening, so the first gesture still builds it.
    await dragLink(page, 'article-link')
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

  it('groups the address left and the controls right, across the header', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)

    const box = (selector: string): Promise<{ left: number; right: number; width: number }> =>
      page.evaluate(`(() => {
        const el = ${SHADOW}.querySelector(${JSON.stringify(selector)})
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, width: r.width }
      })()`) as Promise<{ left: number; right: number; width: number }>

    // The panel scales from 0.85 to 1 over 180ms as it opens, and every rect read mid-flight
    // comes back multiplied by the current scale — an 8px gap measures 6.8. Settle first.
    await page.waitForFunction(
      () => {
        const host = [...document.documentElement.children].find((e) => e.shadowRoot)
        const panel = host?.shadowRoot?.querySelector('.piko-panel')
        return panel !== null && getComputedStyle(panel!).transform.startsWith('matrix(1, 0, 0, 1')
      },
      undefined,
      { timeout: 5_000 },
    )

    const header = await box('.piko-header')
    const url = await box('.piko-url')
    const openInTab = await box('.piko-url-open')
    const toggle = await box('.piko-mode-toggle')
    const close = await box('.piko-close')

    // Stated first so a hidden control fails as "the toggle isn't showing" rather than as a
    // baffling comparison against a zero-width rect at the origin.
    expect(toggle.width).toBeGreaterThan(0)

    // Each group sits tight against its own edge...
    expect(url.left - header.left).toBeLessThan(16)
    expect(header.right - close.right).toBeLessThan(16)

    // ...and tight within itself. This pair is what actually distinguishes two groups from
    // four loose children: `justify-content: space-between` alone spreads a flat header to the
    // same two edges, but pushes every neighbour ~230px apart on the way. Measured at 8px
    // grouped versus 233px flat, so the threshold is nowhere near either.
    expect(openInTab.left - url.right).toBeLessThan(12)
    expect(close.left - toggle.right).toBeLessThan(12)

    // All the slack collects between the groups instead.
    expect(toggle.left - openInTab.right).toBeGreaterThan(40)

    // Left open, this tab shadows the next test's: the toolbar press finds its target by URL,
    // and two tabs at the same address make which one receives it a coin toss.
    await page.close()
  })

  it('puts the clippings pane back after it has been closed', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)

    const paneHidden = (): Promise<boolean> =>
      page.evaluate(
        `${SHADOW}.querySelector('.piko-clips').hasAttribute('data-hidden')`,
      ) as Promise<boolean>

    expect(await paneHidden()).toBe(false)

    // Closing from inside the pane leaves the article the full width of the panel...
    await page.evaluate(`${SHADOW}.querySelector('.piko-clips-close').click()`)
    await expect.poll(paneHidden, POLL).toBe(true)

    // ...and the header keeps the way back. Without it the pane is gone for the life of the
    // preview, since nothing else on screen refers to it.
    await page.evaluate(`${SHADOW}.querySelector('.piko-clips-toggle').click()`)
    await expect.poll(paneHidden, POLL).toBe(false)

    await page.close()
  })

  it('searches the journal without Escape closing the preview under it', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)
    await clipFirstSentence(page)
    await expect.poll(() => clippingCount(page), POLL).toBe(1)

    await page.evaluate(`${SHADOW}.querySelector('.piko-clips-find').click()`)
    await expect
      .poll(() => page.evaluate(`${SHADOW}.querySelector('.piko-clips-search') !== null`), POLL)
      .toBe(true)

    // A word that is nowhere in the clipped sentence.
    await page.keyboard.type('zzzznothing')
    await expect.poll(() => clippingCount(page), POLL).toBe(0)

    // The panel dismisses on Escape from a capturing document listener, so the first Escape out
    // of a search field would otherwise take the whole preview with it.
    await page.keyboard.press('Escape')
    await expect.poll(() => clippingCount(page), POLL).toBe(1)

    const stillOpen = await page.evaluate(
      '[...document.documentElement.children].find(e => e.shadowRoot).hasAttribute("data-preview")',
    )
    expect(stillOpen).toBe(true)

    await page.close()
  })

  /**
   * The journal's door out, proved by the file arriving rather than by the button being there.
   * `journalToMarkdown` is unit-tested, but nothing in that suite says a content script may hand
   * a file to the browser at all — the blob URL, the `download` attribute and the click's
   * transient activation are all only real inside a loaded extension on a live page.
   *
   * This is the seam the clipboard never had, and the reason export is machine-checked where
   * copy is not: `copyText` ends in an API whose effect is invisible from script, while a
   * download ends in a FILE. Once the effect is a value, it is an ordinary equality assertion.
   */
  it('writes the journal out as a file the browser actually downloads', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)
    await clipFirstSentence(page)
    await expect.poll(() => clippingCount(page), POLL).toBe(1)

    const sentence = await firstClippingText(page)

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.evaluate(`${SHADOW}.querySelector('.piko-clips-export').click()`),
    ])

    expect(download.suggestedFilename()).toMatch(/^piko-clippings-\d{4}-\d{2}-\d{2}\.md$/)

    const written = readFileSync(await download.path(), 'utf8')

    // The sentence as the document writes it — collapsed, because a blockquote is one line.
    expect(written).toContain(`> ${sentence.replace(/\s+/g, ' ').trim()}`)
    // The two things that make the file worth having: it links the sentence, and it counts.
    expect(written).toContain('#:~:text=')
    expect(written).toContain('clippings: 1')

    await page.close()
  })

  /**
   * Emptying the journal has to reach `chrome.storage`, not just the pane. An in-memory clear
   * looks identical on screen and is undone by the next page load, which is the worst version of
   * this bug: the reader believes their reading is gone and it is not.
   */
  it('empties the stored journal, not only the pane', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)
    await clipFirstSentence(page)
    await expect.poll(() => clippingCount(page), POLL).toBe(1)

    const asking = (): Promise<boolean> =>
      page.evaluate(`${SHADOW}.querySelector('.piko-clips-confirm') !== null`) as Promise<boolean>

    // The delete asks before it empties, and the answer is a different element — so the redraw
    // in between is not optional here: the answer does not exist to be clicked until the pane
    // has drawn the question.
    await page.evaluate(`${SHADOW}.querySelector('.piko-clips-clear').click()`)
    await expect.poll(asking, POLL).toBe(true)
    await page.evaluate(`${SHADOW}.querySelector('.piko-clips-answer.is-destructive').click()`)
    await expect.poll(() => clippingCount(page), POLL).toBe(0)

    const [worker] = context.serviceWorkers()
    const stored = (await worker!.evaluate(() =>
      chrome.storage.local.get('piko.clippings'),
    )) as Record<string, unknown[] | undefined>

    expect(stored['piko.clippings'] ?? []).toHaveLength(0)

    await page.close()
  })

  it('answers the cursor on a button that is switched on', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)

    const background = (): Promise<string> =>
      page.evaluate(
        `getComputedStyle(${SHADOW}.querySelector('.piko-mode-toggle')).backgroundColor`,
      ) as Promise<string>

    // Reader mode is the default, so this one is already engaged — which is exactly the state
    // that went inert: `.piko-button.active` and `.piko-button:hover` are both one class, so
    // the later of the two simply won and hovering an engaged button did nothing.
    const pressed = await page.evaluate(
      `${SHADOW}.querySelector('.piko-mode-toggle').classList.contains('active')`,
    )
    expect(pressed).toBe(true)

    const resting = await background()

    const box = (await page.evaluate(`(() => {
      const r = ${SHADOW}.querySelector('.piko-mode-toggle').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)) as { x: number; y: number }
    await page.mouse.move(box.x, box.y)

    await expect.poll(background, POLL).not.toBe(resting)

    await page.close()
  })

  it('ignores a same-page anchor rather than previewing the page you are on', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'fragment-link')
    await page.waitForTimeout(1200)

    // Nothing was built at all, which is a stronger result than a panel that stayed hidden:
    // a gesture the reducer declines never reaches the point of mounting anything.
    const built = await page.evaluate(
      '[...document.documentElement.children].some(e => e.shadowRoot)',
    )
    expect(built).toBe(false)

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

    // The whole sentence, across the newlines the fixture's markup wraps it with — and without
    // the fixture's `[1]`, which the journal shows the reader but keeps in what it stored.
    expect(text).toBe(
      'A tide is the rise and fall of a sea level caused by the combined effects of ' +
        'gravitational forces exerted by the Moon and the Sun.',
    )
    expect(marks as number).toBeGreaterThan(0)

    // The other half of the same rule, and the half that fails silently: the row's link is built
    // from the STORED text, so the marker has to still be in there. Strip at the wrong end and
    // the journal looks tidier while every link in it quietly stops resolving.
    const href = await page.evaluate(`${SHADOW}.querySelector('.piko-clip-source').href`)
    expect(href).toContain('%5B1%5D')

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

  describe('clipping the host page', () => {
    /** The toolbar click has no page of its own, so the worker relays it into the tab. */
    async function pressToolbarIcon(page: Page): Promise<void> {
      const [worker] = context.serviceWorkers()
      const url = page.url()
      await worker!.evaluate(async (target) => {
        const tabs = await chrome.tabs.query({})
        const tab = tabs.find((t) => t.url === target)
        await chrome.tabs.sendMessage(tab!.id!, { type: 'TOGGLE_CLIPPING' })
      }, url)
    }

    /**
     * Whether the journal rail is not showing. Before the first gesture there is no panel in
     * the page at all, which is the strongest form of hidden there is — so an absent host
     * answers true rather than throwing, and every "starts hidden, ends hidden" assertion below
     * keeps saying what it always said.
     */
    const railHidden = (page: Page): Promise<boolean> =>
      page.evaluate(`(() => {
        const host = [...document.documentElement.children].find(e => e.shadowRoot)
        if (!host) return true
        const rail = host.shadowRoot.querySelector('.piko-rail')
        return rail === null || rail.hasAttribute('data-hidden')
      })()`) as Promise<boolean>

    it('docks the journal without dragging, and without covering the page', async () => {
      const page = await context.newPage()
      await page.goto(`${base}/article.html`)

      expect(await railHidden(page)).toBe(true)
      await pressToolbarIcon(page)
      await expect.poll(() => railHidden(page), POLL).toBe(false)

      // The scrim belongs to the modal preview. A rail that dimmed the page would defeat the
      // mode it accompanies, so the backdrop must stay inert.
      const backdropBlocks = await page.evaluate(
        `getComputedStyle(${SHADOW}.querySelector('.piko-backdrop')).pointerEvents !== 'none'`,
      )
      expect(backdropBlocks).toBe(false)

      // One pane instance, re-parented — not a second one rendered into the rail. A component
      // framework that re-created its root on each render would quietly break this, and the
      // journal would lose its filters and scroll every time the rail opened.
      const paneCount = await page.evaluate(`${SHADOW}.querySelectorAll('.piko-clips').length`)
      const paneIsInRail = await page.evaluate(
        `${SHADOW}.querySelector('.piko-rail').contains(${SHADOW}.querySelector('.piko-clips'))`,
      )
      expect(paneCount).toBe(1)
      expect(paneIsInRail).toBe(true)

      await page.close()
    })

    it('takes its width out of the page rather than sitting on top of it', async () => {
      const page = await context.newPage()
      await page.goto(`${base}/article.html`)

      const pageRight = (): Promise<number> =>
        page.evaluate(
          '[...document.querySelectorAll("article p")].pop().getBoundingClientRect().right',
        ) as Promise<number>

      const before = await pageRight()
      await pressToolbarIcon(page)
      await expect.poll(() => railHidden(page), POLL).toBe(false)

      // The page gives up real width, rather than the rail being drawn over what was there.
      await expect.poll(pageRight, POLL).toBeLessThan(before)

      // And gives up enough: no prose is left underneath the rail, which is the whole failure
      // this replaces — a right-hand figure or infobox reading through the journal.
      const railLeft = (await page.evaluate(
        `${SHADOW}.querySelector('.piko-rail').getBoundingClientRect().left`,
      )) as number
      expect(await pageRight()).toBeLessThanOrEqual(railLeft)

      // Handing the page back restores exactly what was borrowed.
      await pressToolbarIcon(page)
      await expect.poll(() => railHidden(page), POLL).toBe(true)
      await expect.poll(pageRight, POLL).toBe(before)

      await page.close()
    })

    it('clips a sentence from the page the reader is already on', async () => {
      const page = await context.newPage()
      await page.goto(`${base}/article.html`)
      await pressToolbarIcon(page)
      await expect.poll(() => railHidden(page), POLL).toBe(false)

      const point = (await page.evaluate(`(() => {
        const p = [...document.querySelectorAll('article p')][0]
        const r = p.getBoundingClientRect()
        return { x: r.left + 40, y: r.top + 8 }
      })()`)) as { x: number; y: number }
      await page.mouse.click(point.x, point.y)

      await expect.poll(() => clippingCount(page), POLL).toBe(1)
      const text = await firstClippingText(page)
      expect(text).toContain('A tide is the rise and fall of a sea level')

      // Taken directly, so there is no page it was dragged from.
      const source = await page.evaluate(`${SHADOW}.querySelector('.piko-clip-source').textContent`)
      expect(source).toContain('The Nature of Tides')

      await page.close()
    })

    it('does not follow a link when clipping a sentence inside one', async () => {
      const page = await context.newPage()
      await page.goto(`${base}/`)
      await pressToolbarIcon(page)
      await expect.poll(() => railHidden(page), POLL).toBe(false)

      const point = (await page.evaluate(`(() => {
        const a = document.getElementById('article-link')
        const r = a.getBoundingClientRect()
        return { x: r.left + 10, y: r.top + r.height / 2 }
      })()`)) as { x: number; y: number }
      await page.mouse.click(point.x, point.y)
      await page.waitForTimeout(700)

      expect(page.url()).toBe(`${base}/`)
      await page.close()
    })

    it('hands the page back when toggled off', async () => {
      const page = await context.newPage()
      await page.goto(`${base}/article.html`)
      await pressToolbarIcon(page)
      await expect.poll(() => railHidden(page), POLL).toBe(false)
      await pressToolbarIcon(page)
      await expect.poll(() => railHidden(page), POLL).toBe(true)

      // Nothing left listening: a click on prose is an ordinary click again.
      const before = await clippingCount(page)
      const point = (await page.evaluate(`(() => {
        const p = [...document.querySelectorAll('article p')][0]
        const r = p.getBoundingClientRect()
        return { x: r.left + 40, y: r.top + 8 }
      })()`)) as { x: number; y: number }
      await page.mouse.click(point.x, point.y)
      await page.waitForTimeout(600)
      expect(await clippingCount(page)).toBe(before)

      await page.close()
    })
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

/**
 * The promise the store listing makes about the fetch, checked against a server that says what
 * actually arrived.
 *
 * `docs/chrome-web-store-listing.md` tells a reviewer the background fetch "carries no cookies or
 * credentials for that site". That was true by default before it was true on purpose, and a
 * promise resting on a default is one nothing defends. This is the defence: set a cookie for the
 * origin the link points at, drag the link, and read the request the worker actually sent.
 */
describe('what the background fetch carries', () => {
  it('sends no cookie for the target site, even when the browser holds one', async () => {
    const received: { cookie: string | null; referer: string | null }[] = []
    const recorder = createServer((request, response) => {
      received.push({
        cookie: request.headers.cookie ?? null,
        referer: request.headers.referer ?? null,
      })
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<html><body><article><p>Recorded.</p></article></body></html>')
    })
    await new Promise<void>((resolve) => recorder.listen(0, '127.0.0.1', resolve))
    const port = (recorder.address() as AddressInfo).port
    const recorderUrl = `http://127.0.0.1:${port}/recorded.html`

    // Cookies ignore port, so this is a cookie the browser genuinely holds for the target host.
    await context.addCookies([
      { name: 'piko_e2e_session', value: 'must-not-travel', url: recorderUrl },
    ])

    try {
      const page = await context.newPage()
      await page.goto(`${base}/`)

      await page.evaluate((href) => {
        const anchor = document.createElement('a')
        anchor.id = 'credential-link'
        anchor.href = href
        anchor.textContent = 'a link to the recorder'
        anchor.setAttribute('style', 'position:fixed;left:40px;top:200px;padding:8px;z-index:1')
        document.body.appendChild(anchor)
      }, recorderUrl)

      await dragLink(page, 'credential-link')
      await expect.poll(() => received.length, POLL).toBeGreaterThan(0)

      // Revert `credentials: 'omit'` in frameability.ts and this is the assertion that goes red.
      expect(received[0]?.cookie).toBeNull()
      // referrerPolicy: 'no-referrer' — the page being read from is not the target's business.
      expect(received[0]?.referer).toBeNull()

      await page.close()
    } finally {
      await context.clearCookies()
      recorder.close()
    }
  })
})
