import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BrowserContext, Page } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  buildTestExtension,
  dragElement,
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

/**
 * A minimal, genuinely valid single-page PDF, xref table and all.
 *
 * Generated rather than committed for the reason the bench's article is: its bytes carry nothing
 * the suite reads, and a repository is a poor place to keep a binary a dozen lines can produce.
 * Valid rather than approximate because Chrome has to actually render it — a PDF that failed to
 * open would still produce an iframe, and the framing assertion would pass while proving nothing.
 */
function minimalPdf(): string {
  const stream = 'BT /F1 18 Tf 30 120 Td (Tidal Constituents) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }

  const startxref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
}

/** The targets that are files rather than pages. `harness.ts` serves each as its extension says. */
const FILES = {
  '/paper.pdf': minimalPdf(),
  '/attached-paper.pdf': minimalPdf(),
  '/handout.docx': 'PK not really a docx, and it never needs to be',
}

beforeAll(async () => {
  buildTestExtension()
  server = await serveFixtures(FILES)
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

/** The fixtures address their links by id; `dragElement` in the harness does the gesture. */
const dragLink = (page: Page, linkId: string): Promise<void> =>
  dragElement(page, page.locator(`#${linkId}`))

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
/**
 * A body the worker has decided not to read.
 *
 * The frameability check answers from the headers alone unless it is going to extract, and a
 * response whose body nobody reads keeps arriving regardless — the worker holds the connection
 * open and the bytes travel, to be thrown away on the far end. On a large file that is the whole
 * file, over the reader's connection, for nothing. Framed types pay it twice over, since the
 * iframe then fetches the same bytes again to display them.
 *
 * Measured from the server's side because that is where it becomes a value: either the client
 * hung up early or it did not. A `.docx` is the target because it is refused outright, which
 * means the worker's fetch is the *only* request for it — with a PDF the iframe would fetch it
 * too, and the second request would drown out the answer.
 */
describe('a body the worker will not read', () => {
  it('stops arriving instead of being downloaded and discarded', async () => {
    const CHUNK = 'x'.repeat(64 * 1024)
    const CHUNKS = 40
    let verdict = 'never requested'

    const trickler = createServer(async (request, response) => {
      if (!(request.url ?? '').startsWith('/big.docx')) {
        response.writeHead(404)
        response.end('not found')
        return
      }
      response.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Length': String(CHUNK.length * CHUNKS),
      })

      let open = true
      response.on('close', () => (open = false))
      let written = 0
      for (let i = 0; i < CHUNKS && open; i++) {
        response.write(CHUNK)
        written += CHUNK.length
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      verdict = open
        ? `the whole ${written}-byte body arrived`
        : `hung up after ${written} of ${CHUNK.length * CHUNKS} bytes`
      if (open) response.end()
    })
    await new Promise<void>((resolve) => trickler.listen(0, '127.0.0.1', resolve))
    const fileUrl = `http://127.0.0.1:${(trickler.address() as AddressInfo).port}/big.docx`

    try {
      const page = await context.newPage()
      await page.goto(`${base}/`)
      await page.evaluate((href) => {
        const anchor = document.createElement('a')
        anchor.id = 'large-file-link'
        anchor.href = href
        anchor.textContent = 'a large handout'
        anchor.setAttribute('style', 'position:fixed;left:40px;top:200px;padding:8px;z-index:1')
        document.body.appendChild(anchor)
      }, fileUrl)

      await dragLink(page, 'large-file-link')

      // Delete the body-cancelling `finally` in `frameability.ts` and this reddens with
      // "the whole 2621440-byte body arrived".
      await expect.poll(() => verdict, POLL).toContain('hung up')
      await page.close()
    } finally {
      trickler.close()
    }
  })
})

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

/**
 * Extraction on a page that forbids the shortcut.
 *
 * A `<base href>` inside a DOMParser document is governed by the *host page's* `base-uri`
 * directive, so on a site serving `base-uri 'self'` the insertion is blocked, the document keeps
 * its `about:blank` base, and every relative image and link in the reader resolves against that.
 * It fails silently and only on some sites — reported from Wikipedia, where dragging a link to
 * www.wikipedia.org from en.wikipedia.org trips it.
 *
 * Two details are load-bearing, and both were got wrong before they were got right:
 *
 *  - jsdom has no CSP, so the `<base>` approach passes every test in `extract.test.ts`. Only a
 *    real page serving the directive can tell the two mechanisms apart.
 *  - the dragged page must be a DIFFERENT ORIGIN from the host page. `'self'` permits a base
 *    pointing at the host's own origin, so a same-origin fixture reproduces nothing. A second
 *    server on a second port is what makes the directive bite.
 */
describe('extraction under a hostile base-uri policy', () => {
  it('resolves relative urls when the page forbids a cross-origin base element', async () => {
    // Same fixtures, different port — a different origin as far as `base-uri 'self'` is concerned.
    const elsewhere = await serveFixtures()
    const page = await context.newPage()

    const violations: string[] = []
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text())
    })

    try {
      await page.goto(`${base}/csp-host.html`)
      await page.evaluate((href) => {
        const anchor = document.createElement('a')
        anchor.id = 'cross-origin-link'
        anchor.href = href
        anchor.textContent = 'an article on another origin'
        anchor.setAttribute('style', 'position:fixed;left:40px;top:240px;padding:8px;z-index:1')
        document.body.appendChild(anchor)
      }, `${elsewhere.base}/relative.html`)

      await dragLink(page, 'cross-origin-link')
      await waitForReader(page)

      const urls = (await page.evaluate(`(() => {
        const article = ${SHADOW}.querySelector('.piko-article')
        return {
          link: article.querySelector('a')?.getAttribute('href') ?? null,
          image: article.querySelector('img')?.getAttribute('src') ?? null,
        }
      })()`)) as { link: string | null; image: string | null }

      // Resolved against the article's own origin — not against about:blank, and not against
      // the host page, which is what a blocked base leaves behind.
      expect(urls.link).toBe(`${elsewhere.base}/other.html`)
      expect(urls.image).toBe(`${elsewhere.base}/tide-chart.png`)

      // The page never had to refuse anything. Restore the <base> element and this is the
      // assertion that goes red first, with the violation Sean saw on Wikipedia.
      expect(violations).toEqual([])
    } finally {
      elsewhere.close()
      await page.close()
    }
  })
})

/**
 * What a drag does when the link is not an article.
 *
 * The suite the rest of this file describes could not have caught the bug this one exists for,
 * and the reason is worth stating: every assertion elsewhere reads the panel, and the failure
 * here left the panel looking merely unhelpful while writing a file to the reader's Downloads
 * folder. The effect landed outside the page entirely. What makes it testable anyway is the
 * same thing that makes the journal's export testable — it ends in a *file*, and Playwright
 * hands the file back. An effect is guardable when it ends in a value something can read,
 * whatever the distance it travelled.
 *
 * `previewableContent.test.ts` holds the decision as a table. These four are the round trip:
 * a real drag, the real worker, real headers, and Chrome's own idea of what it will display.
 */
describe('a link that is not a page', () => {
  /** The panel's error text, once it has one. */
  const errorText = (page: Page): Promise<string> =>
    page.evaluate(`${SHADOW}.querySelector('.piko-error')?.textContent ?? ''`) as Promise<string>

  /** A drag, watched for the one effect that leaves the browser. */
  async function dragWatchingDisk(linkId: string): Promise<{ page: Page; saved: string[] }> {
    const page = await context.newPage()
    const saved: string[] = []
    page.on('download', (download) => saved.push(download.suggestedFilename()))
    await page.goto(`${base}/files.html`)
    await dragLink(page, linkId)
    return { page, saved }
  }

  /**
   * Long enough for the pre-fix path to have played out in full: the file was written about a
   * second after the drag, and the panel said nothing at all until the iframe's 2.5s timeout.
   * A fixed wait rather than a poll on the panel, because the disk has to be checked whatever
   * the panel ends up showing — polling for the right words first would report the wrong
   * failure, and this test is worth more than the words.
   */
  const SETTLED_MS = 3_500

  it('refuses a file Chrome would save, and saves nothing', async () => {
    const { page, saved } = await dragWatchingDisk('docx-link')
    await page.waitForTimeout(SETTLED_MS)

    // The assertion the block exists for, and first for that reason. Revert `handlingFor` to
    // the old `text/html` test and this is what reddens, with `handout.docx` in the array.
    expect(saved).toEqual([])

    expect(await errorText(page)).toContain('wordprocessingml')
    expect(await errorText(page)).toContain('new tab')
    await page.close()
  })

  /**
   * A frameable type carrying the one header that overrides it. Chrome saves a PDF served this
   * way exactly as it saves a zip, so the type alone is not enough to decide by.
   */
  it('refuses a pdf the server marked for saving', async () => {
    const { page, saved } = await dragWatchingDisk('attached-pdf-link')
    await page.waitForTimeout(SETTLED_MS)

    expect(saved).toEqual([])
    expect(await errorText(page)).toContain('application/pdf')
    await page.close()
  })

  it('frames a pdf, and offers no reader mode for it', async () => {
    const { page, saved } = await dragWatchingDisk('pdf-link')

    const framed = (): Promise<string | null> =>
      page.evaluate(
        `${SHADOW}.querySelector('iframe')?.getAttribute('src') ?? null`,
      ) as Promise<string | null>

    await expect.poll(framed, POLL).toBe(`${base}/paper.pdf`)
    // There is no body to extract from, so the toggle would be a control with one setting.
    const toggleShown = await page.evaluate(
      `(() => { const b = ${SHADOW}.querySelector('.piko-mode-toggle'); return !!b && b.style.display !== 'none' })()`,
    )
    expect(toggleShown).toBe(false)
    expect(saved).toEqual([])
    await page.close()
  })

  /**
   * The quiet half of the same bug. This page is prose by any measure, and asking whether its
   * type *contained* `text/html` answered no — so it was framed, and framing is where reader
   * mode, highlighting, clipping and the toggle that would have let the reader ask for them
   * again all went. Clipping a sentence from it is the assertion that all four came back.
   */
  it('reads an xhtml page like any other article', async () => {
    const page = await context.newPage()
    await page.goto(`${base}/files.html`)
    await dragLink(page, 'xhtml-link')
    await waitForReader(page)

    expect(await page.evaluate(`${SHADOW}.querySelector('.piko-article').textContent`)).toContain(
      'standing agreement',
    )

    await clipFirstSentence(page)
    await expect.poll(() => clippingCount(page), POLL).toBe(1)
    await page.close()
  })
})

/**
 * The wiring the unit tests cannot reach.
 *
 * `fetchPolicy.test.ts` proves the predicate refuses an excluded site, and
 * `excludedSites.test.ts` proves the list survives a round-trip through a fake `chrome.storage`.
 * Neither says the worker actually *reads* that storage on the path a drag takes — the one place
 * the two halves meet is `checkFrameability`, in the real worker, against real storage.
 *
 * What this still cannot cover is the other half of the feature: `excludeMatches` keeping the
 * script out of the page. Under the substituted manifest the script is declared statically and
 * `syncContentScriptRegistration` returns early by design, so there is nothing here to observe.
 * `contentScriptRegistration.test.ts` holds that half, and `e2e/MANUAL.md` holds the rest.
 */
describe('a site the reader turned Piko off on', () => {
  const excludedSitesInStorage = async (hosts: string[]): Promise<void> => {
    const [worker] = context.serviceWorkers()
    await worker!.evaluate(
      (value) => chrome.storage.local.set({ 'piko.excludedSites': value }),
      hosts,
    )
  }

  it('refuses the fetch, and says which entry refused it', async () => {
    // The fixtures are served from a loopback address, so excluding that host excludes every
    // link in them — which is what makes one entry enough to drive the whole path.
    await excludedSitesInStorage([new URL(base).hostname])

    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')

    await expect
      .poll(
        () => page.evaluate(`${SHADOW}.querySelector('.piko-error')?.textContent ?? null`),
        POLL,
      )
      .toBe(`Piko is turned off on ${new URL(base).hostname}.`)

    await page.close()
  })

  it('opens the same link once the reader lets Piko back on', async () => {
    // The other direction, and the reason it is worth a second test: a refusal that never lifts
    // would pass the test above just as well.
    await excludedSitesInStorage([])

    const page = await context.newPage()
    await page.goto(`${base}/`)
    await dragLink(page, 'article-link')
    await waitForReader(page)

    await page.close()
  })
})

/**
 * The page the install opens, and the way back to it.
 *
 * A page shown once at install and never again is a page nobody reads twice — so it is declared
 * as the extension's options page, which puts it on the icon's own right-click menu and on the
 * card at `chrome://extensions` for the cost of a manifest key. `openOptionsPage` is exactly what
 * Chrome calls when either of those is clicked, and it rejects outright when no options page is
 * declared, so driving the real API is what makes this an assertion about reachability rather
 * than about a string in a JSON file.
 *
 * Under the substituted manifest the host grant is already in place, which is the *other* state
 * this page has to render — the one a first install never shows and every later visit does.
 */
describe('the page the install opens', () => {
  /** Opens it the way Chrome does, and hands back the tab it landed in. */
  const openOptions = async (): Promise<Page> => {
    const [worker] = context.serviceWorkers()
    await worker!.evaluate(() => chrome.runtime.openOptionsPage())

    // The tab is found in the context rather than waited for as a `page` event: Playwright
    // attaches to a tab the browser opened on the extension's behalf, but does not announce it.
    const optionsPage = (): Page | undefined =>
      context.pages().find((open) => open.url().endsWith('/onboarding.html'))
    await expect.poll(() => optionsPage() !== undefined, POLL).toBe(true)

    const page = optionsPage()
    if (!page) throw new Error('the options page went away between finding it and using it')
    await page.waitForLoadState('load')
    return page
  }

  it('opens again through the options item, in the state a returning reader is in', async () => {
    const page = await openOptions()

    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.access), POLL)
      .toBe('granted')

    // `innerText` and not `textContent`: the heading holds both versions of itself and only one
    // of them is displayed, which is the whole of the mechanism worth checking here.
    const heading = () => page.evaluate(() => document.querySelector('h1')?.innerText.trim())
    expect(await heading()).toBe('Piko is allowed on the pages you read')
    expect(await page.locator('#grant').isDisabled()).toBe(true)

    // The asking state is the static default, so taking the attribute away is how the other half
    // of the pair gets checked — a rule that hid the wrong one would pass the assertion above.
    await page.evaluate(() => delete document.documentElement.dataset.access)
    expect(await heading()).toBe('Piko needs to be allowed on the pages you read')

    // Every picture the page carries — the logo, and the screenshots behind the folds, which are
    // opened first because a lazy image inside a closed `details` is never fetched. The build
    // copies these out of `public/` by hand, so a directory it stops copying breaks them here and
    // nowhere else: every other reader of those files is Chrome.
    await page.evaluate(() => {
      for (const fold of document.querySelectorAll('details')) fold.open = true
    })
    const broken = await page.evaluate(async () => {
      const images = [...document.images]
      await Promise.all(
        images.map(
          (image) =>
            new Promise((settled) => {
              if (image.complete) settled(null)
              image.onload = image.onerror = settled
            }),
        ),
      )
      return images.filter((image) => image.naturalWidth === 0).map((image) => image.currentSrc)
    })
    expect(broken).toEqual([])

    await page.close()
  })

  /**
   * The half `siteList.test.ts` cannot reach. That suite proves the rule about which rows carry a
   * control against a list handed to it; this proves the page reads the reader's actual list out
   * of `chrome.storage.local`, and that pressing the control puts it back — the round trip the
   * icon's menu can only make while the reader is standing on the site being repaired.
   */
  it('lists what the reader turned Piko off on, and gives it back', async () => {
    const [worker] = context.serviceWorkers()
    const stored = (): Promise<unknown> =>
      worker!.evaluate(async () => (await chrome.storage.local.get('piko.excludedSites'))['piko.excludedSites'])

    await worker!.evaluate(() =>
      chrome.storage.local.set({ 'piko.excludedSites': ['bank.example.test'] }),
    )

    const page = await openOptions()
    await expect.poll(() => page.locator('.site-undo').count(), POLL).toBe(1)
    expect(await page.locator('.site-host').first().textContent()).toBe('bank.example.test')

    await page.locator('.site-undo').click()

    // Storage first, then the row: the row is redrawn from the change event rather than from the
    // click, so a page that removed the row without the write landing would fail here and pass
    // the assertion below.
    await expect.poll(stored, POLL).toEqual([])
    await expect.poll(() => page.locator('.site-undo').count(), POLL).toBe(0)
    expect(await page.locator('.sites-empty').textContent()).toContain('have not turned Piko off')

    await page.close()
  })
})
