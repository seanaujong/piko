/**
 * What the journal's pane costs to draw, in real Chrome.
 *
 * The pane renders every clipping — there is no virtualization — and each row is around ten
 * elements. Whether that stops being reasonable at the sizes a long-lived journal reaches is
 * really two questions with different answers. Preact's keyed reconciliation makes an *update*
 * touch only the row that changed, so clipping a sentence should stay flat; the moments with no
 * such help are the ones that rebuild the whole list, which is opening the rail against a stored
 * journal and pressing a filter.
 *
 * Real Chrome, because the cost being asked about is layout — jsdom would build the same DOM,
 * lay none of it out, and report a number with the expensive half missing. Every sample
 * therefore ends by reading `scrollHeight` off the list, which forces the layout the browser
 * would otherwise defer until after the timer stopped. Paint is not included and cannot be: the
 * compositor skips rows outside the viewport, which is the very work virtualization would save.
 *
 * This prints rather than asserts, like the other benches. What it does assert is that the pane
 * it measured rendered the rows and narrowed the list — a fixture that quietly showed nothing
 * would report a very fast redraw of an empty list.
 */

import { render } from 'preact'
import { act } from 'preact/test-utils'
import { describe, expect, it } from 'vitest'
import { createClippingsPane } from '../src/content/panel/views/clippingsPane'
import { PANEL_STYLES } from '../src/content/panel/styles'
import type { Clipping } from '../src/content/state/clippings'
import {
  createClippingsStore,
  sourcesInSessionOrder,
  visibleClippings,
} from '../src/content/state/clippings'
import { syntheticArticle } from './article'
import { measure, ms, spread, table } from './report'

/** Journal sizes: a month of reading, a year of it, and past anything plausible. */
const SIZES = [100, 1_000, 5_000]
const RUNS = 7

/** Sentences long enough to wrap in a 300px pane, so the row heights are real. */
const article = syntheticArticle(220)

/** Clippings taken before the reader puts it down for a few hours. */
const PER_SITTING = 20
/** Pages worked over in one sitting — a research burst visits a handful, not a hundred. */
const SOURCES_PER_SITTING = 4
const WITHIN_SITTING_MS = 90_000
const SITTING_BREAK_MS = 3 * 3_600_000

/**
 * A journal of `count` clippings, shaped like one built over months of reading rather than one
 * long unbroken run.
 *
 * The breaks are load-bearing on both readers of the timestamps: they are what makes
 * `sessionsOf` return more than a single sitting — which is what orders the chip row — and what
 * spreads the sources far enough back for all four span markers to render. A journal generated
 * at one instant would measure a pane in a shape no reader ever has.
 *
 * Anchored to the current clock rather than a fixed epoch because `ageBandOf` is asked against
 * `Date.now()` inside the pane; anchored to a constant, every clipping would land in `older` and
 * the row would carry one marker.
 */
function journal(count: number, now: number): Clipping[] {
  let at = now
  return Array.from({ length: count }, (_, index) => {
    if (index > 0) at -= index % PER_SITTING === 0 ? SITTING_BREAK_MS : WITHIN_SITTING_MS
    const source =
      Math.floor(index / PER_SITTING) * SOURCES_PER_SITTING + (index % SOURCES_PER_SITTING)
    return {
      text: article.sentences[index % article.sentences.length]!,
      sourceUrl: `https://en.wikipedia.org/wiki/Article_${source}`,
      sourceTitle: `Article ${source}`,
      originUrl: null,
      at,
    }
  })
}

/**
 * The pane in the box it actually lives in: the rail's width, a bounded height, and the real
 * stylesheet inside a shadow root.
 *
 * All three matter. The list only scrolls because its height is bounded, the rules that bound it
 * are in the sheet, and a wider box would wrap the sentences onto fewer lines than a reader
 * sees. `.piko-rail` is absolutely positioned in the panel, so it is given a box here instead.
 */
function railFixture(): HTMLElement {
  const host = document.createElement('div')
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = PANEL_STYLES

  const rail = document.createElement('div')
  rail.className = 'piko-rail'
  rail.style.cssText = 'position: relative; height: 600px;'

  shadow.append(style, rail)
  document.body.replaceChildren(host)
  return rail
}

function storeOf(clippings: readonly Clipping[]) {
  const store = createClippingsStore()
  for (const clipping of clippings) store.toggle(clipping)
  return store
}

const mountPane = (store: ReturnType<typeof storeOf>, rail: HTMLElement) => {
  const pane = createClippingsPane(store, { onClose: () => {}, here: () => null })
  rail.appendChild(pane.root)
  return pane
}

const listIn = (root: HTMLElement): HTMLElement => {
  const list = root.querySelector<HTMLElement>('.piko-clips-list')
  if (!list) throw new Error('the pane rendered no list')
  return list
}

const rowsIn = (root: HTMLElement): number => root.querySelectorAll('.piko-clip').length

describe('opening the rail against a stored journal', () => {
  it('measures first paint at the sizes a long-lived journal reaches', () => {
    const rows: string[][] = []
    const now = Date.now()

    for (const count of SIZES) {
      const rail = railFixture()
      const store = storeOf(journal(count, now))

      const sample = measure(
        RUNS,
        () => void listIn(mountPane(store, rail).root).scrollHeight,
        () => {
          // Unmounted rather than only detached. A pane left mounted stays subscribed to the
          // store, so every later measurement would be redrawing all the earlier ones too.
          for (const child of [...rail.children]) {
            render(null, child)
            child.remove()
          }
        },
      )

      // Mounted once more, off the clock, to describe what was being drawn.
      const pane = mountPane(store, rail)
      const list = listIn(pane.root)

      // Guards the fixture, twice over: a pane that rendered fewer rows than the journal holds
      // would be timing a shorter list than the label claims, and one that fit inside its box
      // would be timing a layout with nothing scrolled out of view.
      expect(rowsIn(pane.root)).toBe(count)
      expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)

      rows.push([
        `${count} clippings`,
        String(pane.root.querySelectorAll('.piko-chip:not(.piko-chip-reset)').length),
        String(pane.root.querySelectorAll('*').length),
        spread(sample),
        ms(sample.median / count),
      ])
    }

    // A rail that takes longer than about 100ms to appear reads as a stall rather than as an
    // opening, which is the line these numbers are worth reading against.
    console.log(
      table(
        'first paint — the whole journal built and laid out, on opening the rail',
        ['journal', 'chips', 'DOM nodes', 'first paint', 'per clipping'],
        rows,
      ),
    )
  }, 300_000)
})

describe('redrawing an open pane', () => {
  it('measures a filter against the one clip that keying is for', () => {
    const rows: string[][] = []
    const now = Date.now()

    for (const count of SIZES) {
      const rail = railFixture()
      const clippings = journal(count, now)
      const store = storeOf(clippings)
      const pane = mountPane(store, rail)
      const list = listIn(pane.root)

      const chip = pane.root.querySelector<HTMLButtonElement>('.piko-chip:not(.piko-chip-reset)')
      if (!chip) throw new Error('the pane rendered no source chips to filter by')

      /**
       * One chip press, with the redraw it schedules flushed inside the timed window.
       *
       * `act` is what makes that true: a Preact state change is scheduled rather than applied,
       * so without it the timer would stop before any of the work happened and report a redraw
       * that costs nothing.
       */
      const press = (): void => {
        act(() => chip.click())
        void list.scrollHeight
      }

      // The case keyed reconciliation exists for: a fresh array from the store, every key
      // diffed, exactly one row inserted at the top.
      const addition: Clipping = {
        ...clippings[0]!,
        text: 'One more sentence, clipped just now.',
        at: now + 60_000,
      }
      const clip = (): void => {
        act(() => store.toggle(addition))
        void list.scrollHeight
      }

      // Guards the fixture. A chip that narrowed nothing, or an addition already present and so
      // toggled away, would both time a redraw of a list that never changed size.
      const whole = rowsIn(pane.root)
      press()
      expect(rowsIn(pane.root)).toBeLessThan(whole)
      press()
      clip()
      expect(rowsIn(pane.root)).toBe(whole + 1)
      clip()
      expect(rowsIn(pane.root)).toBe(whole)

      // Measured apart, and in that order, because they are not the same work: narrowing throws
      // almost every row away and restoring builds them all back. Each direction is undone off
      // the clock by pressing again, so every timed run starts from the same side.
      const narrowing = measure(RUNS, press, press)
      press()
      const restoring = measure(RUNS, press, press)
      press()

      const adding = measure(RUNS, clip, clip)

      rows.push([`${count} clippings`, spread(narrowing), spread(restoring), spread(adding)])
    }

    // 16.7ms is the frame these want to land inside: a filter is pressed, so the redraw is
    // between the reader's click and anything moving on screen.
    console.log(
      table(
        'redraws — every key diffed, however few rows actually change',
        ['journal', 'filter on', 'filter off', 'one clip added'],
        rows,
      ),
    )
  }, 300_000)
})

/**
 * The redraw numbers above are three costs added together — the projections the pane derives,
 * the vnodes Preact diffs, and the layout the browser redoes — and they have three different
 * fixes. Virtualization only touches the last two, so it is worth nothing if the first is where
 * the time goes. These are pure functions over the array, so they can be timed on their own.
 */
describe('what the pane derives on every render', () => {
  it('measures the projections separately from the drawing', () => {
    const rows: string[][] = []
    const now = Date.now()

    for (const count of SIZES) {
      const clippings = journal(count, now)

      // Exactly the two calls `Pane` makes per render: the list it shows, and the chip row's
      // input, which is a second pass over the same filtered array.
      const list = measure(RUNS, () => void visibleClippings(clippings, { query: '', band: null, now }))
      const chips = measure(
        RUNS,
        () => void sourcesInSessionOrder(visibleClippings(clippings, { query: '', band: null, now })),
      )

      rows.push([`${count} clippings`, spread(list), spread(chips), ms(chips.median / count)])
    }

    console.log(
      table(
        'projections — recomputed in full on every render, before a vnode is made',
        ['journal', 'visibleClippings', 'plus sourcesInSessionOrder', 'per clipping'],
        rows,
      ),
    )
  }, 300_000)
})
