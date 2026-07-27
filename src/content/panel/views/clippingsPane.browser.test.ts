import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
function mountPane(items: readonly Clipping[], { here = null }: { here?: string | null } = {}) {
  host = document.createElement('div')
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = PANEL_STYLES
  shadow.appendChild(style)

  const store = createClippingsStore()
  for (const item of items) store.toggle(item)

  const pane = createClippingsPane(store, { onClose: () => {}, here: () => here })

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
    expect(row.getBoundingClientRect().height).toBeLessThan(chipHeight * 3.4)
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

/**
 * Everything in a bar that paints, whatever depth it sits at: the leaves, with an `<svg>`
 * counted whole rather than descended into.
 *
 * Leaves rather than a list of selectors, because the point of the rule below is that it holds
 * for controls nobody has added yet. A named list would have to be maintained by whoever adds
 * the next one, which is the maintenance the four bugs in this bar have already proven nobody
 * remembers to do.
 */
function paintedControls(bar: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = []
  const walk = (element: Element): void => {
    const children = element.tagName.toLowerCase() === 'svg' ? [] : [...element.children]
    if (children.length > 0) {
      for (const child of children) walk(child)
      return
    }
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) found.push(element as HTMLElement)
  }
  walk(bar)
  return found
}

/** Overlapping in both axes, past the subpixel slack that abutting boxes leave. */
function overlap(a: DOMRect, b: DOMRect): boolean {
  const across = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return across > 0.5 && down > 0.5
}

/** Every pair of controls that are drawn on top of each other, named for the failure message. */
function collisions(bar: HTMLElement): string[] {
  const controls = paintedControls(bar)
  const hits: string[] = []
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!.getBoundingClientRect()
      const b = controls[j]!.getBoundingClientRect()
      if (!overlap(a, b)) continue
      const name = (el: HTMLElement) => el.textContent?.trim() || el.className || el.tagName
      const by = Math.round(Math.min(a.right, b.right) - Math.max(a.left, b.left))
      hits.push(`${name(controls[i]!)} / ${name(controls[j]!)} overlap by ${by}px`)
    }
  }
  return hits
}

describe('the header under real layout', () => {
  /**
   * Applying a filter puts a Show all button on the header row, and the row must not move when
   * it appears. It did: the heading group grew to the button's height, the header re-centred it,
   * and the title jumped 3px at the exact moment the reader clicked something.
   */
  it('does not shift when Show all joins the row', async () => {
    const { shadow } = mountPane(MANY)
    const title = shadow.querySelector<HTMLElement>('.piko-clips-title')!
    const header = shadow.querySelector<HTMLElement>('.piko-clips-header')!

    const before = { title: title.getBoundingClientRect().top, header: header.getBoundingClientRect().height }

    const chip = shadow.querySelector<HTMLButtonElement>('.piko-chip:not(.piko-chip-reset)')!
    await act(() => chip.click())

    // Guards the fixture: no button, no shift to detect.
    expect(shadow.querySelector('.piko-chip-reset')).not.toBeNull()
    expect(title.getBoundingClientRect().top).toBe(before.title)
    expect(header.getBoundingClientRect().height).toBe(before.header)
  })

  /**
   * The fullest this bar ever gets, in the 300px the pane actually has: every icon showing, and
   * Show all in the leading group beside the title. The trailing group has grown twice since the
   * alignment bugs that produced `.piko-bar`, and the width it needs is the sum of controls
   * nobody adds all at once — so the case is constructed rather than waited for.
   */
  it('holds every control on one line at the width the pane really has', async () => {
    const { shadow } = mountPane(MANY, { here: SOURCE })

    await act(() => shadow.querySelector<HTMLButtonElement>('.piko-clips-find')!.click())
    await act(() =>
      shadow.querySelector<HTMLButtonElement>('.piko-chip:not(.piko-chip-reset)')!.click(),
    )

    // Guards the fixture: this proves nothing if the controls it is about are not all present.
    expect(shadow.querySelectorAll('.piko-clips-actions .piko-icon-button')).toHaveLength(5)
    expect(shadow.querySelector('.piko-chip-reset')).not.toBeNull()

    const header = shadow.querySelector<HTMLElement>('.piko-clips-header')!
    const lead = shadow.querySelector<HTMLElement>('.piko-bar-lead')!
    const trail = shadow.querySelector<HTMLElement>('.piko-bar-trail')!

    // Nothing has been pushed out of the bar, and the two groups have not run into each other.
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth)
    expect(trail.getBoundingClientRect().right).toBeLessThanOrEqual(
      header.getBoundingClientRect().right,
    )
    expect(lead.getBoundingClientRect().right).toBeLessThanOrEqual(
      trail.getBoundingClientRect().left,
    )

    /*
      And the two that actually bite, because only the leading group shrinks. A trailing group
      that outgrows the bar takes the width out of the LEAD, which collapses to zero and lets its
      title and count render outside their own box — straight across the buttons. Measured at a
      forced width: the group reports `width: 0` while its contents still want 110px, and the
      title's right edge lands 58px past where the trailing group starts.

      Every edge-based check misses that. The header does not overflow (the lead gave up its
      width), the groups do not intersect (a zero-width box sits left of everything), and the
      title is not clipped (nothing declares `overflow: hidden`, so it simply spills). The
      question that catches it is whether the leading group has room for what is inside it.
    */
    const title = shadow.querySelector<HTMLElement>('.piko-clips-title')!
    expect(lead.scrollWidth).toBeLessThanOrEqual(lead.clientWidth)
    expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(
      trail.getBoundingClientRect().left,
    )
  })

  /**
   * The one law, after four alignment bugs in this bar: no two controls in it may be drawn on
   * top of each other.
   *
   * The checks above are the same rule asked of named pairs, one group at a time, and that is
   * why they kept missing the next recurrence. This one found the fourth: with a filter on, the
   * heading group has room for its own two children (`scrollWidth === clientWidth`, so every
   * edge-based check above passes), and *inside* it the label was shrunk to 72px around content
   * that wanted 103px. Nothing declares `overflow: hidden`, so the count spilled 31px past its
   * own right edge and landed under Show all, 23px of it — the header read `CLIPPINGS 3/1Show
   * all`.
   *
   * Asking it of the leaves is what makes it survive the next control: a group can always give
   * its width away, but two things that paint cannot occupy one place.
   */
  it('never draws two of its controls on top of each other', async () => {
    const { shadow } = mountPane(MANY, { here: SOURCE })

    await act(() => shadow.querySelector<HTMLButtonElement>('.piko-clips-find')!.click())
    await act(() => shadow.querySelector<HTMLButtonElement>('.piko-clips-here')!.click())

    const header = shadow.querySelector<HTMLElement>('.piko-clips-header')!

    // Guards the fixture: the collision only exists once Show all is on the row beside the
    // count, and a bar without it would pass this while proving nothing.
    expect(shadow.querySelector('.piko-chip-reset')).not.toBeNull()
    expect(shadow.querySelectorAll('.piko-clips-actions .piko-icon-button')).toHaveLength(5)
    expect(paintedControls(header).length).toBeGreaterThan(5)

    expect(collisions(header)).toEqual([])
  })
})

describe('the span markers under real layout', () => {
  afterEach(() => vi.useRealTimers())

  it('never sets a label taller than the row it stands in', () => {
    const DAY = 86_400_000
    // Pinned, because the labels past a month ARE the calendar: which month ninety days back
    // falls in, and whether four hundred days back is a different year, both move with the date.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 26, 12, 0, 0))
    const now = Date.now()

    // One source in each span, so every label renders — including the longest a band can now
    // produce. That used to be `Older`; it is a four-digit year, which is what this measures.
    const spread = [0, 3, 20, 90, 400].map((days, i) =>
      clip(`From ${i}.`, `https://example.com/${i}`, now - days * DAY),
    )
    const { shadow } = mountPane(spread)

    const markers = [...shadow.querySelectorAll<HTMLElement>('.piko-chip-band')]
    expect(markers.map((m) => m.textContent)).toEqual([
      'Today',
      'Week',
      'Month',
      'Apr',
      '2025',
    ])

    /**
     * How tall an element wants to be, measured from a free copy of it.
     *
     * Both the rendered box and `scrollHeight` lie here, in opposite directions. A marker is a
     * flex item that shrinks below its content, so it reports the squashed height as though it
     * fit. The chips meanwhile are stretched by whatever the tallest marker forced the row to,
     * so measuring a rendered chip as "one row" would be measuring the very problem. A clone
     * with its height released is what actually answers the question.
     */
    const naturalHeight = (element: HTMLElement): number => {
      const probe = element.cloneNode(true) as HTMLElement
      probe.style.cssText = 'position:absolute;visibility:hidden;height:auto;align-self:auto;'
      element.parentElement!.appendChild(probe)
      const height = probe.getBoundingClientRect().height
      probe.remove()
      return height
    }

    const twoRows = naturalHeight(shadow.querySelector<HTMLElement>('.piko-chip')!) * 2

    // Set vertically, a label's length is its height — and it stands in a row two chips tall.
    // Longer than that and it is squashed where the row is full, and stretches the row and
    // every chip in it where it is not.
    for (const marker of markers) {
      expect(naturalHeight(marker)).toBeLessThanOrEqual(twoRows)
    }
  })
})

