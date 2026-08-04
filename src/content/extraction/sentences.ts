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

/**
 * What a reader keeps: a contiguous run of sentences inside one block.
 *
 * One sentence is the run of length one, and that is the whole reason this generalises for
 * free. A run is still a single `[start, end)` over the block's text, so the Range, the line
 * bands and the painted rects never learn that anything changed — a two-sentence passage
 * wrapping four lines paints the same four boxes a two-line sentence would.
 *
 * **The block is the limit, and deliberately so.** A run that crossed a `<p>` boundary would
 * have no single element to measure against and no single Range to cover it, so the type
 * itself would have to grow a list of blocks and every consumer would have to loop. A thought
 * that spills across paragraphs is two passages, taken twice; that costs a click and keeps
 * the shape.
 */
export type Passage = Sentence & { block: HTMLElement }

/**
 * What separates two sentences read as one passage.
 *
 * A single space, because that is what the browser renders between them however the source
 * spelled the gap. `sentencesIn` already collapses each sentence's own whitespace, and the
 * only thing that can sit between two consecutive sentences is whitespace — every other
 * character lands inside one sentence or the other, since the slices tile the block's text.
 *
 * Both readers of this go through it: the run built when a reader extends a passage, and the
 * run matched when a stored passage is found again. Joining on different characters in those
 * two places would mean a passage that could be taken but never painted again.
 */
const BETWEEN_SENTENCES = ' '

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
  // included, and `rangeForSpan` has to be able to point back at whatever this counted.
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
 * Every passage in `container` whose text is one of `texts`.
 *
 * Stored clippings are plain text, so painting them again means finding them again in
 * whatever DOM is currently rendered. Matching on text rather than on a stored node path is
 * what lets a clipping survive re-extraction, a reader/framed toggle, a reload, and — since
 * the same lookup runs against the live page — being taken on one surface and shown on the
 * other. A multi-sentence passage keeps that property: it is looked up by the same string it
 * was stored as, so nothing has to remember which sentences it was made of.
 *
 * Every run in a block is a candidate, not only every sentence, which is quadratic in a
 * block's sentence count before the prune below. It stays cheap because the count is *per
 * block* — a paragraph holds a handful — and because a run stops growing the moment it is
 * longer than the longest thing anyone stored. When every clipping is one sentence, which is
 * the ordinary case, that ends each inner loop after a step or two.
 */
export function findPassages(
  container: HTMLElement,
  locale: string,
  texts: ReadonlySet<string>,
): Passage[] {
  if (texts.size === 0) return []

  let longest = 0
  for (const text of texts) longest = Math.max(longest, text.length)

  const passages: Passage[] = []
  for (const block of container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    const sentences = sentencesIn(block, locale)
    for (let first = 0; first < sentences.length; first += 1) {
      let text = ''
      for (let last = first; last < sentences.length; last += 1) {
        const sentence = sentences[last]!
        text = last === first ? sentence.text : text + BETWEEN_SENTENCES + sentence.text
        // Nothing stored is this long, and extending only makes it longer.
        if (text.length > longest) break
        if (texts.has(text)) {
          passages.push({ block, start: sentences[first]!.start, end: sentence.end, text })
        }
      }
    }
  }
  return passages
}

/** How far a point outside a passage sits from it, in characters; 0 when it is inside. */
function distanceTo(passage: Passage, span: { start: number; end: number }): number {
  if (span.start >= passage.end) return span.start - passage.end
  if (span.end <= passage.start) return passage.start - span.end
  return 0
}

/**
 * Whether `passage` already accounts for `hit`.
 *
 * Containment rather than equality, because a passage is a run: the second sentence of a
 * two-sentence note is a hit that note holds without being equal to. Asked as equality, every
 * rule below would treat a note's later sentences as unclipped text.
 */
const covers = (passage: Passage, hit: Passage): boolean =>
  passage.block === hit.block && passage.start <= hit.start && passage.end >= hit.end

/**
 * The note holding the sentence under the cursor, or null when no note holds it.
 *
 * **This is what makes a note, rather than a sentence, the thing a reader points at.** Once a
 * note can be more than one sentence, "what is under the cursor" has two answers — the
 * sentence the hit-test found, and the note that sentence belongs to — and the reader only
 * ever means the second one. A gesture aimed at the smaller answer acts on a fragment: a
 * click meant to drop a note instead files the one sentence it landed on as a second,
 * overlapping note, and a hover meant to light the note lights a third of it.
 *
 * Kept here beside `Passage` rather than in the highlighter, because it is a fact about what
 * a passage is and not about how one is painted — which is also what lets both the hover and
 * the click ask it, instead of each deciding for itself what it is looking at.
 *
 * The first covering note wins. Notes cannot normally overlap, so there is at most one; a
 * journal that arrives already overlapping is repaired by the reach rule below rather than
 * resolved here.
 */
export function noteCovering(hit: Passage, clipped: readonly Passage[]): Passage | null {
  return clipped.find((passage) => covers(passage, hit)) ?? null
}

/** A passage grown to reach somewhere new, and the passages it swallowed getting there. */
export type ExtendedPassage = { grown: Passage; supersedes: readonly Passage[] }

/**
 * The passage that reaching `hit` produces, or null when it would change nothing.
 *
 * This is the whole rule behind extending a note, kept as one pure function so that neither
 * surface — the preview or the live page — carries a copy of it. The reader's gesture says
 * "the thought runs to here"; the rule turns that into a span:
 *
 *  - The note being extended is the **nearest already-clipped passage in the same block that
 *    the reach is not already part of**. Nearest rather than newest, because the reader is
 *    pointing at the page, not at the journal; the note their cursor is beside is the one they
 *    mean. A tie goes to the passage that reads first, which is the common case written down —
 *    clip a sentence, then reach forward to the one after it.
 *  - *Not already part of* is what lets a reach land on a note and join it. Without that
 *    exclusion the nearest note to a reach that lands inside one is the one it landed in, at
 *    distance zero, so reaching the sentence beside a note did the one thing it could not do:
 *    nothing at all, silently, exactly where two notes were begging to be one.
 *  - The new passage covers everything from that note to the click, **including whatever lies
 *    between**. Reaching past a sentence and leaving it out would make the stored text differ
 *    from the highlighted text, and the highlight is the only record of what a note contains.
 *  - Every passage the new span covers is superseded by it, so two notes cannot end up
 *    overlapping. Overlap has no honest reading: the same sentence would belong to two notes,
 *    and the overlapping stretch would paint itself twice.
 *  - A note the span covers only *partly* is taken whole, by growing the span to it. Superseding
 *    a note the span does not cover would delete the rest of that note — the reader would reach
 *    two sentences and watch a third leave the journal.
 *
 * With nothing else clipped in the block there is nothing to reach from, so an unclipped click
 * keeps its own sentence and supersedes nothing — the same thing an ordinary click does — and
 * a click already inside the block's only note returns null, because the note already reaches
 * here. Shrinking one is deliberately not a gesture; a plain click removes the whole passage,
 * which is the way back.
 */
export function passageExtendedTo(
  hit: Passage,
  clipped: readonly Passage[],
  locale: string,
): ExtendedPassage | null {
  const here = clipped.filter((passage) => passage.block === hit.block)
  const anchors = here.filter((passage) => !covers(passage, hit))
  if (anchors.length === 0) return here.length === 0 ? { grown: hit, supersedes: [] } : null

  const anchor = anchors.reduce((nearest, passage) =>
    distanceTo(passage, hit) < distanceTo(nearest, hit) ? passage : nearest,
  )

  // Grown to the union of every note it touches, repeatedly, because swallowing one note can
  // carry the span up against the next. It settles: each pass either takes in a note or stops,
  // and the block holds a fixed number of them.
  let start = Math.min(anchor.start, hit.start)
  let end = Math.max(anchor.end, hit.end)
  for (;;) {
    const touched = here.filter((passage) => passage.start < end && passage.end > start)
    const reach = {
      start: Math.min(start, ...touched.map((passage) => passage.start)),
      end: Math.max(end, ...touched.map((passage) => passage.end)),
    }
    if (reach.start === start && reach.end === end) break
    start = reach.start
    end = reach.end
  }

  const supersedes = here.filter((passage) => passage.start < end && passage.end > start)
  const text = sentencesIn(hit.block, locale)
    .filter((sentence) => sentence.start >= start && sentence.end <= end)
    .map((sentence) => sentence.text)
    .join(BETWEEN_SENTENCES)

  return { grown: { block: hit.block, start, end, text }, supersedes }
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
 * one function. `sentencesIn` joins these into the string it segments, and `rangeForSpan`
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
export function rangeForSpan(block: HTMLElement, start: number, end: number): Range | null {
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
export function lineRectsForSpan(
  block: HTMLElement,
  start: number,
  end: number,
  bands: readonly LineBand[] = lineBandsFor(block),
): LineRect[] {
  const range = rangeForSpan(block, start, end)
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
): Passage | null {
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
    for (const rect of lineRectsForSpan(block, sentence.start, sentence.end, bands)) {
      if (containsPoint(rect, x, y)) return { block, ...sentence }
    }
  }

  return null
}
