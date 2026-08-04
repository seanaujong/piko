import type { ExtendedPassage, LineBand, LineRect, Passage } from '../extraction/sentences'
import {
  lineBandsFor,
  lineRectsForSpan,
  noteCovering,
  passageExtendedTo,
  sentenceAtPoint,
} from '../extraction/sentences'

export type HighlightHandle = {
  /** Re-derive every rect. Call after anything that reflows the article. */
  repaint: () => void
  destroy: () => void
}

type Options = {
  /** Positioned ancestor the overlay is placed in; rects are measured against it. */
  surface: HTMLElement
  /**
   * What pointer events are listened on. Defaults to `surface`, which is right when the
   * overlay sits inside the thing being read — the preview panel's article.
   *
   * Over the host page the two must differ: the overlay is a click-through fixed layer, so
   * it can never receive a pointer event, and the listeners belong on the document instead.
   * Keeping them as separate inputs is what lets one hit-tester serve both surfaces without
   * knowing which it is on.
   */
  events?: HTMLElement | Document
  /** Hit-testing is confined to this subtree. */
  article: HTMLElement
  /** The shadow root the article is rendered into — see `sentenceAtPoint`. */
  root: DocumentOrShadowRoot
  /** Passages already clipped, painted persistently. Re-read on every repaint. */
  clipped: () => readonly Passage[]
  /**
   * A plain click: keep the sentence under the cursor, or drop the note already holding it.
   *
   * Handed a whole note when one is under the cursor, never the single sentence that was hit.
   * The journal knows a note by its text, so dropping one means naming all of it.
   */
  onToggle: (hit: Passage) => void
  /**
   * A shift-click: the note nearest the cursor now runs this far.
   *
   * Handed the resolved passage rather than the raw click, because which note grows and how
   * far is a rule about reading and not about painting — it lives in `passageExtendedTo`,
   * where both surfaces ask it the same question and a test can put it under oath.
   */
  onExtend: (extension: ExtendedPassage) => void
  /**
   * Repaint on scroll as well as resize. The panel's overlay lives inside the scrolling
   * container and travels with it for free; a fixed overlay over the host page does not, so
   * its marks have to be re-derived as the page moves under them.
   */
  repaintOnScroll?: boolean
  /**
   * Swallow the click that clips. On the host page a sentence is very often inside a link,
   * and clipping it must not also navigate away from the page being read.
   */
  suppressActivation?: boolean
}

const samePassage = (a: Passage, b: Passage): boolean =>
  a.block === b.block && a.start === b.start && a.end === b.end

/**
 * Paints the sentence under the cursor, plus every already-clipped sentence, into an overlay
 * layered beneath the text. The article's own DOM is never touched.
 *
 * Only works over extracted (reader) content: a framed preview is a cross-origin iframe whose
 * document can't be read, so there is nothing to hit-test. That constraint is why reader mode
 * is the primary surface for this feature rather than the fallback it was in v1.
 */
export function attachSentenceHighlight(options: Options): HighlightHandle {
  const { surface, article, root, clipped, onToggle } = options
  const events = options.events ?? surface
  const locale = document.documentElement.lang || 'en'

  const overlay = document.createElement('div')
  overlay.className = 'piko-marks'
  surface.prepend(overlay)

  /**
   * The *sentence* the last hit-test landed on, not the note holding it.
   *
   * Which note holds it is derived at paint time instead, because that answer depends on the
   * journal and the journal changes underneath a stationary cursor: click to drop a note and
   * the cursor is suddenly over plain text again. Cached, the overlay would go on lighting a
   * note that no longer exists until the reader moved the mouse. The expensive half — the
   * hit-test, which reads layout — is what is worth caching; the cheap half is re-derived.
   */
  let hoveredSentence: Passage | null = null
  let framePending = false
  let lastPoint: { x: number; y: number } | null = null

  type Mark = { rect: LineRect; className: string }

  function measureRange(
    hit: Passage,
    className: string,
    bands: Map<HTMLElement, LineBand[]>,
    into: Mark[],
  ): void {
    let blockBands = bands.get(hit.block)
    if (!blockBands) {
      blockBands = lineBandsFor(hit.block)
      bands.set(hit.block, blockBands)
    }

    // One box per visual line — a sentence wrapping across three lines paints three, which is
    // what makes the highlight follow the text rather than bounding-box it. Merging happens in
    // `lineRectsForSpan`, so a translucent mark never stacks on itself over inline markup.
    for (const rect of lineRectsForSpan(hit.block, hit.start, hit.end, blockBands)) {
      into.push({ rect, className })
    }
  }

  /**
   * Every mark, rebuilt from the current layout.
   *
   * Measuring is finished before anything is added to the document, and the overlay is
   * replaced in a single call. That separation is the whole performance story here: inserting
   * a mark dirties layout, so a loop that measured one sentence and appended its boxes before
   * measuring the next forced a fresh layout per sentence. Measured on a 220-paragraph article
   * with 200 clipped sentences, that cost 15.8ms — an entire frame at 60Hz, on a path that
   * runs once per scroll frame over the host page. Batched, the same repaint is a fraction of
   * that, and the per-mark cost stops climbing with the mark count.
   */
  function repaint(): void {
    const base = surface.getBoundingClientRect()

    // Bands are viewport-relative and so change with scroll and reflow; the cache lives for one
    // repaint only, which is enough to measure each block once no matter how many of its
    // sentences are marked.
    const bands = new Map<HTMLElement, LineBand[]>()
    const marks: Mark[] = []

    const clippedHits = clipped()
    for (const hit of clippedHits) measureRange(hit, 'piko-mark piko-mark-clip', bands, marks)

    // The cursor is on a note, not on a sentence, whenever a note holds what it landed on — so
    // the hover mark spans the whole note however many sentences it runs to. Painted over the
    // clip mark rather than instead of it: a note under the cursor is still kept, and what the
    // reader needs to see is the extent of the thing a click is about to drop.
    const hovered =
      hoveredSentence && (noteCovering(hoveredSentence, clippedHits) ?? hoveredSentence)
    if (hovered) measureRange(hovered, 'piko-mark piko-mark-hover', bands, marks)

    overlay.replaceChildren(
      ...marks.map(({ rect, className }) => {
        const mark = document.createElement('div')
        mark.className = className
        mark.style.left = `${rect.left - base.left}px`
        mark.style.top = `${rect.top - base.top}px`
        mark.style.width = `${rect.right - rect.left}px`
        mark.style.height = `${rect.bottom - rect.top}px`
        return mark
      }),
    )
  }

  function resolveHover(): void {
    framePending = false
    if (!lastPoint) return

    const hit = sentenceAtPoint(article, root, locale, lastPoint.x, lastPoint.y)
    const unchanged =
      hit && hoveredSentence ? samePassage(hit, hoveredSentence) : hit === hoveredSentence
    if (unchanged) return

    hoveredSentence = hit
    repaint()
  }

  // Pointer events fire far faster than the screen updates; collapsing them to one lookup per
  // frame keeps cost flat regardless of how fast the cursor moves.
  function onPointerMove(event: PointerEvent): void {
    lastPoint = { x: event.clientX, y: event.clientY }
    if (framePending) return
    framePending = true
    requestAnimationFrame(resolveHover)
  }

  function onPointerLeave(): void {
    lastPoint = null
    if (hoveredSentence === null) return
    hoveredSentence = null
    repaint()
  }

  function onClick(event: MouseEvent): void {
    // Let a deliberate text selection win — dragging across a sentence to copy it the normal
    // way shouldn't also clip it. Not asked of a shift-click, whose selection the browser
    // just made in response to this very click; see `clearIncidentalSelection`.
    const selection = surface.getRootNode() instanceof ShadowRoot ? null : window.getSelection()
    if (!event.shiftKey && selection && !selection.isCollapsed) return

    const sentence = sentenceAtPoint(article, root, locale, event.clientX, event.clientY)
    if (!sentence) return

    // What was clicked is the note holding that sentence, when one does. A click aimed at the
    // sentence instead would name a fragment the journal has never heard of: dropping a
    // two-sentence note would file its first sentence as a second note overlapping the first,
    // which is the one shape the reach rule exists to keep out of the journal.
    const clippedHits = clipped()
    const hit = noteCovering(sentence, clippedHits) ?? sentence

    // Resolved before the event is swallowed, so a shift-click that would change nothing
    // leaves the page's own handling of it alone.
    const extension = event.shiftKey ? passageExtendedTo(hit, clippedHits, locale) : null
    if (event.shiftKey && !extension) return

    if (options.suppressActivation) {
      // Captured before the page sees it, so a sentence inside a link clips instead of
      // navigating. Without this the page would be gone before the mark could paint.
      event.preventDefault()
      event.stopPropagation()
    }

    if (extension) {
      clearIncidentalSelection()
      options.onExtend(extension)
    } else {
      onToggle(hit)
    }
  }

  /**
   * Drops the text selection a shift-click made on its way here.
   *
   * Shift-click is the browser's own extend-the-selection gesture, and it runs on mousedown —
   * long before this handler sees a click, and past the reach of `preventDefault`. Left alone
   * it lays a blue smear over exactly the passage that just lit up, so the reader's answer to
   * "did that work" would be two overlapping highlights disagreeing about where the note ends.
   *
   * Only ever reached from a shift-click that actually grew a note, so the selection being
   * dropped is one Piko caused rather than one the reader was building.
   */
  function clearIncidentalSelection(): void {
    window.getSelection()?.removeAllRanges()
  }

  // Scroll fires far faster than the screen updates and every repaint reads layout, so it is
  // collapsed to one per frame the same way pointer moves are.
  let repaintPending = false
  function repaintNextFrame(): void {
    if (repaintPending) return
    repaintPending = true
    requestAnimationFrame(() => {
      repaintPending = false
      repaint()
    })
  }

  events.addEventListener('pointermove', onPointerMove as EventListener)
  events.addEventListener('pointerleave', onPointerLeave)
  events.addEventListener('click', onClick as EventListener, options.suppressActivation === true)
  window.addEventListener('resize', repaint)
  if (options.repaintOnScroll) {
    window.addEventListener('scroll', repaintNextFrame, { passive: true })
  }

  // Rects are measured from laid-out text, so a late webfont swap silently invalidates them.
  void document.fonts?.ready.then(repaint)

  return {
    repaint,
    destroy() {
      events.removeEventListener('pointermove', onPointerMove as EventListener)
      events.removeEventListener('pointerleave', onPointerLeave)
      events.removeEventListener('click', onClick as EventListener, options.suppressActivation === true)
      window.removeEventListener('resize', repaint)
      window.removeEventListener('scroll', repaintNextFrame)
      overlay.remove()
    },
  }
}
