import { options } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clipping } from '../../state/clippings'
import { createClippingsStore } from '../../state/clippings'
import { createClippingsPane, FLASH_MS } from './clippingsPane'

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

  const pane = createClippingsPane(store, { onClose: () => {}, here: () => null })
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

/** Copy sits before Remove in the actions row. */
const copyButtonOf = (entry: HTMLElement): HTMLButtonElement =>
  entry.querySelector<HTMLButtonElement>('.piko-clip-actions .piko-icon-button')!

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

afterEach(() => {
  vi.useRealTimers()
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

  /**
   * Timestamps here are relative to the real clock rather than to the suite's fixed `T0`,
   * because the pane reads `Date.now()` to decide which span a source falls in — a fixture
   * pinned to 2023 puts every chip in the same band and the row would render no rule at all.
   */
  describe('the rules between spans of time', () => {
    const DAY = 86_400_000

    const paneSpanning = (ages: readonly number[]) => {
      const now = Date.now()
      const store = createClippingsStore()
      ages.forEach((days, index) => {
        store.toggle(clip(`From ${index}.`, `https://example.com/${index}`, now - days * DAY))
      })
      const pane = createClippingsPane(store, { onClose: () => {}, here: () => null })
      document.body.appendChild(pane.root)
      return pane
    }

    const bands = (pane: { root: HTMLElement }): string[] =>
      [...pane.root.querySelectorAll('.piko-chip-band')].map((el) => el.textContent ?? '')

    it('marks every span the row passes through, the leading one included', () => {
      // The leading marker is what a plain separator would not need and a control does: without
      // it the span the reader is actually in is the one span they cannot select.
      const pane = paneSpanning([0, 3, 20, 90])

      expect(bands(pane)).toEqual(['Today', 'Week', 'Month', 'Older'])
    })

    it('marks the one span when every source falls inside it', () => {
      const pane = paneSpanning([0, 0])

      expect(bands(pane)).toEqual(['Today'])
    })

    it('marks a span once however many sources it holds', () => {
      const pane = paneSpanning([0, 40, 41, 42])

      expect(bands(pane)).toEqual(['Today', 'Older'])
    })

    it('narrows to a span when its marker is pressed, and back out when pressed again', async () => {
      const pane = paneSpanning([0, 40])
      const marker = (label: string): HTMLButtonElement =>
        [...pane.root.querySelectorAll<HTMLButtonElement>('.piko-chip-band')].find(
          (el) => el.textContent === label,
        )!

      expect(pane.root.querySelectorAll('.piko-clip')).toHaveLength(2)

      await settle(() => marker('Today').click())
      expect(pane.root.querySelectorAll('.piko-clip')).toHaveLength(1)
      expect(marker('Today').getAttribute('aria-pressed')).toBe('true')
      // The row now holds only the chosen span, so the marker pressed is the only one left —
      // and it must stay, because it is also the way back out.
      expect(bands(pane)).toEqual(['Today'])

      await settle(() => marker('Today').click())
      expect(pane.root.querySelectorAll('.piko-clip')).toHaveLength(2)
      expect(marker('Today').getAttribute('aria-pressed')).toBe('false')
      expect(bands(pane)).toEqual(['Today', 'Older'])
    })

    it('leaves only the chosen span in the row, so old sources need no scrolling to', async () => {
      // The answer to "that source is months back and the row is long": pressing the span
      // empties the row of everything newer rather than asking the reader to scroll past it.
      const pane = paneSpanning([0, 1, 40, 41])
      const chipTitles = (): string[] =>
        [...pane.root.querySelectorAll('.piko-chip:not(.piko-chip-reset) span:first-child')].map(
          (el) => el.textContent ?? '',
        )

      expect(chipTitles()).toHaveLength(4)

      await settle(() =>
        [...pane.root.querySelectorAll<HTMLButtonElement>('.piko-chip-band')]
          .find((el) => el.textContent === 'Older')!
          .click(),
      )

      // Only the two older sources remain, and the row now opens on them.
      expect(chipTitles()).toEqual(['2', '3'])
      expect(bands(pane)).toEqual(['Older'])
    })

    it('offers Show all once a span is selected, and clears it', async () => {
      const pane = paneSpanning([0, 40])
      expect(pane.root.querySelector('.piko-chip-reset')).toBeNull()

      await settle(() =>
        pane.root.querySelector<HTMLButtonElement>('.piko-chip-band')!.click(),
      )
      const reset = pane.root.querySelector<HTMLButtonElement>('.piko-chip-reset')!
      expect(reset).not.toBeNull()

      await settle(() => reset.click())
      expect(pane.root.querySelectorAll('.piko-clip')).toHaveLength(2)
    })
  })

  it('narrows the chips to the sources a search found, counting only its matches', async () => {
    const store = createClippingsStore()
    store.toggle(clip('Tides rise and fall.', ENCYCLOPEDIA, T0 - 120_000))
    store.toggle(clip('Something else entirely.', ENCYCLOPEDIA, T0 - 60_000))
    store.toggle(clip('Tides again, elsewhere.', CHEMISTRY, T0))
    store.toggle(clip('Nothing to do with it.', 'https://example.com/Third', T0 - 30_000))

    const pane = createClippingsPane(store, { onClose: () => {}, here: () => null })
    document.body.appendChild(pane.root)

    const labelled = (): string[] =>
      [...pane.root.querySelectorAll('.piko-chip:not(.piko-chip-reset)')].map((el) =>
        (el.textContent ?? '').trim(),
      )

    expect(labelled()).toHaveLength(3)

    await settle(() => pane.root.querySelector<HTMLButtonElement>('.piko-clips-find')!.click())
    const field = pane.root.querySelector<HTMLInputElement>('.piko-clips-search-field')!
    await settle(() => {
      field.value = 'tides'
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // The source with no match drops out, and the counts describe the matches rather than the
    // journal — a chip reading 2 next to a search for "tides" would be counting the wrong thing.
    expect(labelled()).toEqual(['Encyclopedia1', 'Chemical_energy1'])
  })

  describe('the page the reader is on', () => {
    const PAGE = 'https://en.wikipedia.org/wiki/Encyclopedia'
    const LINKED = 'https://en.wikipedia.org/wiki/Reference_work'
    const UNRELATED = 'https://example.com/elsewhere'

    /** Clipped on the page, clipped from a link dragged off it, and clipped somewhere else. */
    const paneOnPage = (here: string | null) => {
      const store = createClippingsStore()
      // One sitting, so the row's own order is arrival order — and the unrelated source
      // arrived first, which is what makes hoisting visible rather than a coincidence.
      store.toggle({
        ...clip('Nothing to do with it.', UNRELATED, T0 - 120_000),
        sourceTitle: 'Elsewhere',
      })
      store.toggle({
        ...clip('Through a link.', LINKED, T0 - 60_000),
        sourceTitle: 'Reference work',
        originUrl: PAGE,
      })
      store.toggle({ ...clip('On the page.', PAGE, T0), sourceTitle: 'Encyclopedia' })

      const pane = createClippingsPane(store, { onClose: () => {}, here: () => here })
      document.body.appendChild(pane.root)
      return pane
    }

    const titles = (pane: { root: HTMLElement }): string[] =>
      [...pane.root.querySelectorAll('.piko-chip:not(.piko-chip-reset) span:first-child')].map(
        (el) => el.textContent ?? '',
      )

    const markers = (pane: { root: HTMLElement }): string[] =>
      [...pane.root.querySelectorAll('.piko-chip-band')].map((el) => el.textContent ?? '')

    const scope = (pane: { root: HTMLElement }): HTMLButtonElement | null =>
      pane.root.querySelector<HTMLButtonElement>('.piko-clips-here')

    it('marks the page and what was dragged off it, leaving the row in time order', () => {
      // The order is untouched: pulling these to the front would put the same span on both
      // sides of another one, and the row's whole claim is that rightwards is backwards in time.
      const pane = paneOnPage(PAGE)

      expect(titles(pane)).toEqual(['Elsewhere', 'Reference work', 'Encyclopedia'])
      expect(
        [...pane.root.querySelectorAll('.piko-chip.is-here span:first-child')].map(
          (el) => el.textContent,
        ),
      ).toEqual(['Reference work', 'Encyclopedia'])
    })

    it('offers no scope at all when the reader is nowhere in particular', () => {
      const pane = paneOnPage(null)

      expect(scope(pane)).toBeNull()
      expect(pane.root.querySelectorAll('.piko-chip.is-here')).toHaveLength(0)
    })

    it('narrows to the page and its links when the scope is pressed', async () => {
      const pane = paneOnPage(PAGE)

      expect(pane.root.querySelectorAll('.piko-clip')).toHaveLength(3)

      await settle(() => scope(pane)!.click())
      expect(pane.root.querySelectorAll('.piko-clip')).toHaveLength(2)
      expect(scope(pane)!.getAttribute('aria-pressed')).toBe('true')

      await settle(() => scope(pane)!.click())
      expect(pane.root.querySelectorAll('.piko-clip')).toHaveLength(3)
    })
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

  it('keeps a copy confirmation showing when an unrelated clipping arrives', async () => {
    const { store, pane } = paneWithTwoSources()
    const copy = copyButtonOf(entries(pane)[0]!)
    const resting = copy.className

    await settle(() => copy.click())
    const confirming = copy.className
    expect(confirming).not.toBe(resting)

    // Older than everything present, so it appends below and the confirming entry keeps its slot.
    await settle(() => store.toggle(clip('Much earlier.', ENCYCLOPEDIA, T0 - 999_000)))

    // The confirmation belongs to the button, so replacing the button silently cancels it —
    // the reader sees the checkmark vanish the instant anything else in the journal changes.
    expect(copyButtonOf(entries(pane)[0]!)).toBe(copy)
    expect(copy.className).toBe(confirming)
  })

  it('clears a copy confirmation on its own after the flash', async () => {
    vi.useFakeTimers()
    const { pane } = paneWithTwoSources()
    const copy = copyButtonOf(entries(pane)[0]!)
    const resting = copy.className

    await settle(() => copy.click())
    expect(copy.className).not.toBe(resting)

    await settle(() => vi.advanceTimersByTime(FLASH_MS))

    expect(copy.className).toBe(resting)
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

/**
 * Drawing the list is linear in the whole journal unless the rows that did not change are
 * skipped, and nothing about that is visible in the rendered DOM — a row that re-renders to the
 * identical markup writes nothing. So the failure it guards against is silent: inline
 * `onRemove` back into the list, or give `ClipEntry` a prop that is rebuilt each render, and the
 * pane keeps working while quietly doing five times the work per clip.
 *
 * `options.diffed` is what makes it observable. Preact calls it for every vnode it visits, so
 * counting the ones belonging to a row's interior answers exactly the right question: was that
 * row's subtree walked, or stopped at?
 */
/**
 * Export is an archive, so it takes the whole journal — where every other control in this header
 * acts on what is currently on screen. The button says the number it will write, which is what
 * keeps the two readable side by side: the count reads "1/3" while the export still offers 3.
 *
 * Nothing in the rendered list can show this, since the narrowed list is exactly what export
 * ignores. The label is the only place the promise is visible, so the label is what is pinned.
 */
describe('what export offers', () => {
  const exportLabel = (pane: { root: HTMLElement }): string =>
    pane.root.querySelector('.piko-clips-export')?.getAttribute('aria-label') ?? ''

  it('offers the whole journal even while the list is narrowed', async () => {
    const { pane } = paneWithTwoSources()
    expect(exportLabel(pane)).toBe('Export all 3 clippings as Markdown')

    // Narrow to one source: the list drops to that source's clippings...
    await settle(() => chips(pane)[0]!.click())
    expect(entries(pane).length).toBeLessThan(3)

    // ...and the export still promises all three.
    expect(exportLabel(pane)).toBe('Export all 3 clippings as Markdown')
  })
})

describe('what a redraw visits', () => {
  /** Row interiors Preact walked while `body` ran. */
  async function rowsVisitedWhile(body: () => void | Promise<void>): Promise<number> {
    let visited = 0
    const previous = options.diffed
    // `.piko-clip-meta` rather than `.piko-clip` itself, because the row element is the one
    // vnode the parent always renders — it is the interior that a skipped row never reaches.
    options.diffed = (vnode) => {
      if ((vnode.props as { class?: string } | null)?.class === 'piko-clip-meta') visited += 1
      previous?.(vnode)
    }

    try {
      await body()
    } finally {
      options.diffed = previous
    }
    return visited
  }

  it('walks every row on the first paint', async () => {
    let rows = 0
    const visited = await rowsVisitedWhile(() => {
      rows = entries(paneWithTwoSources().pane).length
    })

    // The reference the skip is measured against, and what stops the next test from passing
    // because the counter never fires or the pane stopped drawing at all.
    expect(rows).toBe(3)
    expect(visited).toBe(3)
  })

  it('walks only the row that changed when a clipping is added', async () => {
    const { store } = paneWithTwoSources()

    const visited = await rowsVisitedWhile(() =>
      settle(() => store.toggle(clip('Fourth.', CHEMISTRY, T0 + 60_000))),
    )

    // The one row that mounted. The other three keep both of their props by reference, so
    // `shouldComponentUpdate` stops the walk before any of their elements is reached — where
    // an unstable `onRemove` would put all four back in the walk.
    expect(visited).toBe(1)
  })
})
