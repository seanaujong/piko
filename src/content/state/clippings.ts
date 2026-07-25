/**
 * The clippings journal: one flat, time-ordered list of sentences the reader kept.
 *
 * Exactly one shape is stored. Grouping is not — filtering by source and the session
 * dividers are both derived at render time, so "show me this source" and "show me the whole
 * stream" are two reads of the same array rather than two things to keep in sync.
 *
 * Clicking a sentence never touches the clipboard. A clipboard holds one item and overwrites
 * whatever the reader already had in it, so it can't be the journal; it's the door out of one
 * (see `toMarkdown`).
 */

export type Clipping = {
  text: string
  /** Page the sentence lives on. */
  sourceUrl: string
  sourceTitle: string
  /**
   * Page the reader was on when they dragged the link, or null when they clipped directly.
   * Because clippings arrive through a drag, Piko knows both where a sentence lives and
   * where the reader was standing when they took it.
   */
  originUrl: string | null
  at: number
}

const STORAGE_KEY = 'piko.clippings'

/** A pause longer than this reads as a new sitting rather than the same one. */
export const SESSION_GAP_MS = 45 * 60_000

export type ClippingsStore = {
  all: () => readonly Clipping[]
  toggle: (clipping: Clipping) => void
  clear: () => void
  subscribe: (listener: () => void) => () => void
}

const isSame = (a: Clipping, b: Clipping): boolean =>
  a.sourceUrl === b.sourceUrl && a.text === b.text

export function createClippingsStore(): ClippingsStore {
  /**
   * Replaced wholesale on every change rather than mutated, so `all()` returns a snapshot of
   * one moment: a caller holding an earlier array keeps seeing exactly what it was handed.
   * That is what lets a reader tell two versions apart by identity alone, without the store
   * having to describe what changed. `readonly` is the enforcement — an in-place `push` or
   * `splice` here stops compiling.
   */
  let clippings: readonly Clipping[] = []
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  /**
   * Persistence is best-effort on purpose. After an extension reload an already-open tab keeps
   * running an orphaned content script whose `chrome.runtime` is gone; the reader should still
   * be able to clip for the rest of that page's life rather than hitting a thrown error.
   */
  const persist = (): void => {
    try {
      void chrome.storage?.local.set({ [STORAGE_KEY]: clippings })
    } catch {
      // In-memory copy remains authoritative for this page.
    }
  }

  try {
    void chrome.storage?.local.get(STORAGE_KEY, (stored) => {
      const loaded = stored?.[STORAGE_KEY]
      if (!Array.isArray(loaded) || loaded.length === 0) return
      // Anything already clipped this page wins over the stored copy it predates.
      const seen = clippings
      clippings = [
        ...(loaded as Clipping[]).filter((l) => !seen.some((c) => isSame(c, l))),
        ...seen,
      ].sort((a, b) => a.at - b.at)
      notify()
    })
  } catch {
    // No stored history available; start empty.
  }

  return {
    all: () => clippings,

    toggle(clipping) {
      const index = clippings.findIndex((c) => isSame(c, clipping))
      clippings =
        index >= 0
          ? [...clippings.slice(0, index), ...clippings.slice(index + 1)]
          : [...clippings, clipping]
      persist()
      notify()
    },

    clear() {
      clippings = []
      persist()
      notify()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// ---- derived views: pure functions over the stored array, nothing cached ----

export type SourceTally = { sourceUrl: string; sourceTitle: string; count: number }

/**
 * Whether two clippings adjacent in time belong to the same sitting.
 *
 * The one place the session rule lives. Both readers of it — the dividers inside the list and
 * the ordering of the source chips — ask this rather than comparing against `SESSION_GAP_MS`
 * themselves, so there is no second copy of the rule to drift.
 */
const sameSitting = (newer: Clipping, older: Clipping): boolean =>
  newer.at - older.at <= SESSION_GAP_MS

/** A run of clippings taken without a long enough pause to read as a break. */
export type Session = {
  /** Newest first, the order the pane renders in. */
  items: readonly Clipping[]
  startedAt: number
  endedAt: number
}

/**
 * The journal split into sittings, newest first.
 *
 * A research burst is a topic operationally, and unlike a topic it costs no hand-maintenance —
 * it falls straight out of the timestamps. Deriving the whole partition rather than only the
 * boundary between two neighbours is what lets more than one reader share the rule: the list's
 * dividers want the boundaries, the chip row wants the buckets.
 */
export function sessionsOf(clippings: readonly Clipping[]): Session[] {
  const newestFirst = [...clippings].sort((a, b) => b.at - a.at)
  const sessions: Session[] = []
  let sitting: Clipping[] = []

  const close = (): void => {
    if (sitting.length === 0) return
    sessions.push({
      items: sitting,
      startedAt: sitting[sitting.length - 1]!.at,
      endedAt: sitting[0]!.at,
    })
  }

  for (const clipping of newestFirst) {
    const previous = sitting[sitting.length - 1]
    if (previous && !sameSitting(previous, clipping)) {
      close()
      sitting = []
    }
    sitting.push(clipping)
  }
  close()

  return sessions
}

/**
 * Source chips, ordered by the sitting the reader last used each source in.
 *
 * They double as the overview — each carries its own count — and as the filter. Ordering them
 * by total count made the row answer "what have I clipped most, ever?", which buries the
 * article open right now under a page worked over last week. Ordering by bare recency answers
 * the right question but re-sorts on every clip, so chips slide out from under the cursor that
 * is aiming at them. Bucketing by sitting gets both: the sitting you are in leads, and inside
 * it chips sit in the order you first reached each source and stay put as you keep clipping.
 *
 * The count stays the total across the whole journal, not the count within the sitting — the
 * chip filters the journal, so a number describing anything narrower would be a lie about what
 * clicking it shows.
 */
export function sourcesInSessionOrder(clippings: readonly Clipping[]): SourceTally[] {
  const totals = new Map<string, SourceTally>()
  for (const clipping of clippings) {
    const existing = totals.get(clipping.sourceUrl)
    if (existing) existing.count += 1
    else
      totals.set(clipping.sourceUrl, {
        sourceUrl: clipping.sourceUrl,
        sourceTitle: clipping.sourceTitle,
        count: 1,
      })
  }

  const ordered: SourceTally[] = []
  const placed = new Set<string>()
  for (const session of sessionsOf(clippings)) {
    // Oldest first within the sitting: the order the reader arrived at each source.
    for (let index = session.items.length - 1; index >= 0; index -= 1) {
      const { sourceUrl } = session.items[index]!
      if (placed.has(sourceUrl)) continue
      placed.add(sourceUrl)
      ordered.push(totals.get(sourceUrl)!)
    }
  }
  return ordered
}

/** Newest first, narrowed to `sources` when that set is non-empty. */
export function visibleClippings(
  clippings: readonly Clipping[],
  sources: ReadonlySet<string>,
): Clipping[] {
  return clippings
    .filter((c) => sources.size === 0 || sources.has(c.sourceUrl))
    .sort((a, b) => b.at - a.at)
}

/**
 * Sessions are rendered as dividers inside the one chronological list rather than as a
 * separate grouping mode, so temporal structure stays visible without the list changing shape.
 *
 * Asks the same `sameSitting` question `sessionsOf` does, over whatever list is on screen —
 * which is the filtered one, so dividers describe the sitting structure of what the reader is
 * actually looking at rather than of the whole journal.
 */
export function gapBefore(items: readonly Clipping[], index: number): number | null {
  const previous = items[index - 1]
  const current = items[index]
  if (!previous || !current) return null
  return sameSitting(previous, current) ? null : previous.at - current.at
}

export function toMarkdown(items: readonly Clipping[]): string {
  const body = items
    .map((c) => `> ${c.text}\n>\n> — ${c.sourceTitle} · ${c.sourceUrl}`)
    .join('\n\n')
  return `## Piko clippings\n\n${body}\n`
}
