import { describe, expect, it } from 'vitest'
import type { Clipping } from './clippings'
import { gapBefore, SESSION_GAP_MS, tallyBySource, toMarkdown, visibleClippings } from './clippings'

const T0 = 1_700_000_000_000

const clip = (text: string, sourceUrl: string, at: number, sourceTitle?: string): Clipping => ({
  text,
  sourceUrl,
  sourceTitle: sourceTitle ?? sourceUrl.split('/').pop() ?? sourceUrl,
  originUrl: null,
  at,
})

/** Newest first, the order the pane renders. */
const ENCYCLOPEDIA = 'https://en.wikipedia.org/wiki/Encyclopedia'
const CHEMISTRY = 'https://en.wikipedia.org/wiki/Chemical_energy'

const ITEMS: Clipping[] = [
  clip('Third.', CHEMISTRY, T0),
  clip('Second.', ENCYCLOPEDIA, T0 - 60_000),
  clip('First.', ENCYCLOPEDIA, T0 - 120_000),
]

describe('tallyBySource', () => {
  it('counts each source once, with its title', () => {
    expect(tallyBySource(ITEMS)).toEqual([
      { sourceUrl: ENCYCLOPEDIA, sourceTitle: 'Encyclopedia', count: 2 },
      { sourceUrl: CHEMISTRY, sourceTitle: 'Chemical_energy', count: 1 },
    ])
  })

  it('puts the most-clipped source first, not the most recent', () => {
    // The chip row is an overview as well as a filter, so it leads with where the reader has
    // actually been working — even though the list below it is ordered by time.
    expect(tallyBySource(ITEMS).map((t) => t.count)).toEqual([2, 1])
  })

  it('is empty for no clippings, which is what hides the chip row', () => {
    expect(tallyBySource([])).toEqual([])
  })
})

describe('visibleClippings', () => {
  it('shows everything when no source is selected', () => {
    expect(visibleClippings(ITEMS, new Set())).toEqual(ITEMS)
  })

  it('narrows to one source', () => {
    const visible = visibleClippings(ITEMS, new Set([ENCYCLOPEDIA]))

    expect(visible.map((c) => c.text)).toEqual(['Second.', 'First.'])
  })

  it('composes selections rather than replacing them', () => {
    // The reason this is a filter set and not a grouping mode: two chips select the union.
    const visible = visibleClippings(ITEMS, new Set([ENCYCLOPEDIA, CHEMISTRY]))

    expect(visible).toHaveLength(3)
  })
})

describe('gapBefore', () => {
  it('reports nothing between clippings taken in one sitting', () => {
    expect(gapBefore(ITEMS, 1)).toBeNull()
  })

  it('reports the gap when a pause is long enough to read as a new sitting', () => {
    const items = [clip('Now.', CHEMISTRY, T0), clip('Ages ago.', CHEMISTRY, T0 - SESSION_GAP_MS * 2)]

    expect(gapBefore(items, 1)).toBe(SESSION_GAP_MS * 2)
  })

  it('does not report a divider above the first item', () => {
    expect(gapBefore(ITEMS, 0)).toBeNull()
  })

  it('treats exactly the threshold as the same sitting', () => {
    const items = [clip('Now.', CHEMISTRY, T0), clip('Earlier.', CHEMISTRY, T0 - SESSION_GAP_MS)]

    expect(gapBefore(items, 1)).toBeNull()
  })
})

describe('toMarkdown', () => {
  it('quotes each clipping and attributes it to its source', () => {
    // This string IS the copy feature — whether Chrome's clipboard accepts it is Chrome's
    // problem, so the payload is what earns a test.
    expect(toMarkdown([clip('A sentence.', ENCYCLOPEDIA, T0, 'Encyclopedia')])).toBe(
      `## Piko clippings\n\n> A sentence.\n>\n> — Encyclopedia · ${ENCYCLOPEDIA}\n`,
    )
  })

  it('separates multiple clippings with a blank line', () => {
    const markdown = toMarkdown(ITEMS)

    expect(markdown.match(/^> [A-Z]/gm)).toHaveLength(3)
    expect(markdown).toContain('\n\n> Second.')
  })
})
