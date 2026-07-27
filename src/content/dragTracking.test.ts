import { describe, expect, it } from 'vitest'
import { startDragTracking } from './dragTracking'
import type { LinkTarget } from './state/previewState'

/**
 * What jsdom can and cannot say about a drag.
 *
 * Every event constructed from script is untrusted, and jsdom defines `isTrusted` as a
 * non-configurable getter with no setter — so this environment can express a *synthetic* drag
 * perfectly and a real one not at all. Forging the flag would only test the forgery.
 *
 * So the split is deliberate: the security property lives here, where an untrusted event is the
 * natural thing to make, and "a real drag still opens a preview" lives in `e2e/extension.test.ts`,
 * where Playwright drives actual input through Chrome. Neither suite can hold both halves.
 */
function synthesise(type: string, target: Element): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
}

describe('a drag the page synthesised', () => {
  it('is ignored, so a page cannot choose what the worker fetches', () => {
    // Revert the isTrusted guard in dragTracking.ts and this goes red: the tracker would report
    // a link the reader never touched, on an address the page picked, and the background worker
    // would fetch it from inside the reader's own network. See fetchPolicy.ts.
    const seen: LinkTarget[] = []
    startDragTracking((target) => seen.push(target))

    const anchor = document.createElement('a')
    anchor.href = 'http://192.168.1.1/'
    anchor.textContent = 'drag me to continue'
    document.body.appendChild(anchor)

    synthesise('dragstart', anchor)
    synthesise('dragend', anchor)

    expect(seen).toEqual([])
  })
})
