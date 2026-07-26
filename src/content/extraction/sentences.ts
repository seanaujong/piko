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

/** Footnote markers trailing a sentence, as `[15]` or `[3][5]` or `[a]`. */
const TRAILING_CITATIONS = /^(?:\[[^[\]]{0,24}\])+/

/**
 * A marker specific enough to be safe to DELETE, which is a stricter question than the one
 * `TRAILING_CITATIONS` answers, and the reason these are two patterns rather than one.
 *
 * Placing a boundary is a cheap guess: overshoot a bracket that wasn't a citation and the
 * sentence starts a few characters off. Deleting is not — every character removed is one the
 * reader wrote or read, so this names the shapes footnotes actually take instead of accepting
 * anything bracketed and short.
 *
 * The collateral it knowingly accepts: an index written `arr[i]` in flowing prose is
 * indistinguishable from a lettered footnote and loses its subscript. It costs a display, never
 * a link — `Clipping.text` keeps the original, so the text directive still matches the page.
 */
const CITATION = / ?\[(?:\d{1,4}|[a-z]|[ivxlc]{1,5}|note \d{1,3}|citation needed)\]/gi

/**
 * The sentence as a reader wants to *see* it, with footnote markers taken out.
 *
 * Every presentation of a clipping goes through this — the journal row, the clipboard, the
 * exported file. What must not is the text directive: the browser matches against the page's
 * rendered text, and `[15]` is genuinely part of that, so a stripped string would match nothing.
 * That split is why stripping happens here at the point of display rather than at the point of
 * clipping. The stored text stays exactly what the page said.
 *
 * A marker takes the space in front of it when it has one, which is what closes the gap in
 * `the cycle [1] fixes carbon`. Nothing else about the string is touched — a sentence carrying
 * no markers comes back identical, so this can never be the reason displayed text differs from
 * what was clipped.
 */
export const withoutCitations = (text: string): string => text.replace(CITATION, '')

/**
 * Moves a boundary that landed inside a bracket to just past the whole citation run.
 *
 * UAX #29 classifies `[` as Close punctuation and breaks *after* the run of Close characters
 * following a terminator, so `knowledge.[15] However` segments as `knowledge.[` + `15] However`.
 * That is correct per the spec — but a footnote marker is not punctuation belonging to the
 * following sentence, it is a reference attached to the one before it.
 */
function pastCitation(text: string, index: number, depthBefore: number): number {
  if (depthBefore <= 0) return index

  let depth = depthBefore
  let cursor = index
  while (depth > 0 && cursor < text.length) {
    const char = text[cursor]
    if (char === '[') depth += 1
    else if (char === ']') depth -= 1
    cursor += 1
  }

  // `.[3][5]` breaks inside the first bracket, so keep going while more markers follow.
  const following = TRAILING_CITATIONS.exec(text.slice(cursor))
  return cursor + (following ? following[0].length : 0)
}

const TERMINATORS = '.!?…。！？'

/**
 * Whether the text before `index` actually finished a sentence.
 *
 * UAX #29 rule SB4 breaks after every paragraph separator, and a line feed is one — so a
 * page whose HTML is pretty-printed splits mid-sentence at each source newline. That is a
 * real boundary for the spec and a wrong one for prose, since the newline is markup
 * whitespace the browser renders as a single space.
 *
 * Scanning back over whitespace, any citation run, and closing quotes/brackets, a genuine
 * boundary lands on a terminator; a wrapped line lands on an ordinary word character.
 */
function endsSentence(text: string, index: number): boolean {
  let cursor = index - 1

  for (;;) {
    while (cursor >= 0 && /\s/.test(text[cursor]!)) cursor -= 1
    if (cursor >= 0 && text[cursor] === ']') {
      const opened = text.lastIndexOf('[', cursor)
      if (opened >= 0) {
        cursor = opened - 1
        continue
      }
    }
    break
  }

  while (cursor >= 0 && /["'”’»)\]]/.test(text[cursor]!)) cursor -= 1
  return cursor >= 0 && TERMINATORS.includes(text[cursor]!)
}

/**
 * One block's prose, split into sentences.
 *
 * `Intl.Segmenter` does the splitting, not a regex over `.` — a full stop is a sentence
 * boundary far less often than it looks, and the segmenter already knows that `U.S.`, `Fig. 2`
 * and `3.5` are not three sentences each. What it gets wrong is narrower and is corrected in
 * two places below: it breaks after a citation run (`pastCitation`) and after every line feed
 * (`endsSentence`). Both corrections are load-bearing, and replacing the whole thing with a
 * split on punctuation trades two known bugs for a great many unknown ones.
 *
 * Only the block under the cursor is ever segmented, and only once. A long article runs to
 * well over a thousand sentences; segmenting all of them up front, or attaching a listener per
 * sentence, would make per-frame cost scale with article length for no benefit.
 */
export function sentencesIn(block: HTMLElement, locale: string): Sentence[] {
  const cached = segmentedBlocks.get(block)
  if (cached) return cached

  // Not `block.textContent`: that reads every descendant, UI affordances and hidden nodes
  // included, and `rangeForSentence` has to be able to point back at whatever this counted.
  const text = textNodesIn(block)
    .map((node) => node.data)
    .join('')

  // Bracket depth at every index, computed in one pass so each boundary is an O(1) lookup.
  const depthAt = new Int32Array(text.length + 1)
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const delta = char === '[' ? 1 : char === ']' ? -1 : 0
    depthAt[i + 1] = Math.max(0, depthAt[i]! + delta)
  }

  const starts: number[] = []
  for (const { index } of segmenterFor(locale).segment(text)) {
    const adjusted = pastCitation(text, index, depthAt[index] ?? 0)
    if (starts.length === 0) {
      starts.push(adjusted)
      continue
    }
    // A boundary pushed past a citation can land on or beyond the next one, which then has
    // nothing left to describe.
    if (adjusted <= starts[starts.length - 1]!) continue
    // A break the segmenter took at a line feed rather than at a terminator is markup
    // whitespace, not prose — see endsSentence.
    if (!endsSentence(text, adjusted)) continue
    starts.push(adjusted)
  }

  const sentences: Sentence[] = []
  starts.forEach((start, position) => {
    const slice = text.slice(start, starts[position + 1] ?? text.length)
    const trimmed = slice.trim()
    if (trimmed.length === 0) return

    // Whitespace either side belongs to the gap between sentences, not to the sentence: left
    // in, it paints a ragged edge past the full stop and rides along into the clipped text.
    // Leading space matters here because pushing a boundary past a citation leaves the space
    // that followed it at the head of the next sentence.
    const offset = slice.length - slice.trimStart().length
    sentences.push({
      // Offsets index the raw textContent, because that is what a Range is built over.
      start: start + offset,
      end: start + offset + trimmed.length,
      // The text is the sentence as *rendered*, with markup whitespace collapsed the way the
      // browser collapses it. Stored clippings and the lookup that relocates them both come
      // from here, so they normalise together; leaving the newlines in would also break the
      // Markdown export, where a raw line break escapes the blockquote.
      text: trimmed.replace(/\s+/g, ' '),
    })
  })

  segmentedBlocks.set(block, sentences)
  return sentences
}

/**
 * Every sentence in `container` whose text is one of `texts`.
 *
 * Stored clippings are plain text, so painting them again means finding them again in
 * whatever DOM is currently rendered. Matching on text rather than on a stored node path is
 * what lets a clipping survive re-extraction, a reader/framed toggle, a reload, and — since
 * the same lookup runs against the live page — being taken on one surface and shown on the
 * other.
 */
export function findSentences(
  container: HTMLElement,
  locale: string,
  texts: ReadonlySet<string>,
): SentenceHit[] {
  if (texts.size === 0) return []

  const hits: SentenceHit[] = []
  for (const block of container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    for (const sentence of sentencesIn(block, locale)) {
      if (texts.has(sentence.text)) hits.push({ block, ...sentence })
    }
  }
  return hits
}

/**
 * Descendants whose text is in the block but is not of it.
 *
 * Most of these are unambiguous: a `<script>` body, something the page has marked `hidden` or
 * `aria-hidden`, the label inside a form control. `.mw-editsection` is not a category but an
 * observation — MediaWiki appends a section-editing link to every heading, so a Wikipedia
 * heading reads as `Overview[edit]` and, when the heading ends in a terminator and markup
 * whitespace separates the two, segments into a clipping whose entire text is `[edit]`.
 *
 * That affordance is a whole genre — Sphinx, Docusaurus and AnchorJS each staple their own
 * permalink onto headings — but only this one has actually been seen in the journal, so only
 * this one is named. Add the next when it shows up, with the same evidence.
 */
const NOT_PROSE =
  'script, style, noscript, template, button, input, select, textarea, [role="button"], [aria-hidden="true"], [hidden], .mw-editsection'

/** Whether a text node sits inside something the block should not read text from. */
function insideNonProse(node: Text, block: HTMLElement): boolean {
  for (let element = node.parentElement; element !== null; element = element.parentElement) {
    if (element.matches(NOT_PROSE)) return true
    if (element === block) return false
  }
  return false
}

/**
 * The text nodes a reader would say the block is made of.
 *
 * The single source for both halves of the offset contract, and that is the point of it being
 * one function. `sentencesIn` joins these into the string it segments, and `rangeForSentence`
 * walks the same list counting the same lengths — so an offset means the same thing on both
 * sides by construction. Filtering in one and not the other would slide every sentence after
 * the first excluded node, painting a highlight over the wrong words.
 */
function textNodesIn(block: HTMLElement): Text[] {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text
    if (!insideNonProse(text, block)) nodes.push(text)
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
