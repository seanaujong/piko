import type { LineBand, LineRect, SentenceHit } from '../extraction/sentences'
import { lineBandsFor, lineRectsForSentence, sentenceAtPoint } from '../extraction/sentences'

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
  /** Sentences already clipped, painted persistently. Re-read on every repaint. */
  clipped: () => readonly SentenceHit[]
  onToggle: (hit: SentenceHit) => void
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

const sameSentence = (a: SentenceHit, b: SentenceHit): boolean =>
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

  let hovered: SentenceHit | null = null
  let framePending = false
  let lastPoint: { x: number; y: number } | null = null

  type Mark = { rect: LineRect; className: string }

  function measureRange(
    hit: SentenceHit,
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
    // `lineRectsForSentence`, so a translucent mark never stacks on itself over inline markup.
    for (const rect of lineRectsForSentence(hit.block, hit.start, hit.end, blockBands)) {
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

    // A clipped sentence keeps its own stronger colour rather than being overdrawn on hover.
    if (hovered && !clippedHits.some((c) => sameSentence(c, hovered!))) {
      measureRange(hovered, 'piko-mark piko-mark-hover', bands, marks)
    }

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
    const unchanged = hit && hovered ? sameSentence(hit, hovered) : hit === hovered
    if (unchanged) return

    hovered = hit
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
    if (hovered === null) return
    hovered = null
    repaint()
  }

  function onClick(event: MouseEvent): void {
    // Let a deliberate text selection win — dragging across a sentence to copy it the normal
    // way shouldn't also clip it.
    const selection = surface.getRootNode() instanceof ShadowRoot ? null : window.getSelection()
    if (selection && !selection.isCollapsed) return

    const hit = sentenceAtPoint(article, root, locale, event.clientX, event.clientY)
    if (!hit) return
    if (options.suppressActivation) {
      // Captured before the page sees it, so a sentence inside a link clips instead of
      // navigating. Without this the page would be gone before the mark could paint.
      event.preventDefault()
      event.stopPropagation()
    }
    onToggle(hit)
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
