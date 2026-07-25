import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { Clipping } from '../../state/clippings'
import { createClippingsStore } from '../../state/clippings'
import { PANEL_STYLES } from '../styles'
import { createClippingsPane } from './clippingsPane'

/**
 * Real layout, in real Chrome, inside a real shadow root.
 *
 * Two things the jsdom suite next door cannot reach. Scrolling is the obvious one — jsdom gives
 * every element zero height, so a scroll assertion there is satisfied by a list that never
 * scrolled at all. Focus is the subtler one: `document.activeElement` reports the shadow *host*
 * from outside the tree, so checking focus inside the pane means asking the shadow root, and
 * that distinction only exists in a browser.
 */

const T0 = 1_700_000_000_000
const SOURCE = 'https://en.wikipedia.org/wiki/Encyclopedia'
const OTHER = 'https://en.wikipedia.org/wiki/Chemical_energy'

const clip = (text: string, sourceUrl: string, at: number): Clipping => ({
  text,
  sourceUrl,
  sourceTitle: sourceUrl.split('/').pop() ?? sourceUrl,
  originUrl: null,
  at,
})

/** Long enough to overflow a 320px-tall pane several times over. */
const MANY = Array.from({ length: 20 }, (_, i) =>
  clip(`Clipping number ${i} — long enough to wrap onto a second line in a narrow pane.`, i % 2 === 0 ? SOURCE : OTHER, T0 - i * 60_000),
)

let host: HTMLElement | null = null

/** Mounts the pane under the real stylesheet, in a box short enough to force scrolling. */
function mountPane(items: readonly Clipping[]) {
  host = document.createElement('div')
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = PANEL_STYLES
  shadow.appendChild(style)

  const store = createClippingsStore()
  for (const item of items) store.toggle(item)

  const pane = createClippingsPane(store, { onClose: () => {} })

  // Stands in for `.piko-body`, which is what gives the pane a bounded height to scroll within.
  const body = document.createElement('div')
  body.style.cssText = 'display:flex;height:320px;'
  body.appendChild(pane.root)
  shadow.appendChild(body)
  document.body.appendChild(host)

  const list = shadow.querySelector<HTMLElement>('.piko-clips-list')!
  return { shadow, store, pane, list }
}

afterEach(() => {
  host?.remove()
  host = null
})

describe('the clippings list under real layout', () => {
  /**
   * Not a property of keyed rendering: a wholesale `replaceChildren()` holds the scroll
   * position too, because Chrome restores scroll height before the next layout pass and never
   * observes the empty intermediate state. Worth pinning anyway — it is a real thing a reader
   * would notice losing, and only a browser can tell us whether it holds.
   */
  it('holds its scroll position when a clipping is added below the fold', async () => {
    const { store, list } = mountPane(MANY)

    // Guards the fixture: a list that fits entirely on screen cannot lose a scroll position,
    // so it would pass this test without exercising anything.
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)

    list.scrollTop = 200
    expect(list.scrollTop).toBe(200)

    // Older than everything present, so it lands at the bottom and nothing above it moves.
    await act(() => {
      store.toggle(clip('The oldest one.', SOURCE, T0 - 999 * 60_000))
    })

    expect(list.scrollTop).toBe(200)
  })

  /**
   * The chip row's height has to be bounded by something other than the number of sources.
   * After a research week thirty of them wrapped into a filter row taller than the list it
   * filters, which is the one thing a filter must never do.
   */
  it('holds the chip row to two rows however many sources there are', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      clip(`From source ${i}.`, `https://example.com/wiki/Source_number_${i}`, T0 - i * 60_000),
    )
    const { shadow } = mountPane(many)

    const row = shadow.querySelector<HTMLElement>('.piko-clips-chips')!
    const chip = shadow.querySelector<HTMLElement>('.piko-chip')!
    const chipHeight = chip.getBoundingClientRect().height

    // Guards the fixture: chips that never overflowed would satisfy the height bound by
    // fitting on one line, proving nothing about what happens when they don't.
    expect(shadow.querySelectorAll('.piko-chip:not(.piko-chip-reset)')).toHaveLength(30)
    expect(row.scrollWidth).toBeGreaterThan(row.clientWidth)

    // Two rows and the gap between them, with room for the scrollbar — and nowhere near the
    // eight-plus rows thirty chips wrap into.
    expect(chipHeight).toBeGreaterThan(0)
    expect(row.getBoundingClientRect().height).toBeLessThan(chipHeight * 2.8)
  })

  it('keeps focus inside the shadow root when a filter is toggled', async () => {
    const { shadow } = mountPane(MANY)
    const chip = shadow.querySelector<HTMLButtonElement>('.piko-chip:not(.piko-chip-reset)')!

    chip.focus()
    expect(shadow.activeElement).toBe(chip)

    await act(() => chip.click())

    expect(shadow.activeElement).toBe(chip)
  })
})
