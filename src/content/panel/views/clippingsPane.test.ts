import { act } from 'preact/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Clipping } from '../../state/clippings'
import { createClippingsStore } from '../../state/clippings'
import { createClippingsPane } from './clippingsPane'

/**
 * The pane rebuilds itself from the store on every change, so the question these tests ask is
 * not "does it show the right things" — the projections in `clippings.test.ts` already cover
 * that — but "does it keep the DOM nodes it already had".
 *
 * That distinction is the whole reason the pane is worth a test. A node that survives a
 * re-render carries the reader's live UI state with it: keyboard focus, scroll offset, and any
 * in-flight confirmation flash. A node that gets replaced silently drops all three.
 */

const T0 = 1_700_000_000_000

const ENCYCLOPEDIA = 'https://en.wikipedia.org/wiki/Encyclopedia'
const CHEMISTRY = 'https://en.wikipedia.org/wiki/Chemical_energy'

const clip = (text: string, sourceUrl: string, at: number): Clipping => ({
  text,
  sourceUrl,
  sourceTitle: sourceUrl.split('/').pop() ?? sourceUrl,
  originUrl: null,
  at,
})

/** Two sources, because a single source renders no chip row at all (see `renderFilters`). */
function paneWithTwoSources() {
  const store = createClippingsStore()
  store.toggle(clip('First.', ENCYCLOPEDIA, T0 - 120_000))
  store.toggle(clip('Second.', ENCYCLOPEDIA, T0 - 60_000))
  store.toggle(clip('Third.', CHEMISTRY, T0))

  const pane = createClippingsPane(store)
  // Focus only moves for elements that are actually in the document.
  document.body.appendChild(pane.root)
  return { store, pane }
}

/** Source chips only — the "Show all" reset shares the class but is not one of them. */
const chips = (pane: { root: HTMLElement }): HTMLButtonElement[] => [
  ...pane.root.querySelectorAll<HTMLButtonElement>('.piko-chip:not(.piko-chip-reset)'),
]

const entries = (pane: { root: HTMLElement }): HTMLElement[] => [
  ...pane.root.querySelectorAll<HTMLElement>('.piko-clip'),
]

/**
 * Applies a change and waits for the pane to have finished redrawing.
 *
 * A synchronous pane needs none of this. A batched one defers its redraw to a microtask, and
 * without the flush every assertion below would read the DOM *before* the redraw — so the
 * node-identity checks would pass by looking at nodes nothing had touched yet.
 */
const settle = (change: () => void): Promise<void> => act(change)

beforeEach(() => {
  document.body.replaceChildren()
})

describe('the chip row', () => {
  it('keeps keyboard focus on the chip that was just toggled', async () => {
    const { pane } = paneWithTwoSources()
    const chip = chips(pane)[0]!

    chip.focus()
    expect(document.activeElement).toBe(chip)

    await settle(() => chip.click())

    // Toggling a filter is a within-pane state change, so the control the reader is standing
    // on has to survive it. Rebuilding the row destroys the focused node and drops the
    // keyboard user back to the top of the document.
    expect(document.activeElement).toBe(chip)
  })

  it('marks the toggled chip as pressed and leaves the others unpressed', async () => {
    const { pane } = paneWithTwoSources()
    expect(chips(pane).map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false'])

    await settle(() => chips(pane)[0]!.click())

    // The unpressed chip keeps an explicit "false" rather than dropping the attribute — a chip
    // with no `aria-pressed` is announced as a plain button, not a toggle that happens to be off.
    expect(chips(pane).map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  })

  it('offers a reset only once a filter is active', async () => {
    const { pane } = paneWithTwoSources()
    expect(pane.root.querySelector('.piko-chip-reset')).toBeNull()

    await settle(() => chips(pane)[0]!.click())

    expect(pane.root.querySelector('.piko-chip-reset')).not.toBeNull()
  })
})

describe('the clippings list', () => {
  it('reuses the existing entry nodes when a new clipping arrives', async () => {
    const { store, pane } = paneWithTwoSources()
    const newestBefore = entries(pane)[0]!

    // Newer than everything else, so it lands at the top and pushes the rest down one slot.
    await settle(() => store.toggle(clip('Fourth.', CHEMISTRY, T0 + 60_000)))

    const after = entries(pane)
    expect(after).toHaveLength(4)
    // Same node, one row lower — not a look-alike rebuilt from the same data. Node identity is
    // what carries scroll position and an in-flight copy flash across the re-render.
    expect(after[1]).toBe(newestBefore)
  })

  it('drops only the removed entry when a clipping is deleted', async () => {
    const { store, pane } = paneWithTwoSources()
    const [newest, middle] = entries(pane)

    // Toggling an existing clipping removes it.
    await settle(() => store.toggle(clip('Third.', CHEMISTRY, T0)))

    const after = entries(pane)
    expect(after).toHaveLength(2)
    expect(after[0]).toBe(middle)
    expect(newest!.isConnected).toBe(false)
  })
})
