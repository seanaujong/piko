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
  let clippings: Clipping[] = []
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
      clippings = [...(loaded as Clipping[]).filter((l) => !seen.some((c) => isSame(c, l))), ...seen]
      clippings.sort((a, b) => a.at - b.at)
      notify()
    })
  } catch {
    // No stored history available; start empty.
  }

  return {
    all: () => clippings,

    toggle(clipping) {
      const index = clippings.findIndex((c) => isSame(c, clipping))
      if (index >= 0) clippings.splice(index, 1)
      else clippings.push(clipping)
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

/** Source chips double as the overview — each carries its own count — and as the filter. */
export function tallyBySource(clippings: readonly Clipping[]): SourceTally[] {
  const tallies = new Map<string, SourceTally>()
  for (const clipping of clippings) {
    const existing = tallies.get(clipping.sourceUrl)
    if (existing) existing.count += 1
    else
      tallies.set(clipping.sourceUrl, {
        sourceUrl: clipping.sourceUrl,
        sourceTitle: clipping.sourceTitle,
        count: 1,
      })
  }
  return [...tallies.values()].sort((a, b) => b.count - a.count)
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
 * separate grouping mode, so temporal structure stays visible without the list changing
 * shape. A research burst is a topic operationally, and unlike a topic it costs no
 * hand-maintenance — it falls straight out of the timestamps.
 */
export function gapBefore(items: readonly Clipping[], index: number): number | null {
  const previous = items[index - 1]
  const current = items[index]
  if (!previous || !current) return null
  const gap = previous.at - current.at
  return gap > SESSION_GAP_MS ? gap : null
}

export function toMarkdown(items: readonly Clipping[]): string {
  const body = items
    .map((c) => `> ${c.text}\n>\n> — ${c.sourceTitle} · ${c.sourceUrl}`)
    .join('\n\n')
  return `## Piko clippings\n\n${body}\n`
}
