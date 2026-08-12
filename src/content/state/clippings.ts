/**
 * The clippings journal: one flat, time-ordered list of sentences the reader kept.
 *
 * Exactly one shape is stored. Grouping is not — filtering by source and the session
 * dividers are both derived at render time, so "show me this source" and "show me the whole
 * stream" are two reads of the same array rather than two things to keep in sync.
 *
 * Clicking a sentence never touches the clipboard. A clipboard holds one item and overwrites
 * whatever the reader already had in it, so it can't be the journal; it's the door out of one,
 * taken a clipping at a time from the copy button on each row.
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
  /**
   * What went wrong the last time the journal was written, or null if it landed.
   *
   * Read through `subscribe` like everything else here: a failed write notifies, so a pane
   * showing the journal learns that it is no longer being saved at the moment it stops being
   * saved, rather than the next time something happens to redraw.
   */
  storageError: () => string | null
  toggle: (clipping: Clipping) => void
  /**
   * Record a note that grew, dropping the notes it swallowed — one write, one notification.
   *
   * `supersedes` names them by text, which is the currency between the page and the journal
   * everywhere else here too: the highlighter finds passages by text and the journal stores
   * them by text, so neither side has to hold a reference into the other. Only this source's
   * clippings are considered, because the same sentence on two pages is two notes.
   *
   * **The grown note keeps the earliest time it has ever had.** Extending is an edit to
   * something already taken, not a fresh taking, and `at` is what the journal answers "when
   * did I read this" with — a note that jumped to the top of the list every time the reader
   * added a sentence to it would be a record of fiddling rather than of reading. It also
   * keeps the sitting it was taken in, which is what the chip row is ordered by.
   *
   * An add and a remove would have done the same thing in two writes, and that is exactly
   * what this exists to avoid: two writes are two notifications, so the pane would redraw
   * once against a journal holding neither the old note nor the new one.
   */
  extend: (clipping: Clipping, supersedes: ReadonlySet<string>) => void
  clear: () => void
  subscribe: (listener: () => void) => () => void
}

/**
 * What a reader can actually do about a write that did not land, which is the only reason to
 * mention it at all. Both cases are recoverable and the recoveries are different.
 */
const QUOTA_FULL = 'The journal is full. Export it, then clear it to make room.'
const NO_EXTENSION = 'Piko was reloaded. Refresh this page to keep clipping.'

const isSame = (a: Clipping, b: Clipping): boolean =>
  a.sourceUrl === b.sourceUrl && a.text === b.text

/**
 * The one seam between the store's decision logic and `chrome.storage`. A store built with a
 * fake implementation of this never needs `vi.stubGlobal('chrome', ...)` — the fake's shape is
 * checked by the type system rather than hand-reconstructed in every test file that needs one.
 */
export type ClippingsStorage = {
  /** Calls `onLoaded` with whatever was previously stored, or throws if the extension is gone. */
  get: (onLoaded: (stored: unknown) => void) => void
  /** The returned promise rejects the way a full quota does; throws if the extension is gone. */
  set: (clippings: readonly Clipping[]) => Promise<void>
}

const chromeStorage: ClippingsStorage = {
  get(onLoaded) {
    chrome.storage.local.get(STORAGE_KEY, (stored) => onLoaded(stored?.[STORAGE_KEY]))
  },
  set(clippings) {
    return chrome.storage.local.set({ [STORAGE_KEY]: clippings })
  },
}

export function createClippingsStore(storage: ClippingsStorage = chromeStorage): ClippingsStore {
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

  let storageError: string | null = null

  /**
   * Persistence is best-effort on purpose. After an extension reload an already-open tab keeps
   * running an orphaned content script whose `chrome.runtime` is gone; the reader should still
   * be able to clip for the rest of that page's life rather than hitting a thrown error.
   *
   * Best-effort is not the same as unreported, and it used to be. The two ways this fails arrive
   * by different routes and only one of them is a throw: a missing extension throws right here,
   * while a full quota comes back as a REJECTED PROMISE — which `void` discarded, so the write
   * that silently dropped a clipping looked exactly like the write that saved it. The reader
   * then kept clipping into something that would be empty on the next load.
   */
  const persist = (): void => {
    storageError = null
    try {
      void storage.set(clippings).catch(() => {
        storageError = QUOTA_FULL
        notify()
      })
    } catch {
      // In-memory copy remains authoritative for this page.
      storageError = NO_EXTENSION
    }
  }

  try {
    storage.get((loaded) => {
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

    storageError: () => storageError,

    toggle(clipping) {
      const index = clippings.findIndex((c) => isSame(c, clipping))
      clippings =
        index >= 0
          ? [...clippings.slice(0, index), ...clippings.slice(index + 1)]
          : [...clippings, clipping]
      persist()
      notify()
    },

    extend(clipping, supersedes) {
      // The grown note's own identity counts as absorbed too. The same sentence can appear in
      // two blocks of one page, so a note grown in the first can arrive spelling a text the
      // journal already holds from the second — and two clippings `isSame` as each other
      // would make removing either of them remove the wrong one.
      const absorbed = (c: Clipping): boolean =>
        isSame(c, clipping) || (c.sourceUrl === clipping.sourceUrl && supersedes.has(c.text))

      let at = clipping.at
      for (const c of clippings) if (absorbed(c)) at = Math.min(at, c.at)

      clippings = [...clippings.filter((c) => !absorbed(c)), { ...clipping, at }]
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

export type SourceTally = {
  sourceUrl: string
  sourceTitle: string
  count: number
  /** The most recent clipping from this source — what places it in the row, and in time. */
  lastClippedAt: number
}

/**
 * How far back a source's most recent clipping is, in the terms a reader thinks in.
 *
 * Key and label are produced together by `ageBandOf` and never derived from one another, so
 * there is nothing to parse and no second table to keep in step. The key is compared, never
 * read; the label is read, never compared.
 */
export type AgeBand = {
  /** Stable identity — what the filter matches on and what marks a run in the chip row. */
  key: AgeBandKey
  /**
   * One short word. The markers are set vertically, where a label's length is its height, and
   * the row it stands in is only as tall as two chips: "This month" wanted around 60px against
   * the 46px available, so it was squashed wherever the row was full and stretched the row half
   * as tall again wherever it wasn't. A four-digit year is the longest this can now produce, and
   * the guard in `clippingsPane.browser.test.ts` is what says how much longer one may get.
   */
  label: string
}

/** What a chosen span is held as. Opaque on purpose: compare it, don't take it apart. */
export type AgeBandKey = string

const MONTH_LABEL = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * Sources that belong to the page the reader is looking at — either the clipping was taken
 * there, or it was taken from a link dragged out of it.
 *
 * Kept as a scope the reader turns on rather than as a reordering of the row. Hoisting these
 * to the front was the first attempt and it broke what the row is: chips run newest-first so
 * that reading rightwards is moving back in time, and pulling a source out of its place puts
 * the same span on both sides of another one. The row stays a timeline; this narrows it.
 *
 * Both relations count as "associated with this page", and both are recorded rather than guessed:
 * `originUrl` is where the reader was standing when they dragged, so the second relation is
 * the reading trail itself. The alternative — scanning the page's anchors for anything ever
 * clipped — was measured and rejected before: one Wikipedia article carries 2,695 of them, and
 * a link graph is not a record of where you have been.
 */
export function sourcesOnOrFrom(
  clippings: readonly Clipping[],
  page: string | null,
): ReadonlySet<string> {
  if (page === null) return new Set()
  return new Set(
    clippings
      .filter((c) => c.sourceUrl === page || c.originUrl === page)
      .map((c) => c.sourceUrl),
  )
}

const startOfDay = (at: number): number => {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Which band a moment falls in, relative to `now`.
 *
 * Counted in calendar days rather than elapsed hours, because that is what the words mean:
 * something clipped at eleven last night is "yesterday" at nine this morning, not "today",
 * however few hours have passed. Rounding the difference absorbs the hour that daylight saving
 * adds or removes.
 *
 * `now` is a parameter rather than a call to `Date.now()` inside, so the boundaries can be
 * tested at all — a function that reads the clock itself can only be tested at whatever time
 * the suite happens to run.
 *
 * **Past a month the bands keep subdividing**, by calendar month within this year and by year
 * before that, and that is the answer to a row that used to end in one unbounded `Older`. After
 * a year of reading, everything beyond a month landed in that single bucket, so the marker that
 * was supposed to be the way to somewhere old led to one long scroll — the control was intact
 * and the thing it addressed had outgrown it. More bands is the fix rather than a different
 * control, because the row is already a timeline and the row stays bounded on its own: a marker
 * only renders for a span that actually holds chips, so an empty August costs nothing.
 *
 * The order is total and matches time, which the chip row depends on — reading rightwards must
 * always be moving further back, or a span would open twice in one row. Each rule below covers
 * strictly older moments than the one above it.
 */
export function ageBandOf(at: number, now: number): AgeBand {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000)
  if (days <= 0) return { key: 'today', label: 'Today' }
  if (days < 7) return { key: 'week', label: 'Week' }
  if (days < 31) return { key: 'month', label: 'Month' }

  const then = new Date(at)
  const year = then.getFullYear()
  if (year !== new Date(now).getFullYear()) return { key: String(year), label: String(year) }

  const month = then.getMonth()
  // Zero-padded so the key sorts and compares as text without ever being taken apart.
  return { key: `${year}-${String(month + 1).padStart(2, '0')}`, label: MONTH_LABEL[month]! }
}

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
    if (existing) {
      existing.count += 1
      existing.lastClippedAt = Math.max(existing.lastClippedAt, clipping.at)
    } else {
      totals.set(clipping.sourceUrl, {
        sourceUrl: clipping.sourceUrl,
        sourceTitle: clipping.sourceTitle,
        count: 1,
        lastClippedAt: clipping.at,
      })
    }
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

/**
 * Everything currently narrowing the journal. Each is ignored when absent or empty.
 *
 * Named as one thing because they are one thing to the reader — the state of "what am I
 * looking at" — and because three of them arriving as positional arguments would make every
 * call site a puzzle.
 */
export type JournalFilters = {
  /** A union: selecting two chips shows both. Empty means every source. */
  sources?: ReadonlySet<string>
  /** Case-insensitive substring of the text or the source title. Empty means every clipping. */
  query?: string
  /** One span of time, held as its key. Null means every span. */
  band?: AgeBandKey | null
  /** What the spans are measured against; only consulted when a band is set. */
  now?: number
}

/**
 * Newest first, narrowed by whichever filters are set.
 *
 * They intersect rather than replace one another: "these two pages", "the word tide" and "this
 * week" answer different questions, and a reader asking two of them means both. Sources are
 * the exception and are a union among themselves, because two chips is one question — "either
 * of these".
 *
 * A plain scan over the text. A thousand clippings is a few hundred kilobytes of string, which
 * is measured at a quarter of a millisecond to walk — an index would be machinery guarding
 * against a cost that isn't there.
 */
export function visibleClippings(
  clippings: readonly Clipping[],
  { sources, query = '', band = null, now = Date.now() }: JournalFilters = {},
): Clipping[] {
  const needle = query.trim().toLowerCase()
  return clippings
    .filter((c) => sources === undefined || sources.size === 0 || sources.has(c.sourceUrl))
    .filter(
      (c) =>
        needle === '' ||
        c.text.toLowerCase().includes(needle) ||
        // The title too: "where did I read that" is as common a question as "what did it say".
        c.sourceTitle.toLowerCase().includes(needle),
    )
    .filter((c) => band === null || ageBandOf(c.at, now).key === band)
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
