import { act } from 'preact/test-utils'
import { describe, expect, it } from 'vitest'
import type { Clipping } from '../../state/clippings'
import { createClippingsStore, SESSION_GAP_MS } from '../../state/clippings'
import { createClippingsPane } from './clippingsPane'
import { createClippingsPane as createVanillaPane } from './vanillaPane'

/**
 * Holds the Preact pane to the markup the vanilla one produced.
 *
 * "Does it still look right?" is the question a port like this is worst at answering, because
 * the honest check is a human squinting at two screenshots. It stops being a judgement call the
 * moment the rendered tree is treated as a value: `styles.ts` selects on classes and structure,
 * so identical markup *is* an identical appearance, and that is an equality assertion.
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

/** Covers both sources (so chips render) and a session gap (so a divider renders). */
const FIXTURE: readonly Clipping[] = [
  clip('An older sitting.', ENCYCLOPEDIA, T0 - SESSION_GAP_MS * 3),
  clip('First.', ENCYCLOPEDIA, T0 - 120_000),
  clip('Second.', ENCYCLOPEDIA, T0 - 60_000),
  clip('Third.', CHEMISTRY, T0),
]

function markupOf(
  build: typeof createClippingsPane,
  items: readonly Clipping[],
  after: (root: HTMLElement) => void = () => {},
): string {
  const store = createClippingsStore()
  for (const item of items) store.toggle(item)

  const pane = build(store)
  document.body.replaceChildren(pane.root)
  act(() => after(pane.root))

  return pane.root.outerHTML
}

const bothPanes = (items: readonly Clipping[], after?: (root: HTMLElement) => void) => ({
  vanilla: markupOf(createVanillaPane, items, after),
  preact: markupOf(createClippingsPane, items, after),
})

describe('markup parity with the vanilla pane', () => {
  it('renders the empty state identically', () => {
    const { vanilla, preact } = bothPanes([])

    expect(preact).toBe(vanilla)
  })

  it('renders a populated journal identically, dividers and chips included', () => {
    const { vanilla, preact } = bothPanes(FIXTURE)

    // Guards the fixture itself: a parity test over markup that has no chips and no divider
    // would pass while covering almost none of the pane.
    expect(vanilla).toContain('piko-clips-divider')
    expect(vanilla).toContain('piko-chip-count')
    expect(preact).toBe(vanilla)
  })

  it('renders an active source filter identically', () => {
    const clickFirstChip = (root: HTMLElement): void =>
      root.querySelector<HTMLButtonElement>('.piko-chip:not(.piko-chip-reset)')!.click()

    const { vanilla, preact } = bothPanes(FIXTURE, clickFirstChip)

    expect(vanilla).toContain('piko-chip-reset')
    expect(preact).toBe(vanilla)
  })
})
