import type { LineBand, SentenceHit } from '../extraction/sentences'
import { lineBandsFor, lineRectsForSentence, sentenceAtPoint } from '../extraction/sentences'

export type HighlightHandle = {
  /** Re-derive every rect. Call after anything that reflows the article. */
  repaint: () => void
  destroy: () => void
}

type Options = {
  /** Positioned ancestor the overlay is placed in; rects are measured against it. */
  surface: HTMLElement
  /** Hit-testing is confined to this subtree. */
  article: HTMLElement
  /** The shadow root the article is rendered into — see `sentenceAtPoint`. */
  root: DocumentOrShadowRoot
  /** Sentences already clipped, painted persistently. Re-read on every repaint. */
  clipped: () => readonly SentenceHit[]
  onToggle: (hit: SentenceHit) => void
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
  const locale = document.documentElement.lang || 'en'

  const overlay = document.createElement('div')
  overlay.className = 'piko-marks'
  surface.prepend(overlay)

  let hovered: SentenceHit | null = null
  let framePending = false
  let lastPoint: { x: number; y: number } | null = null

  function paintRange(
    hit: SentenceHit,
    className: string,
    base: DOMRect,
    bands: Map<HTMLElement, LineBand[]>,
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
      const mark = document.createElement('div')
      mark.className = className
      mark.style.left = `${rect.left - base.left}px`
      mark.style.top = `${rect.top - base.top}px`
      mark.style.width = `${rect.right - rect.left}px`
      mark.style.height = `${rect.bottom - rect.top}px`
      overlay.appendChild(mark)
    }
  }

  function repaint(): void {
    const base = surface.getBoundingClientRect()
    overlay.replaceChildren()

    // Bands are viewport-relative and so change with scroll and reflow; the cache lives for one
    // repaint only, which is enough to measure each block once no matter how many of its
    // sentences are marked.
    const bands = new Map<HTMLElement, LineBand[]>()

    const clippedHits = clipped()
    for (const hit of clippedHits) paintRange(hit, 'piko-mark piko-mark-clip', base, bands)

    // A clipped sentence keeps its own stronger colour rather than being overdrawn on hover.
    if (hovered && !clippedHits.some((c) => sameSentence(c, hovered!))) {
      paintRange(hovered, 'piko-mark piko-mark-hover', base, bands)
    }
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
    if (hit) onToggle(hit)
  }

  surface.addEventListener('pointermove', onPointerMove)
  surface.addEventListener('pointerleave', onPointerLeave)
  surface.addEventListener('click', onClick)
  window.addEventListener('resize', repaint)

  // Rects are measured from laid-out text, so a late webfont swap silently invalidates them.
  void document.fonts?.ready.then(repaint)

  return {
    repaint,
    destroy() {
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerleave', onPointerLeave)
      surface.removeEventListener('click', onClick)
      window.removeEventListener('resize', repaint)
      overlay.remove()
    },
  }
}
