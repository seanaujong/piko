/**
 * Sentence-granular hit testing over already-rendered article HTML.
 *
 * Nothing here mutates the document. Sentences routinely run through inline markup — one
 * sentence can span an `<a>`, a `<b>` and a `<sub>` at once — so wrapping one in an element
 * would mean re-parenting the sanitized nodes `extract.ts` just produced. Instead a `Range`
 * is set across the existing text nodes and the caller paints its client rects into an
 * overlay, which leaves highlights as derived state that a re-render cannot corrupt.
 */

export type Sentence = { start: number; end: number; text: string }
export type SentenceHit = Sentence & { block: HTMLElement }

/** Blocks whose text is prose worth hit-testing. Excludes `pre`, whose "sentences" are code. */
export const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4'

const segmenters = new Map<string, Intl.Segmenter>()

function segmenterFor(locale: string): Intl.Segmenter {
  let segmenter = segmenters.get(locale)
  if (!segmenter) {
    segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' })
    segmenters.set(locale, segmenter)
  }
  return segmenter
}

/**
 * Keyed on the element rather than on its text, so a re-render drops the entry with the
 * node itself — there is no cache to invalidate and no way for a stale segmentation to
 * outlive the block it describes.
 */
const segmentedBlocks = new WeakMap<HTMLElement, Sentence[]>()

/**
 * Only the block under the cursor is ever segmented, and only once. A long article runs to
 * well over a thousand sentences; segmenting all of them up front, or attaching a listener
 * per sentence, would make per-frame cost scale with article length for no benefit.
 */
export function sentencesIn(block: HTMLElement, locale: string): Sentence[] {
  const cached = segmentedBlocks.get(block)
  if (cached) return cached

  const text = block.textContent ?? ''
  const sentences: Sentence[] = []
  for (const { segment, index } of segmenterFor(locale).segment(text)) {
    // Trailing whitespace belongs to the gap between sentences, not to the highlight —
    // leaving it in paints a ragged block of colour past the final full stop.
    const trimmed = segment.replace(/\s+$/, '')
    if (trimmed.length > 0) {
      sentences.push({ start: index, end: index + trimmed.length, text: trimmed })
    }
  }

  segmentedBlocks.set(block, sentences)
  return sentences
}

function textNodesIn(block: HTMLElement): Text[] {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text)
  }
  return nodes
}

/** A Range covering [start, end) across however many text nodes that takes. */
export function rangeForSentence(block: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange()
  let consumed = 0
  let started = false

  for (const textNode of textNodesIn(block)) {
    const length = textNode.data.length
    if (!started && consumed + length > start) {
      range.setStart(textNode, start - consumed)
      started = true
    }
    if (started && consumed + length >= end) {
      range.setEnd(textNode, end - consumed)
      return range
    }
    consumed += length
  }

  return null
}

/** A sentence's footprint on one visual line, in viewport coordinates. */
export type LineRect = { left: number; top: number; right: number; bottom: number }

/** A tiled vertical slice of a block, one per rendered line. */
export type LineBand = { top: number; bottom: number }

/** Fraction of the shorter rect that must overlap for two rects to count as the same line. */
const SAME_LINE_OVERLAP = 0.5

/**
 * The block's rendered lines, as bands that tile with no seam.
 *
 * Derived from where the text actually is rather than from a computed grid. An earlier version
 * assumed every line sat exactly `line-height` apart starting at the block's content-box top,
 * and snapped rects to that lattice — which drifts progressively the moment real spacing
 * disagrees, from an inline image raising a line, a nested element with its own line-height, or
 * `line-height: normal`. Once the drift exceeds half a line, rects land in the wrong slot
 * entirely and separate lines collapse into one band.
 *
 * Boundaries sit at the midpoint of the gap between consecutive lines, so adjacent bands share
 * an edge by construction. Tiling therefore survives lines of different heights, which a
 * uniform grid cannot represent at all.
 */
export function lineBandsFor(block: HTMLElement): LineBand[] {
  const range = document.createRange()
  range.selectNodeContents(block)

  const rects = [...range.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left)

  // Overlap rather than centre-containment decides sameness, so a raised superscript joins the
  // line it sits on instead of opening one of its own.
  const lines: LineBand[] = []
  for (const rect of rects) {
    const line = lines.find((candidate) => {
      const overlap = Math.min(candidate.bottom, rect.bottom) - Math.max(candidate.top, rect.top)
      const shorter = Math.min(candidate.bottom - candidate.top, rect.height)
      return shorter > 0 && overlap > shorter * SAME_LINE_OVERLAP
    })
    if (line) {
      line.top = Math.min(line.top, rect.top)
      line.bottom = Math.max(line.bottom, rect.bottom)
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom })
    }
  }

  return lines.map((line, index) => {
    const previous = lines[index - 1]
    const next = lines[index + 1]
    // The outermost edges have no neighbour to meet, so they mirror the gap on their inner
    // side — which keeps a single-line block from collapsing to just its text height.
    const above = previous ? (line.top - previous.bottom) / 2 : next ? (next.top - line.bottom) / 2 : 0
    const below = next ? (next.top - line.bottom) / 2 : previous ? (line.top - previous.bottom) / 2 : 0
    return {
      top: line.top - Math.max(0, above),
      bottom: line.bottom + Math.max(0, below),
    }
  })
}

/**
 * One box per visual line the sentence occupies.
 *
 * `Range.getClientRects()` returns a rect for each inline element the range crosses *and* one
 * for the text run inside it, so a sentence containing `<a>`, `<b>` or `<sub>` yields
 * overlapping duplicates that stack into a visibly darker patch under a translucent mark.
 * Collapsing them onto the block's line bands removes the doubling, closes the hairline gaps
 * between adjacent runs, and drops the node count from one-per-run to one-per-line.
 *
 * Pass `bands` when highlighting several sentences in the same block to measure it once.
 */
export function lineRectsForSentence(
  block: HTMLElement,
  start: number,
  end: number,
  bands: readonly LineBand[] = lineBandsFor(block),
): LineRect[] {
  const range = rangeForSentence(block, start, end)
  if (!range || bands.length === 0) return []

  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)

  /**
   * The band a rect belongs to. Bands tile, so a centre almost always lands inside one; the
   * nearest-band fallback catches a rect straddling an edge instead of dropping it.
   */
  const bandIndexOf = (rect: DOMRect): number => {
    const centre = rect.top + rect.height / 2
    const inside = bands.findIndex((band) => centre >= band.top && centre <= band.bottom)
    if (inside >= 0) return inside

    let nearest = 0
    let best = Number.POSITIVE_INFINITY
    bands.forEach((band, index) => {
      const distance = Math.abs((band.top + band.bottom) / 2 - centre)
      if (distance < best) {
        best = distance
        nearest = index
      }
    })
    return nearest
  }

  // Every band the sentence touches contributes one box: the band's full height, and only as
  // wide as the sentence reaches on that line. Because the band came from the block's real
  // lines, nothing here depends on rect heights — bold, superscripts and inline images all
  // widen a box without being able to move it.
  const spans = new Map<number, { left: number; right: number }>()
  for (const rect of rects) {
    const index = bandIndexOf(rect)
    const span = spans.get(index)
    if (span) {
      span.left = Math.min(span.left, rect.left)
      span.right = Math.max(span.right, rect.right)
    } else {
      spans.set(index, { left: rect.left, right: rect.right })
    }
  }

  return [...spans.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([index, span]) => {
      const band = bands[index]
      return band ? [{ left: span.left, right: span.right, top: band.top, bottom: band.bottom }] : []
    })
}

const containsPoint = (rect: LineRect, x: number, y: number): boolean =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom

/**
 * The sentence under a viewport point, or null if the point isn't over prose in `article`.
 *
 * `root` must be the shadow root the article is rendered into, not the document. Verified in
 * Chrome: `ShadowRoot` has no `caretRangeFromPoint`/`caretPositionFromPoint` at all, and the
 * document's own version stops at the shadow host — it returns the host's ancestor rather
 * than the text inside. `elementFromPoint` is the method that does pierce the boundary, so
 * the block is found by element and the sentence within it by rect containment.
 *
 * Testing containment against the same rects that get painted also means the hit region is
 * exactly the highlight: there is no second definition of "where a sentence is" to drift.
 */
export function sentenceAtPoint(
  article: HTMLElement,
  root: DocumentOrShadowRoot,
  locale: string,
  x: number,
  y: number,
): SentenceHit | null {
  const element = root.elementFromPoint(x, y)
  if (!element || !article.contains(element)) return null

  const block = element.closest<HTMLElement>(BLOCK_SELECTOR)
  if (!block || !article.contains(block)) return null

  // A block holds a handful of sentences, so this scan is bounded and cheap — unlike
  // pre-segmenting the article, whose cost would scale with its length. The block's line bands
  // are measured once and shared across those sentences rather than per sentence.
  //
  // Hit testing runs against the same boxes that get painted, so the region that responds to
  // the cursor is exactly the region that lights up.
  const bands = lineBandsFor(block)
  for (const sentence of sentencesIn(block, locale)) {
    for (const rect of lineRectsForSentence(block, sentence.start, sentence.end, bands)) {
      if (containsPoint(rect, x, y)) return { block, ...sentence }
    }
  }

  return null
}
