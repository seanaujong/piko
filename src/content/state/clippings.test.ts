import { describe, expect, it } from 'vitest'
import type { Clipping, ClippingsStorage } from './clippings'
import {
  createClippingsStore,
  ageBandOf,
  gapBefore,
  SESSION_GAP_MS,
  sessionsOf,
  sourcesInSessionOrder,
  visibleClippings,
} from './clippings'

/** Refuses every write the way a full quota does, until told to stop. */
const refusingStorage = (): ClippingsStorage & { allow: () => void } => {
  let refusing = true
  return {
    get: (onLoaded) => onLoaded(undefined),
    set: () =>
      refusing ? Promise.reject(new Error('QUOTA_BYTES quota exceeded')) : Promise.resolve(),
    allow: () => {
      refusing = false
    },
  }
}

/** Stands in for an extension that has gone out from under an already-open tab. */
const noExtension: ClippingsStorage = {
  get: () => {
    throw new Error('Extension context invalidated.')
  },
  set: () => {
    throw new Error('Extension context invalidated.')
  },
}

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

describe('the store', () => {
  /**
   * Every reader of the journal is a projection over `all()`, so what the store hands out has
   * to be a snapshot of one moment rather than a live view onto its working array. A caller
   * that holds a reference across a change and sees it rewrite itself has no way to tell that
   * anything happened — which is precisely what a UI needs to know.
   */
  it('hands out a new array on every change, leaving earlier snapshots alone', () => {
    const store = createClippingsStore()
    store.toggle(clip('First.', ENCYCLOPEDIA, T0))

    const snapshot = store.all()
    store.toggle(clip('Second.', ENCYCLOPEDIA, T0 + 60_000))

    expect(store.all()).not.toBe(snapshot)
    expect(snapshot.map((c) => c.text)).toEqual(['First.'])
    expect(store.all().map((c) => c.text)).toEqual(['First.', 'Second.'])
  })

  it('leaves an earlier snapshot alone when a clipping is removed', () => {
    const store = createClippingsStore()
    const first = clip('First.', ENCYCLOPEDIA, T0)
    store.toggle(first)
    store.toggle(clip('Second.', ENCYCLOPEDIA, T0 + 60_000))

    const snapshot = store.all()
    store.toggle(first) // toggling an existing clipping removes it

    expect(snapshot).toHaveLength(2)
    expect(store.all()).toHaveLength(1)
  })

  it('notifies subscribers, and stops once they unsubscribe', () => {
    const store = createClippingsStore()
    let notifications = 0
    const unsubscribe = store.subscribe(() => (notifications += 1))

    store.toggle(clip('First.', ENCYCLOPEDIA, T0))
    expect(notifications).toBe(1)

    unsubscribe()
    store.toggle(clip('Second.', ENCYCLOPEDIA, T0 + 60_000))
    expect(notifications).toBe(1)
  })

  /**
   * A write that does not land has to be sayable, and the reason it was not is the shape of the
   * failure rather than any missing intent: a full quota comes back as a rejected promise, not
   * as a throw, so the `void` in front of the call discarded it. Clipping went on looking exactly
   * as it does when everything is saved, into a journal that would be empty on the next load.
   */
  describe('a write that does not land', () => {
    it('is reported, and announced to whoever is watching', async () => {
      const store = createClippingsStore(refusingStorage())
      let notifications = 0
      store.subscribe(() => (notifications += 1))

      store.toggle(clip('First.', ENCYCLOPEDIA, T0))
      // The clipping is in hand immediately; the refusal arrives a microtask later.
      expect(store.storageError()).toBeNull()
      expect(notifications).toBe(1)

      await Promise.resolve()

      expect(store.storageError()).toContain('full')
      // The second notification is what gets the warning on screen at the moment it becomes true.
      expect(notifications).toBe(2)
      // And the clipping is still here — the in-memory copy stays authoritative for this page.
      expect(store.all()).toHaveLength(1)
    })

    it('clears once a later write lands', async () => {
      const storage = refusingStorage()
      const store = createClippingsStore(storage)
      store.toggle(clip('First.', ENCYCLOPEDIA, T0))
      await Promise.resolve()
      expect(store.storageError()).not.toBeNull()

      storage.allow()
      store.toggle(clip('Second.', ENCYCLOPEDIA, T0 + 60_000))

      expect(store.storageError()).toBeNull()
    })

    /**
     * The other route, and the one that always threw: after an extension reload an already-open
     * tab runs a content script whose `chrome` is gone. Clipping still works for the life of the
     * page and none of it is being saved, so the reader is told to refresh.
     */
    it('says so when the extension has gone out from under the page', () => {
      const store = createClippingsStore(noExtension)
      store.toggle(clip('First.', ENCYCLOPEDIA, T0))

      expect(store.storageError()).toContain('Refresh')
    })
  })

  /**
   * A note that grew. The page decides what it grew into; the journal decides what that costs
   * the notes it swallowed and what time the survivor carries.
   */
  describe('extending a note', () => {
    it('puts the grown note in and takes the swallowed ones out', () => {
      const store = createClippingsStore()
      store.toggle(clip('First.', ENCYCLOPEDIA, T0))
      store.toggle(clip('Elsewhere.', CHEMISTRY, T0 + 1_000))

      store.extend(clip('First. Second.', ENCYCLOPEDIA, T0 + 2_000), new Set(['First.']))

      expect(store.all().map((c) => c.text)).toEqual(['Elsewhere.', 'First. Second.'])
    })

    /**
     * Extending is an edit to a note already taken, so the journal keeps saying when it was
     * taken. A note that jumped to the top of the list on every added sentence would be a
     * record of fiddling rather than of reading — and would leave the sitting it belongs to.
     */
    it('keeps the earliest time it has ever had', () => {
      const store = createClippingsStore()
      store.toggle(clip('First.', ENCYCLOPEDIA, T0))

      store.extend(clip('First. Second.', ENCYCLOPEDIA, T0 + 90_000), new Set(['First.']))

      expect(store.all()[0]!.at).toBe(T0)
    })

    it('starts a fresh note at the time it was taken when it swallowed nothing', () => {
      const store = createClippingsStore()

      store.extend(clip('First.', ENCYCLOPEDIA, T0), new Set())

      expect(store.all()[0]!.at).toBe(T0)
    })

    /** The same sentence on two pages is two notes; only this page's are swallowed. */
    it('leaves an identical sentence on another page alone', () => {
      const store = createClippingsStore()
      store.toggle(clip('First.', ENCYCLOPEDIA, T0))
      store.toggle(clip('First.', CHEMISTRY, T0 + 1_000))

      store.extend(clip('First. Second.', ENCYCLOPEDIA, T0 + 2_000), new Set(['First.']))

      expect(store.all().map((c) => `${c.text} @ ${c.sourceUrl}`)).toEqual([
        `First. @ ${CHEMISTRY}`,
        `First. Second. @ ${ENCYCLOPEDIA}`,
      ])
    })

    /**
     * One page can say the same thing in two paragraphs, so a note grown in one can arrive
     * spelling a text the journal already holds from the other. Two clippings that are `isSame`
     * as each other would make removing either one remove the wrong one.
     */
    it('does not leave a duplicate of the grown note behind', () => {
      const store = createClippingsStore()
      store.toggle(clip('First. Second.', ENCYCLOPEDIA, T0))

      store.extend(clip('First. Second.', ENCYCLOPEDIA, T0 + 5_000), new Set(['Second.']))

      expect(store.all().map((c) => c.text)).toEqual(['First. Second.'])
      expect(store.all()[0]!.at).toBe(T0)
    })

    /**
     * One write, not an add and a remove. Two would be two notifications, so the pane would
     * redraw once against a journal holding neither the old note nor the new one.
     */
    it('notifies once', () => {
      const store = createClippingsStore()
      store.toggle(clip('First.', ENCYCLOPEDIA, T0))

      let notifications = 0
      store.subscribe(() => (notifications += 1))
      store.extend(clip('First. Second.', ENCYCLOPEDIA, T0 + 1_000), new Set(['First.']))

      expect(notifications).toBe(1)
    })

    it('leaves an earlier snapshot alone', () => {
      const store = createClippingsStore()
      store.toggle(clip('First.', ENCYCLOPEDIA, T0))
      const snapshot = store.all()

      store.extend(clip('First. Second.', ENCYCLOPEDIA, T0 + 1_000), new Set(['First.']))

      expect(store.all()).not.toBe(snapshot)
      expect(snapshot.map((c) => c.text)).toEqual(['First.'])
    })

    /**
     * The reference-stability contract `ClipEntry` leans on: a row whose clipping did not
     * change must come through by identity, or every row in the journal re-renders whenever
     * one note grows.
     */
    it('hands untouched clippings back by reference', () => {
      const store = createClippingsStore()
      store.toggle(clip('Elsewhere.', CHEMISTRY, T0))
      store.toggle(clip('First.', ENCYCLOPEDIA, T0 + 1_000))
      const untouched = store.all()[0]!

      store.extend(clip('First. Second.', ENCYCLOPEDIA, T0 + 2_000), new Set(['First.']))

      expect(store.all()[0]).toBe(untouched)
    })
  })
})

/**
 * Two sittings: four clippings from one page in a long stretch yesterday, then a single one
 * from another page just now. Ordering by count and ordering by sitting disagree about this
 * journal, which is what makes it worth asserting on.
 */
const YESTERDAY = T0 - SESSION_GAP_MS * 3
const ACROSS_SITTINGS: Clipping[] = [
  clip('Now.', CHEMISTRY, T0),
  clip('Late.', ENCYCLOPEDIA, YESTERDAY),
  clip('Middle.', ENCYCLOPEDIA, YESTERDAY - 60_000),
  clip('Early.', ENCYCLOPEDIA, YESTERDAY - 120_000),
  clip('Earliest.', ENCYCLOPEDIA, YESTERDAY - 180_000),
]

describe('sessionsOf', () => {
  it('splits where a pause is long enough to read as a break', () => {
    const sessions = sessionsOf(ACROSS_SITTINGS)

    expect(sessions.map((s) => s.items.length)).toEqual([1, 4])
  })

  it('orders sittings newest first, and each sitting newest first inside', () => {
    const [newest, older] = sessionsOf(ACROSS_SITTINGS)

    expect(newest!.items.map((c) => c.text)).toEqual(['Now.'])
    expect(older!.items.map((c) => c.text)).toEqual(['Late.', 'Middle.', 'Early.', 'Earliest.'])
  })

  it('reports when each sitting began and ended', () => {
    const [, older] = sessionsOf(ACROSS_SITTINGS)

    expect(older!.startedAt).toBe(YESTERDAY - 180_000)
    expect(older!.endedAt).toBe(YESTERDAY)
  })

  it('keeps one sitting together at exactly the threshold', () => {
    const items = [clip('Now.', CHEMISTRY, T0), clip('Earlier.', CHEMISTRY, T0 - SESSION_GAP_MS)]

    expect(sessionsOf(items)).toHaveLength(1)
  })

  it('has no sittings when there is nothing clipped', () => {
    expect(sessionsOf([])).toEqual([])
  })
})

describe('sourcesInSessionOrder', () => {
  it('counts each source once, with its title', () => {
    expect(sourcesInSessionOrder(ITEMS)).toEqual([
      {
        sourceUrl: ENCYCLOPEDIA,
        sourceTitle: 'Encyclopedia',
        count: 2,
        lastClippedAt: T0 - 60_000,
      },
      { sourceUrl: CHEMISTRY, sourceTitle: 'Chemical_energy', count: 1, lastClippedAt: T0 },
    ])
  })

  it('leads with the sitting the reader is in, not with the most-clipped source', () => {
    // The whole point of the ordering. Chemistry has a single clipping against Encyclopedia's
    // four, and still comes first, because it is the page being worked on now — a row ranked
    // by total count buries today's article under last week's.
    expect(sourcesInSessionOrder(ACROSS_SITTINGS).map((t) => [t.sourceTitle, t.count])).toEqual([
      ['Chemical_energy', 1],
      ['Encyclopedia', 4],
    ])
  })

  it('orders within one sitting by arrival, and holds that order as counts grow', () => {
    // Chips are click targets. Re-sorting by count inside a sitting slides them out from under
    // the cursor aiming at them, so within a sitting the order is the one the reader walked.
    const arrived = [
      clip('Second source, third clip.', CHEMISTRY, T0),
      clip('Second source, second clip.', CHEMISTRY, T0 - 30_000),
      clip('Second source, first clip.', CHEMISTRY, T0 - 60_000),
      clip('First source.', ENCYCLOPEDIA, T0 - 90_000),
    ]

    expect(sourcesInSessionOrder(arrived).map((t) => t.sourceTitle)).toEqual([
      'Encyclopedia',
      'Chemical_energy',
    ])
  })

  it('places a source by its most recent sitting, counting all of them', () => {
    const returned = [
      ...ACROSS_SITTINGS,
      // The reader comes back to Encyclopedia in the newest sitting, after Chemistry.
      clip('Back again.', ENCYCLOPEDIA, T0 + 60_000),
    ]

    expect(sourcesInSessionOrder(returned).map((t) => [t.sourceTitle, t.count])).toEqual([
      ['Chemical_energy', 1],
      ['Encyclopedia', 5],
    ])
  })

  it('is empty for no clippings, which is what hides the chip row', () => {
    expect(sourcesInSessionOrder([])).toEqual([])
  })
})

describe('visibleClippings', () => {
  it('shows everything when no source is selected', () => {
    expect(visibleClippings(ITEMS)).toEqual(ITEMS)
  })

  it('narrows to one source', () => {
    const visible = visibleClippings(ITEMS, { sources: new Set([ENCYCLOPEDIA]) })

    expect(visible.map((c) => c.text)).toEqual(['Second.', 'First.'])
  })

  it('composes selections rather than replacing them', () => {
    // The reason this is a filter set and not a grouping mode: two chips select the union.
    const visible = visibleClippings(ITEMS, { sources: new Set([ENCYCLOPEDIA, CHEMISTRY]) })

    expect(visible).toHaveLength(3)
  })

  it('narrows to the clippings holding the query, whatever its case', () => {
    const visible = visibleClippings(ITEMS, { query: 'SECOND' })

    expect(visible.map((c) => c.text)).toEqual(['Second.'])
  })

  it('searches the source title as well as the text', () => {
    // "Where did I read that" is as common a question as "what did it say".
    const visible = visibleClippings(ITEMS, { query: 'chemical' })

    expect(visible.map((c) => c.text)).toEqual(['Third.'])
  })

  it('intersects a query with a source selection rather than replacing it', () => {
    // Both narrowings answer different questions; a reader asking both means both.
    expect(visibleClippings(ITEMS, { sources: new Set([ENCYCLOPEDIA]), query: 'Third' })).toEqual([])
    expect(visibleClippings(ITEMS, { sources: new Set([CHEMISTRY]), query: 'Third' })).toHaveLength(1)
  })

  // ITEMS were all clipped within two minutes of T0, so forty days on they share one span —
  // which one is `ageBandOf`'s business and is pinned in its own tests, not restated here.
  const FORTY_DAYS_ON = T0 + 40 * 86_400_000
  const theirSpan = ageBandOf(T0, FORTY_DAYS_ON).key

  it('narrows to one span of time, measured against the moment it is given', () => {
    expect(visibleClippings(ITEMS, { band: theirSpan, now: FORTY_DAYS_ON })).toHaveLength(3)
    expect(visibleClippings(ITEMS, { band: 'today', now: FORTY_DAYS_ON })).toEqual([])
  })

  it('intersects a span with the other narrowings', () => {
    const now = FORTY_DAYS_ON

    expect(visibleClippings(ITEMS, { band: theirSpan, now, query: 'Second' })).toHaveLength(1)
    expect(visibleClippings(ITEMS, { band: 'today', now, query: 'Second' })).toEqual([])
  })

  it('ignores a query that is only whitespace', () => {
    // A field the reader has cleared back to spaces must not read as "nothing matches".
    expect(visibleClippings(ITEMS, { query: '   ' })).toHaveLength(3)
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

describe('ageBandOf', () => {
  // A fixed wall-clock moment, so "today" means the same thing whenever the suite runs.
  const NOON = new Date(2026, 6, 25, 12, 0, 0).getTime()
  const daysBefore = (days: number, hour = 12): number =>
    new Date(2026, 6, 25 - days, hour, 0, 0).getTime()

  const keyAt = (at: number, now = NOON): string => ageBandOf(at, now).key
  const labelAt = (at: number, now = NOON): string => ageBandOf(at, now).label

  it('counts calendar days, not elapsed hours', () => {
    // Eleven last night is yesterday at nine this morning, thirteen hours later — the words
    // describe the calendar, and an elapsed-hours rule would call this one "today".
    const lateLastNight = new Date(2026, 6, 24, 23, 0, 0).getTime()
    const thisMorning = new Date(2026, 6, 25, 9, 0, 0).getTime()

    expect(keyAt(lateLastNight, thisMorning)).toBe('week')
  })

  it('places a moment in the span a reader would name', () => {
    expect(keyAt(NOON)).toBe('today')
    expect(keyAt(daysBefore(1))).toBe('week')
    expect(keyAt(daysBefore(6))).toBe('week')
    expect(keyAt(daysBefore(7))).toBe('month')
    expect(keyAt(daysBefore(30))).toBe('month')
  })

  it('treats anything later than now as today rather than as the future', () => {
    // Clock skew between the machine that stored a clipping and the one reading it back is a
    // real possibility, and a negative day count must not fall through to the oldest band.
    expect(keyAt(NOON + 60_000)).toBe('today')
  })

  /**
   * Past a month the bands keep going, which is what a single unbounded `Older` could not do:
   * after a year of reading it held everything, so the marker meant to reach something old led
   * to one long scroll.
   */
  describe('past a month', () => {
    it('names the calendar month while still inside this year', () => {
      // 2026-07-25 less 31 days is 2026-06-24 — no longer "this month", still this year.
      expect(keyAt(daysBefore(31))).toBe('2026-06')
      expect(labelAt(daysBefore(31))).toBe('Jun')

      const january = new Date(2026, 0, 9, 12).getTime()
      expect(keyAt(january)).toBe('2026-01')
      expect(labelAt(january)).toBe('Jan')
    })

    it('drops to the year once it is a different one', () => {
      const lastAutumn = new Date(2025, 9, 2, 12).getTime()
      expect(keyAt(lastAutumn)).toBe('2025')
      expect(labelAt(lastAutumn)).toBe('2025')
      expect(keyAt(new Date(2024, 1, 2, 12).getTime())).toBe('2024')
    })

    /**
     * The chip row depends on this and nothing else enforces it: chips run newest-first, so a
     * band that did not decrease monotonically with time would open a second run somewhere down
     * the row and the same marker would appear twice.
     */
    it('gives an order that only ever moves further back', () => {
      const moments = [0, 1, 6, 7, 30, 31, 60, 200, 400, 900].map((days) => daysBefore(days))
      const keys = moments.map((at) => keyAt(at))

      // Each key is either the one before it or a new one, and no key ever comes back.
      expect(new Set(keys).size).toBe([...new Set(keys)].length)
      const firstSeen = keys.map((key) => keys.indexOf(key))
      expect(firstSeen).toEqual([...firstSeen].sort((a, b) => a - b))
    })

    /** Every label stays one short word — the row is two chips tall and set vertically. */
    it('labels every span in one short word', () => {
      const labels = [0, 3, 20, 40, 100, 200, 400, 800].map((days) => labelAt(daysBefore(days)))

      for (const label of labels) {
        expect(label).not.toContain(' ')
        expect(label.length).toBeLessThanOrEqual(5)
      }
    })
  })
})
