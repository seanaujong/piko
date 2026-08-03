import { afterEach, describe, expect, it } from 'vitest'
import { lineBandsFor, lineRectsForSpan, sentencesIn } from './sentences'

/**
 * Real layout, in real Chrome. Every assertion here is about geometry that jsdom cannot
 * produce — it reports all client rects as zero, so these would pass there while measuring
 * nothing. These are the invariants that caused four separate highlight bugs.
 */

let mounted: HTMLElement | null = null

/** A narrow column, so prose reliably wraps to several lines. */
function mount(html: string, style = ''): HTMLElement {
  const host = document.createElement('div')
  host.style.cssText = `position:absolute;top:0;left:0;width:320px;font:16px/1.5 serif;${style}`
  host.innerHTML = html
  document.body.appendChild(host)
  mounted = host
  return host.querySelector('p')!
}

afterEach(() => {
  mounted?.remove()
  mounted = null
})

const gapsBetween = (bands: readonly { top: number; bottom: number }[]): number[] =>
  bands.slice(1).map((band, i) => band.top - bands[i]!.bottom)

const LONG_PROSE =
  'This paragraph is long enough that it has to wrap across several lines in a narrow column, which is the only way to get more than one band out of it.'

describe('lineBandsFor', () => {
  it('produces one band per rendered line', () => {
    const block = mount(`<p>${LONG_PROSE}</p>`)
    const bands = lineBandsFor(block)

    expect(bands.length).toBeGreaterThan(2)
    expect(bands.length).toBe(Math.round(block.getBoundingClientRect().height / 24))
  })

  it('tiles with no seam — adjacent bands share an edge exactly', () => {
    // The invariant. A gap lets a highlight land between lines; an overlap double-paints.
    const block = mount(`<p>${LONG_PROSE}</p>`)
    const gaps = gapsBetween(lineBandsFor(block))

    expect(Math.max(...gaps.map(Math.abs))).toBe(0)
  })

  it('still tiles when line heights differ within one paragraph', () => {
    // Why a line-height lattice was abandoned: an inline image and an oversized span make
    // spacing non-uniform, and a uniform grid drifts until rects land in the wrong slot.
    const block = mount(
      `<p>Ordinary text to begin with here.
       <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            style="height:34px;width:34px" alt="">
       and then <span style="font-size:28px">much larger text</span> followed by more ordinary
       words that carry the paragraph on for another line or two beyond that.</p>`,
    )
    const bands = lineBandsFor(block)
    const heights = bands.map((b) => b.bottom - b.top)

    expect(bands.length).toBeGreaterThan(2)
    // Genuinely non-uniform: if this ever collapses, the fixture stopped testing anything.
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5)
    expect(Math.max(...gapsBetween(bands).map(Math.abs))).toBe(0)
  })

  it('gives a single-line block real height rather than collapsing to the text', () => {
    const block = mount('<p>Just one line.</p>')
    const [band] = lineBandsFor(block)

    expect(band!.bottom - band!.top).toBeGreaterThan(0)
  })

  it('keeps a superscript on the line it sits on instead of opening a new one', () => {
    const plain = lineBandsFor(mount('<p>A short claim here.</p>'))
    mounted?.remove()
    const cited = lineBandsFor(mount('<p>A short claim here.<sup>[15]</sup></p>'))

    expect(cited).toHaveLength(plain.length)
  })
})

describe('lineRectsForSpan', () => {
  const withMarkup =
    '<p>An <a href="#">encyclopedia</a> is a <b>reference work</b> or <sub>compendium</sub> ' +
    'providing summaries of knowledge, either general or special, in a particular field. Next sentence.</p>'

  it('emits one rect per visual line, not one per inline run', () => {
    // Range.getClientRects() returns a rect for each inline element crossed AND the text run
    // inside it. Painted translucently, those duplicates read as a darker patch on every
    // link and bold run.
    const block = mount(withMarkup)
    const [first] = sentencesIn(block, 'en')
    const rects = lineRectsForSpan(block, first!.start, first!.end)

    const raw = [...document.createRange().getClientRects()]
    expect(rects.length).toBeLessThan(8)
    expect(new Set(rects.map((r) => r.top)).size).toBe(rects.length)
    void raw
  })

  it('produces no overlapping rects, which is what caused the doubling', () => {
    const block = mount(withMarkup)
    const [first] = sentencesIn(block, 'en')
    const rects = lineRectsForSpan(block, first!.start, first!.end)

    for (let i = 1; i < rects.length; i += 1) {
      const overlap = Math.min(rects[i - 1]!.bottom, rects[i]!.bottom) - rects[i]!.top
      expect(overlap).toBeLessThanOrEqual(0)
    }
  })

  it('takes its vertical extent from the band, never from the sentence own rects', () => {
    // Sizing a mark from the sentence's own rects moved it — measured at -4.33px between two
    // lines of one sentence. Sentences sharing a line must produce identical top/bottom no
    // matter how differently tall their own content is.
    //
    // The font-size contrast is load-bearing: an earlier version of this test used bold vs
    // plain, which Chrome reports at the SAME rect top, so it passed even with the bug
    // reintroduced. It proved nothing until it was watched failing.
    const block = mount(
      '<p>Plain opening. <span style="font-size:30px">Tall middle.</span> Plain end.</p>',
      'width:900px',
    )
    const sentences = sentencesIn(block, 'en')
    const bands = lineBandsFor(block)
    const firstRects = sentences.map((s) => lineRectsForSpan(block, s.start, s.end, bands)[0]!)

    expect(bands).toHaveLength(1)
    expect(sentences.length).toBeGreaterThan(1)
    expect(new Set(firstRects.map((r) => r.top)).size).toBe(1)
    expect(new Set(firstRects.map((r) => r.bottom)).size).toBe(1)
  })

  it('covers every band the sentence spans', () => {
    const block = mount(`<p>${LONG_PROSE}</p>`)
    const [only] = sentencesIn(block, 'en')
    const bands = lineBandsFor(block)
    const rects = lineRectsForSpan(block, only!.start, only!.end, bands)

    expect(rects).toHaveLength(bands.length)
  })

  it('returns nothing for a range that does not resolve', () => {
    const block = mount('<p>Short.</p>')

    expect(lineRectsForSpan(block, 9_999, 10_000)).toEqual([])
  })
})

/**
 * A passage is painted as one stretch of prose rather than as the sentences it is made of.
 * That is the whole visible difference between keeping two sentences and keeping one note of
 * two sentences, and it is geometry — jsdom would report every rect here as zero.
 */
describe('a passage of several sentences', () => {
  it('paints one box across the line two sentences share, not one each', () => {
    const block = mount('<p>Plain opening. Second sentence here.</p>', 'width:900px')
    const sentences = sentencesIn(block, 'en')
    const bands = lineBandsFor(block)

    expect(bands).toHaveLength(1)
    expect(sentences).toHaveLength(2)

    const asOne = lineRectsForSpan(block, sentences[0]!.start, sentences[1]!.end, bands)
    const separately = sentences.map((s) => lineRectsForSpan(block, s.start, s.end, bands)[0]!)

    // One box, where two sentences kept apart make two — with the gap between them left
    // unpainted, which is what a note broken into its sentences looks like on the page.
    expect(asOne).toHaveLength(1)
    expect(separately[0]!.right).toBeLessThan(separately[1]!.left)
    expect(asOne[0]!.left).toBe(separately[0]!.left)
    expect(asOne[0]!.right).toBe(separately[1]!.right)
  })

  it('covers every band the run spans, however many lines that takes', () => {
    const block = mount(`<p>${LONG_PROSE} ${LONG_PROSE}</p>`)
    const sentences = sentencesIn(block, 'en')
    const bands = lineBandsFor(block)

    expect(sentences).toHaveLength(2)

    const rects = lineRectsForSpan(block, sentences[0]!.start, sentences[1]!.end, bands)

    expect(rects).toHaveLength(bands.length)
    expect(bands.length).toBeGreaterThan(2)
  })
})
