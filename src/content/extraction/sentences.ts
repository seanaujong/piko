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

/**
 * The height of one line box, which is taller than the text rects inside it whenever
 * `line-height` exceeds 1 — the difference is CSS half-leading, split evenly above and below.
 */
function lineBoxHeight(block: HTMLElement): number {
  const style = getComputedStyle(block)
  const lineHeight = Number.parseFloat(style.lineHeight)
  if (Number.isFinite(lineHeight)) return lineHeight

  // `line-height: normal` computes to the string rather than a length; approximate it.
  const fontSize = Number.parseFloat(style.fontSize)
  return Number.isFinite(fontSize) ? fontSize * 1.2 : 0
}

/**
 * One rect per visual line, merged from the raw client rects.
 *
 * `Range.getClientRects()` returns a rect for each inline element the range crosses *and* one
 * for the text run inside it, so a sentence containing `<a>`, `<b>` or `<sub>` yields
 * overlapping duplicates — which stack into a visibly darker patch when painted with a
 * translucent colour. Merging by line removes the doubling, closes the hairline gaps between
 * adjacent runs, and drops the node count from one-per-run to one-per-line.
 */
export function lineRectsForSentence(
  block: HTMLElement,
  start: number,
  end: number,
): LineRect[] {
  const range = rangeForSentence(block, start, end)
  if (!range) return []

  const rects = [...range.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left)

  // Each line tracks its widest horizontal extent, plus the tallest rect on it. That tallest
  // rect is the body text, and it — not the union — anchors the band vertically. Superscript
  // citations sit raised and short, so letting them into the union dragged the band a couple
  // of pixels upward; on a citation-dense page that put every footnoted line slightly off the
  // grid from its neighbours, reopening the gaps as a ragged step.
  const lineBox = lineBoxHeight(block)

  // An inline image or inline-block is far taller than a line box; it gets no grid slot and
  // keeps whatever extent it measured, so a thumbnail can't stretch the lines around it.
  const isTextLike = (height: number): boolean => height <= lineBox * 1.5

  const blockStyle = getComputedStyle(block)
  const gridOrigin =
    block.getBoundingClientRect().top +
    (Number.parseFloat(blockStyle.paddingTop) || 0) +
    (Number.parseFloat(blockStyle.borderTopWidth) || 0)

  /**
   * Which line box a rect sits in. Every line in a block is exactly one line box tall, so the
   * rect's vertical centre divided by the line box *is* the line number. A superscript sits a
   * few pixels above the body text's centre, but that's a fraction of a line box, so it rounds
   * to the same slot — which is what puts it on the line it belongs to rather than its own.
   */
  const lineIndexOf = (rect: DOMRect): number =>
    Math.max(0, Math.round((rect.top + rect.height / 2 - gridOrigin - lineBox / 2) / lineBox))

  /**
   * Grouping *is* the snap. An earlier version grouped by overlapping vertical bands and then
   * snapped, which let a raised superscript open its own band — two entries for one visual
   * line, and after snapping two identical rects that double-darkened the translucent mark.
   *
   * Deriving the slot arithmetically makes tiling structural rather than measured: bold text
   * reports a fractionally taller rect than regular and a superscript a much shorter one, and
   * neither can move a band. Even a slightly wrong grid origin shifts every band equally,
   * which is invisible, where per-line drift is exactly what reopened the seams.
   */
  const slots = new Map<number, { left: number; right: number }>()
  const freeStanding: LineRect[] = []

  for (const rect of rects) {
    if (!isTextLike(rect.height) || lineBox <= 0) {
      freeStanding.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
      continue
    }

    const index = lineIndexOf(rect)
    const slot = slots.get(index)
    if (slot) {
      slot.left = Math.min(slot.left, rect.left)
      slot.right = Math.max(slot.right, rect.right)
    } else {
      slots.set(index, { left: rect.left, right: rect.right })
    }
  }

  // Client rects cover the text, not the line box, so at any line-height above 1 the leftover
  // is dead space. That showed up both as stripes through the highlight and as a strip the
  // cursor could cross without hitting any rect, dropping the hover on every line change.
  const banded = [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, slot]) => {
      const top = gridOrigin + index * lineBox
      return { left: slot.left, right: slot.right, top, bottom: top + lineBox }
    })

  return [...banded, ...freeStanding]
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
  // pre-segmenting the article, whose cost would scale with its length.
  //
  // Hit testing runs against the same merged line rects that get painted, so the region that
  // responds to the cursor is exactly the region that lights up.
  for (const sentence of sentencesIn(block, locale)) {
    for (const rect of lineRectsForSentence(block, sentence.start, sentence.end)) {
      if (containsPoint(rect, x, y)) return { block, ...sentence }
    }
  }

  return null
}
