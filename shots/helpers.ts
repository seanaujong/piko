/**
 * Gesture and composition helpers shared by every `*.shots.ts` capture.
 *
 * Split out of `capture.shots.ts` once a second capture (`store.shots.ts`) needed the same real
 * gestures against the same real harness — arming the live-page surface, finding a sentence
 * worth pointing at, and settling the frame before a screenshot. Keeping one copy is the same
 * bargain `dragElement` already made in `e2e/harness.ts`: a picture of a gesture that happened
 * some other way is a picture of something no reader can reproduce.
 */
import type { Page } from 'playwright'

/**
 * The toolbar click, which no script can perform — the message it sends is what arms the page.
 *
 * Retried, because the content script arrives at `document_idle` and nothing in the page
 * announces it: Piko adds nothing until a gesture asks it to. So the message is its own
 * detector, and "receiving end does not exist" means not yet rather than not at all.
 */
export async function armClipping(page: Page, urlMatch: string): Promise<void> {
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
    }, urlMatch)

    if (armed) break
    if (attempt >= 60) throw new Error('the content script never reached the page')
    await page.waitForTimeout(250)
  }

  await page.waitForFunction(() =>
    [...document.documentElement.children].some((e) => e.shadowRoot?.querySelector('.piko-rail')),
  )
}

/** The first line of a substantial paragraph — where a reader's eye actually lands. */
async function pointOnSentence(
  page: Page,
  selector: string,
  inShadow: boolean,
): Promise<{ x: number; y: number }> {
  const target = inShadow
    ? selector
    : `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim().length > 200)`
  return (await page.evaluate(`(() => {
    const el = ${target}
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + 60, y: r.top + 10 }
  })()`)) as { x: number; y: number }
}

/** Rests the cursor on a sentence without clicking — the transient hover band, not a kept mark. */
export async function hoverSentenceIn(page: Page, selector: string, inShadow = false): Promise<void> {
  const point = await pointOnSentence(page, selector, inShadow)
  await page.mouse.move(point.x, point.y)
}

/** Clicks into the first line of a substantial paragraph, the way a reader picks a sentence. */
export async function clipSentenceIn(page: Page, selector: string, inShadow = false): Promise<void> {
  const point = await pointOnSentence(page, selector, inShadow)
  await page.mouse.move(point.x, point.y)
  await page.mouse.click(point.x, point.y)
}

/**
 * Composes the shot, once interacting is done.
 *
 * The cursor goes somewhere with no prose under it, because Piko paints a hover band wherever it
 * rests and a half-cut band at the edge of the frame is noise in a picture about the *kept* mark.
 * The scroll goes home for the same reason: `scrollIntoView` leaves the article's header sliced
 * through the middle, which reads as a broken capture. Every capture here targets the article's
 * first paragraph, so home is also where it stays in frame.
 *
 * Not for a picture of a *hover* itself — the painted band sits at the coordinates the hover was
 * computed at, and moving the cursor or the scroll afterward strands the band there while the
 * sentence moves out from under it. A hover shot waits in place instead; see `store.shots.ts`.
 */
export async function settle(page: Page): Promise<void> {
  await page.mouse.move(4, 4)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(700)
}
