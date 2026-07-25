import { Component, Fragment, render } from 'preact'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { AgeBand, Clipping, ClippingsStore, SourceTally } from '../../state/clippings'
import {
  AGE_BAND_LABEL,
  ageBandOf,
  gapBefore,
  sourcesInSessionOrder,
  sourcesOnOrFrom,
  visibleClippings,
} from '../../state/clippings'
import { copyText } from '../clipboard'
import { hostOf } from '../formatUrl'
import { ICON } from '../iconButton'
import { textFragmentUrl } from '../textFragment'

export type ClippingsPane = {
  root: HTMLElement
  render: () => void
}

/** How long a copy confirmation stays up. Exported so a test states the same duration once. */
export const FLASH_MS = 1400

const relativeTime = (from: number): string => {
  const minutes = Math.round((Date.now() - from) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

const gapLabel = (ms: number): string => {
  const hours = Math.round(ms / 3_600_000)
  if (hours < 24) return `${hours}h earlier`
  const days = Math.round(hours / 24)
  return days === 1 ? 'the day before' : `${days} days earlier`
}

/** Identity of a clipping, mirroring `isSame` in clippings.ts — source plus text, nothing else. */
const keyOf = (clipping: Clipping): string => `${clipping.sourceUrl}\u0000${clipping.text}`

/**
 * Re-renders whenever the journal changes, and hands back the current contents.
 *
 * The store replaces its array rather than mutating it, so holding the snapshot as state is
 * enough on its own: a change produces a new reference, an identity check sees it, and an
 * unrelated notification that produced no change costs nothing.
 *
 * The subscription is a *layout* effect rather than a passive one because it has to be live by
 * the time `createClippingsPane` returns — the caller is free to clip something immediately,
 * and a deferred effect would miss that first change.
 */
function useClippings(store: ClippingsStore): readonly Clipping[] {
  const [clippings, setClippings] = useState(store.all())

  useLayoutEffect(() => store.subscribe(() => setClippings(store.all())), [store])

  return clippings
}

type Flash = 'idle' | 'done' | 'failed'

/**
 * Copy is otherwise silent — the clipboard gives no feedback of its own, and a write that
 * quietly failed is indistinguishable from one that worked.
 *
 * Holding the outcome as state rather than writing it onto the button is what lets a
 * confirmation outlive an unrelated redraw: the node it belongs to is no longer rebuilt
 * underneath it, and the timer is cancelled with the button instead of firing into a node that
 * has already been discarded.
 */
function useFlash(): [Flash, (ok: boolean) => void] {
  const [flash, setFlash] = useState<Flash>('idle')

  useEffect(() => {
    if (flash === 'idle') return
    const timer = setTimeout(() => setFlash('idle'), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  return [flash, (ok: boolean) => setFlash(ok ? 'done' : 'failed')]
}

/**
 * The markup in `ICON` is a module constant that never carries page content, so rendering it
 * as raw HTML opens no injection surface — unlike article HTML, which goes through DOMPurify
 * in extract.ts.
 */
const Icon = ({ parts }: { parts: string }): preact.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width="13"
    height="13"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: parts }}
  />
)

function CopyIconButton({ label, onCopy }: { label: string; onCopy: () => boolean }) {
  const [flash, report] = useFlash()

  return (
    <button
      class={`piko-icon-button${flash === 'idle' ? '' : ` is-${flash}`}`}
      title={label}
      aria-label={label}
      // Synchronous, inside the click handler — see clipboard.ts.
      onClick={() => report(onCopy())}
    >
      <Icon parts={flash === 'done' ? ICON.copied : ICON.copy} />
    </button>
  )
}

type ChipRowProps = {
  tallies: readonly SourceTally[]
  active: ReadonlySet<string>
  onToggle: (sourceUrl: string) => void
  band: AgeBand | null
  onBand: (band: AgeBand) => void
  /** Sources belonging to the page in front of the reader, marked so they can be picked out. */
  here: ReadonlySet<string>
  /** Read once by the pane, so every span in one render is judged against the same instant. */
  now: number
}

/** Past this many, one line of chips can no longer hold them and the row takes a second. */
const CHIPS_PER_ROW = 4

function ChipRow({ tallies: shown, active, onToggle, band, onBand, here, now }: ChipRowProps) {
  const chips = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  // Whether the row actually continues past its edge is a layout question, so it is answered by
  // measuring rather than by counting chips — a count is a guess about widths that vary with
  // every page title. The observer catches the pane changing width, which the count cannot.
  useLayoutEffect(() => {
    const element = chips.current
    if (!element) return

    const measure = (): void => setOverflowing(element.scrollWidth > element.clientWidth + 1)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [shown.length])

  return (
    <div class="piko-clips-filters">
      <div
        class="piko-clips-chips"
        ref={chips}
        data-rows={shown.length > CHIPS_PER_ROW ? '2' : '1'}
        {...(overflowing ? { 'data-overflowing': '' } : {})}
      >
        {shown.map((tally, index) => {
          const span = ageBandOf(tally.lastClippedAt, now)
          const isHere = here.has(tally.sourceUrl)
          // Chips run newest-first, so spans can only get older along the row and each one is a
          // single unbroken run. A marker opens each run and names it: reading rightwards is
          // moving back through the journal, so the label describes what follows it.
          //
          // Including the first, which as a plain separator needed none — nothing precedes it
          // to separate from. As a control it does: without a marker on the leading run, the
          // span the reader is actually in would be the one span they could not select.
          const opensSpan =
            index === 0 || ageBandOf(shown[index - 1]!.lastClippedAt, now) !== span

          return (
            <Fragment key={tally.sourceUrl}>
              {opensSpan && (
                <button
                  class="piko-chip-band"
                  aria-pressed={band === span ? 'true' : 'false'}
                  title={`Show only what you clipped ${AGE_BAND_LABEL[span].toLowerCase()}`}
                  onClick={() => onBand(span)}
                >
                  {AGE_BAND_LABEL[span]}
                </button>
              )}
              <button
                class={`piko-chip${isHere ? ' is-here' : ''}`}
                // Spelled out rather than passed as a boolean: an unpressed chip must still
                // carry `aria-pressed="false"`, not drop the attribute, or a screen reader
                // stops announcing it as a toggle at all.
                aria-pressed={active.has(tally.sourceUrl) ? 'true' : 'false'}
                title={tally.sourceUrl}
                onClick={() => onToggle(tally.sourceUrl)}
              >
                <span>{tally.sourceTitle}</span>
                <span class="piko-chip-count">{tally.count}</span>
              </button>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

type ClipEntryProps = {
  clipping: Clipping
  /**
   * Takes the clipping rather than closing over it, so one function instance serves every row.
   * A `() => store.toggle(clipping)` built per row is a new value on every render, which is
   * enough on its own to defeat the comparison below.
   */
  onRemove: (clipping: Clipping) => void
}

/**
 * A row, skipped entirely when neither of its inputs changed.
 *
 * Rendering the list is linear in the *whole journal* rather than in what changed, because
 * every redraw walks a vnode per element of every row to discover that one row differs. This is
 * the check that stops the walk at the row: the store replaces its array but keeps the clipping
 * objects inside it, so an unchanged row's props are identical by reference and its ten elements
 * are never visited.
 *
 * Written as a class because `shouldComponentUpdate` is the only form of this in Preact's core —
 * `memo` lives in `preact/compat`, and importing it would pull the whole compatibility layer,
 * `options` patching included, into the content script to serve one comparison.
 *
 * The cost is that a row's relative time is fixed from when the row mounted, where it used to be
 * recomputed on any redraw. Both are wrong in the same direction — neither ever ticked on its
 * own — and reopening the rail or touching a filter remounts the rows and refreshes them. Making
 * it exact means giving the row the current minute as a prop, which is a real trade rather than
 * a free fix: labels would never be a minute stale, and the first clip of each new minute would
 * pay the full walk this check exists to avoid.
 */
class ClipEntry extends Component<ClipEntryProps> {
  shouldComponentUpdate(next: ClipEntryProps): boolean {
    return next.clipping !== this.props.clipping || next.onRemove !== this.props.onRemove
  }

  render() {
    const { clipping, onRemove } = this.props

    return (
      <div class="piko-clip">
        {/*
          Time and controls share one meta row above the text, so neither reserves a gutter
          beside it. In a pane this narrow the sentence needs the full width more than the
          metadata needs to sit inline with it.
        */}
        <div class="piko-clip-meta">
          <span class="piko-clip-when">{relativeTime(clipping.at)}</span>
          <div class="piko-clip-actions">
            {/* The sentence alone — the clipboard is the door out of the journal, one clip at a
                time, so what lands there is the text and not a wrapper around it. */}
            <CopyIconButton label="Copy this clipping" onCopy={() => copyText(clipping.text)} />
            <button
              class="piko-icon-button piko-clip-remove"
              title="Remove clipping"
              aria-label="Remove clipping"
              onClick={() => onRemove(clipping)}
            >
              <Icon parts={ICON.remove} />
            </button>
          </div>
        </div>
        <div class="piko-clip-body">
          {clipping.text}
          {/*
            The way back to a clipping is a link out, not a preview: re-previewing in place would
            replace whatever the reader currently has open, and giving the panel a history to
            unwind is a lot of machinery for a pane that shows one page at a time. A new tab costs
            the reader nothing they had, and the text directive means it opens *at* the sentence
            rather than at the top of the article.

            It names the page the sentence lives on. The page it was dragged from is a different
            page, and inlining both without saying which was which read as one ambiguous line.
          */}
          <a
            class="piko-clip-source"
            href={textFragmentUrl(clipping.sourceUrl, clipping.text)}
            target="_blank"
            rel="noopener noreferrer"
            title={
              clipping.originUrl
                ? `Open ${clipping.sourceTitle} at this sentence — dragged from ${clipping.originUrl}`
                : `Open ${clipping.sourceTitle} at this sentence`
            }
          >
            {`${clipping.sourceTitle} · ${hostOf(clipping.sourceUrl)}`}
          </a>
        </div>
      </div>
    )
  }
}

/**
 * The search field, and the icon that summons it.
 *
 * Kept out of the header's own row: at this width a field wide enough to type into would push
 * the title out, and the field is only wanted while a search is going on. Opening it focuses
 * it, because reaching for search and then having to click again to type is a step nobody
 * wants.
 */
function SearchRow({ query, onQuery, onClose }: {
  query: string
  onQuery: (value: string) => void
  onClose: () => void
}) {
  const field = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => field.current?.focus(), [])

  return (
    <div class="piko-clips-search">
      <Icon parts={ICON.search} />
      <input
        ref={field}
        class="piko-clips-search-field"
        type="search"
        placeholder="Search clippings"
        aria-label="Search clippings"
        value={query}
        onInput={(event) => onQuery((event.currentTarget as HTMLInputElement).value)}
        // Escape abandons the search. What keeps it from also dismissing the panel is upstream
        // in mountPanel, which has to let the field win because its own listener captures and
        // therefore runs first — nothing this handler does could stop it.
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      />
    </div>
  )
}

function Pane({
  store,
  onClose,
  here,
}: {
  store: ClippingsStore
  onClose: () => void
  here: () => string | null
}) {
  const all = useClippings(store)
  const [active, setActive] = useState<ReadonlySet<string>>(new Set())
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [band, setBand] = useState<AgeBand | null>(null)

  // Read once per render, so a chip and the list cannot land on opposite sides of midnight.
  const now = Date.now()
  const items = visibleClippings(all, {
    sources: active,
    query: searching ? query : '',
    band,
    now,
  })

  // The chip row's two narrowings, and the one control that clears them. The query has its own
  // way out — closing the field — so it is not swept up here.
  const narrowed = active.size > 0 || band !== null
  const clearRowFilters = (): void => {
    setActive(new Set())
    setBand(null)
  }

  /**
   * The chips describe what the *other* narrowings have left, not the whole journal — so a
   * search leaves only the sources it found, carrying counts of what it found in each, and
   * choosing a span leaves only the sources used in it.
   *
   * That second case is what saves the row from its own length. Reaching a source from three
   * months ago used to mean scrolling past everything newer; pressing EARLIER now empties the
   * row of everything newer instead, and the wanted chips are at position zero. The span
   * markers were already the timeline — this is what makes them a way of getting somewhere
   * rather than only a way of reading where you are.
   *
   * The source selection is deliberately not applied here: chips narrowed by the chip you just
   * pressed would leave you holding the only one you could still see.
   */
  // What "here" means differs by surface — the article being previewed, or the live page the
  // rail is docked beside — so the panel supplies it rather than the pane assuming.
  const hereSources = sourcesOnOrFrom(all, here())
  // "Here" is expressed as a source selection rather than as its own filter — it IS a set of
  // sources, and a parallel filter would give the pane two ways to say the same thing.
  const hereSelected =
    hereSources.size > 0 && [...hereSources].every((url) => active.has(url))
  const sources = sourcesInSessionOrder(
    visibleClippings(all, { query: searching ? query : '', band, now }),
  )

  // A filter over a single source narrows nothing — it would just be noise. That is a question
  // about the journal, though, not about what is currently on screen: judged against the
  // narrowed set instead, choosing a span that happens to hold one source would empty the row
  // of the very marker just pressed, leaving no way back out of it from the row.
  const worthFiltering = sourcesInSessionOrder(all).length >= 2
  const filterable = worthFiltering ? sources : []

  /**
   * Held still across renders on purpose, and the one place in this file where that is load
   * bearing rather than tidiness: it is a prop of every row, so rebuilding it would change all
   * of their props and send `ClipEntry`'s comparison back to visiting every element in the list.
   */
  const remove = useCallback((clipping: Clipping) => store.toggle(clipping), [store])

  const toggleSource = (sourceUrl: string): void =>
    setActive((current) => {
      const next = new Set(current)
      if (!next.delete(sourceUrl)) next.add(sourceUrl)
      return next
    })

  return (
    <>
      {/* The same bar the panel header is — see the note on piko-bar in styles.ts. */}
      <div class="piko-bar piko-clips-header">
        <div class="piko-bar-lead piko-clips-heading">
          {/*
            Title and count are one label sharing a baseline; the group around them is what
            holds a steady height as Show all comes and goes. One element cannot do both — a
            baseline group inside a stretched box aligns to its top rather than its middle.
          */}
          <div class="piko-clips-label">
            <div class="piko-clips-title">Clippings</div>
            <span class="piko-clips-count">
              {items.length === all.length ? all.length : `${items.length}/${all.length}`}
            </span>
          </div>
          {/*
            Beside the count rather than in the chip row, because it is that count's undo: the
            narrowed "1/6" is what tells the reader a filter is on, and this is how it comes
            off. In the row it also had to survive being squeezed by the chips it sits next to,
            which is a fight a two-word label loses — it wrapped.
          */}
          {narrowed && (
            <button class="piko-chip piko-chip-reset" onClick={clearRowFilters}>
              Show all
            </button>
          )}
        </div>
        <div class="piko-bar-trail piko-clips-actions">
          {/*
            Only offered when the page in front of the reader has anything to do with the
            journal, and kept here rather than in the chip row because the row scrolls: a scope
            you have to scroll sideways to find is one you will not use.
          */}
          {hereSources.size > 0 && (
            <button
              class={`piko-icon-button piko-clips-here${hereSelected ? ' is-on' : ''}`}
              title="Show only this page and what you reached from it"
              aria-label="Show only this page and what you reached from it"
              aria-pressed={hereSelected ? 'true' : 'false'}
              onClick={() =>
                setActive((current) =>
                  [...hereSources].every((url) => current.has(url))
                    ? new Set()
                    : new Set(hereSources),
                )
              }
            >
              <Icon parts={ICON.here} />
            </button>
          )}
          <button
            class={`piko-icon-button piko-clips-find${searching ? ' is-on' : ''}`}
            title="Search clippings"
            aria-label="Search clippings"
            aria-pressed={searching ? 'true' : 'false'}
            onClick={() => {
              // Closing drops the query with it, rather than leaving the list narrowed by
              // something no longer on screen.
              if (searching) setQuery('')
              setSearching(!searching)
            }}
          >
            <Icon parts={ICON.search} />
          </button>
          {/*
            An icon, because the control has no honest one-word label — "Close" beside an
            article would read as closing the preview the pane sits inside.
          */}
          <button
            class="piko-icon-button piko-clips-close"
            title="Close clippings"
            aria-label="Close clippings"
            onClick={onClose}
          >
            <Icon parts={ICON.remove} />
          </button>
        </div>
      </div>

      {searching && (
        <SearchRow
          query={query}
          onQuery={setQuery}
          onClose={() => {
            setQuery('')
            setSearching(false)
          }}
        />
      )}

      <ChipRow
        tallies={filterable}
        active={active}
        onToggle={toggleSource}
        here={hereSources}
        band={band}
        // Selecting the span already showing is how the reader gets back out of it.
        onBand={(chosen) => setBand((current) => (current === chosen ? null : chosen))}
        now={now}
      />

      <div class="piko-clips-list">
        {all.length === 0 ? (
          <p class="piko-clips-empty">Click a sentence in the article to clip it.</p>
        ) : (
          items.map((clipping, index) => {
            const gap = gapBefore(items, index)
            return (
              <Fragment key={keyOf(clipping)}>
                {gap !== null && <div class="piko-clips-divider">{gapLabel(gap)}</div>}
                <ClipEntry clipping={clipping} onRemove={remove} />
              </Fragment>
            )
          })
        )}
      </div>
    </>
  )
}

/**
 * One chronological list, narrowed by source chips — not three grouping modes. Filters compose
 * and are stateless where modes are exclusive and stateful, and because each chip carries its
 * own count the chip row *is* the by-source overview a grouping mode would give. Sessions
 * survive as dividers inside the stream, so the list never changes shape.
 *
 * The host element is created here rather than rendered, because `mountPanel` owns its
 * `data-hidden` attribute; Preact manages the children below it and leaves the element alone.
 *
 * What closing the pane *means* is the caller's to decide, and it genuinely differs by where
 * the pane is docked — inside a preview it is one column of two, while in the rail its
 * visibility is the only signal that clicks on the page are being intercepted. The pane knows
 * it has a close button; it does not know which of those two it is.
 */
export function createClippingsPane(
  store: ClippingsStore,
  { onClose, here }: { onClose: () => void; here: () => string | null },
): ClippingsPane {
  const root = document.createElement('div')
  root.className = 'piko-clips'

  const paint = (): void => render(<Pane store={store} onClose={onClose} here={here} />, root)

  paint()

  return { root, render: paint }
}
