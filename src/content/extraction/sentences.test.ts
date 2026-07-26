import { describe, expect, it } from 'vitest'
import { rangeForSentence, sentencesIn, withoutCitations } from './sentences'

/** Sentences are read off a real element, since that is what the hit-tester passes. */
function block(html: string): HTMLElement {
  const el = document.createElement('p')
  el.innerHTML = html
  return el
}

const textsIn = (html: string): string[] => sentencesIn(block(html), 'en').map((s) => s.text)

describe('sentencesIn', () => {
  it('keeps a footnote marker attached to the sentence it references', () => {
    // UAX #29 classifies `[` as Close punctuation and breaks after the run following a
    // terminator, so the segmenter alone yields `knowledge.[` + `15] However…`. Correct per
    // the spec, wrong for a citation, which belongs to the sentence before it.
    expect(textsIn('A claim about knowledge.[15] However, others disagree.')).toEqual([
      'A claim about knowledge.[15]',
      'However, others disagree.',
    ])
  })

  it('keeps a run of several markers together', () => {
    expect(textsIn('A claim.[3][5] Another claim.')).toEqual(['A claim.[3][5]', 'Another claim.'])
  })

  it('handles a lettered marker mid-sentence without splitting there', () => {
    expect(textsIn('An encyclopedia[a] is a reference work. It is long.')).toEqual([
      'An encyclopedia[a] is a reference work.',
      'It is long.',
    ])
  })

  it('does not split where the source html merely wrapped a line', () => {
    // UAX #29 rule SB4 breaks after any line feed, so a pretty-printed page splits a
    // sentence at every newline in its markup. Found by the extension suite against an
    // indented fixture; invisible on Wikipedia, whose paragraphs are mostly one long line.
    const el = block('')
    el.textContent =
      'A tide is caused by the combined effects of\n        gravitational forces exerted by the Moon. Next sentence here.'

    expect(sentencesIn(el, 'en').map((s) => s.text)).toEqual([
      'A tide is caused by the combined effects of gravitational forces exerted by the Moon.',
      'Next sentence here.',
    ])
  })

  it('reports text as rendered, with markup whitespace collapsed', () => {
    // Offsets still index the raw textContent, because a Range is built over that.
    const el = block('')
    el.textContent = 'Spread\n   over\n   lines.'
    const [only] = sentencesIn(el, 'en')

    expect(only!.text).toBe('Spread over lines.')
    expect(el.textContent!.slice(only!.start, only!.end)).toBe('Spread\n   over\n   lines.')
  })

  it('still splits a genuine boundary that happens to fall at a newline', () => {
    const el = block('')
    el.textContent = 'First sentence ends here.\n   Second one starts here.'

    expect(sentencesIn(el, 'en').map((s) => s.text)).toEqual([
      'First sentence ends here.',
      'Second one starts here.',
    ])
  })

  it('does not split on the periods inside abbreviations or decimals', () => {
    // The reason segmentation uses Intl.Segmenter rather than splitting on `.` — this is
    // what a regex would get wrong, and why the citation fix goes around the segmenter
    // rather than replacing it.
    expect(textsIn('The U.S. ratified it. See Fig. 2 for the 3.5 percent case.')).toEqual([
      'The U.S. ratified it.',
      'See Fig. 2 for the 3.5 percent case.',
    ])
  })

  it('reads through inline markup as one continuous string', () => {
    expect(textsIn('An <a href="#">encyclopedia</a> is a <b>reference</b> work. Next.')).toEqual([
      'An encyclopedia is a reference work.',
      'Next.',
    ])
  })

  it('trims the gap between sentences out of both offsets and text', () => {
    const [first] = sentencesIn(block('First one.   Second one.'), 'en')

    expect(first!.text).toBe('First one.')
    expect(first!.start).toBe(0)
    expect(first!.end).toBe('First one.'.length)
  })

  it('drops empty segments rather than emitting blank sentences', () => {
    expect(textsIn('   ')).toEqual([])
    expect(textsIn('One.    ')).toEqual(['One.'])
  })
})

describe('rangeForSentence', () => {
  it('spans the text nodes an offset range crosses', () => {
    const el = block('An <a href="#">encyclopedia</a> is a <b>reference</b> work. Next.')
    const [first] = sentencesIn(el, 'en')
    const range = rangeForSentence(el, first!.start, first!.end)

    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('An encyclopedia is a reference work.')
  })

  it('locates a sentence that starts partway through a text node', () => {
    const el = block('First one. Second one.')
    const [, second] = sentencesIn(el, 'en')
    const range = rangeForSentence(el, second!.start, second!.end)

    expect(range!.toString()).toBe('Second one.')
  })

  /**
   * The offset contract, and the reason the excluded nodes are filtered in ONE function that
   * both halves call. Offsets index the joined text; the range walks the nodes. Filter in one
   * and not the other and every sentence past the first excluded node slides by its length —
   * the highlight lands on the wrong words while the clipped text is still right, which is a
   * long way from anywhere obvious to look.
   */
  it('still points at the right words when the block holds something excluded', () => {
    const el = block(
      '<span aria-hidden="true">decorative junk</span>First one. Second one.',
    )
    const [, second] = sentencesIn(el, 'en')
    const range = rangeForSentence(el, second!.start, second!.end)

    expect(range!.toString()).toBe('Second one.')
  })
})

/**
 * Text that lives in the block without being of it. The one that was actually seen in the
 * journal is MediaWiki's section-edit link: every Wikipedia heading carries one, so a clipped
 * heading read `Overview[edit]` — and where the heading ended in a terminator and markup
 * whitespace fell between the two, it segmented into a clipping whose whole text was `[edit]`.
 */
describe('what a block refuses to read', () => {
  const heading = (html: string): string[] => {
    const el = document.createElement('h2')
    el.innerHTML = html
    return sentencesIn(el, 'en').map((s) => s.text)
  }

  it('leaves a section-edit link out of the heading it is stapled to', () => {
    expect(heading('Overview<span class="mw-editsection">[edit]</span>')).toEqual(['Overview'])
  })

  /** The shape that produced a clipping reading only `[edit]`: a terminator, then whitespace. */
  it('does not let one become a sentence of its own', () => {
    expect(
      heading('What is it?\n<span class="mw-editsection"><span>[</span><a>edit</a><span>]</span></span>'),
    ).toEqual(['What is it?'])
  })

  it('ignores script bodies and anything the page has hidden', () => {
    expect(textsIn('Real prose.<script>var x = "Fake sentence.";</script>')).toEqual([
      'Real prose.',
    ])
    expect(textsIn('Real prose.<span hidden>Hidden sentence.</span>')).toEqual(['Real prose.'])
  })
})

/**
 * The presentation half of citation markers. Segmentation keeps them (they are part of what the
 * page renders, and the text directive is matched against that); everything a reader looks at
 * takes them out.
 */
describe('withoutCitations', () => {
  it('takes out the footnote shapes pages actually use', () => {
    expect(withoutCitations('…as the cells respire.[15]')).toBe('…as the cells respire.')
    expect(withoutCitations('Photosynthesis[a] is a process.')).toBe('Photosynthesis is a process.')
    expect(withoutCitations('A claim.[citation needed]')).toBe('A claim.')
    expect(withoutCitations('Chlorophyll absorbs light.[note 3]')).toBe('Chlorophyll absorbs light.')
  })

  it('takes out a whole run of them', () => {
    expect(withoutCitations('Both are true.[3][5][12]')).toBe('Both are true.')
  })

  it('closes the gap a marker leaves mid-sentence', () => {
    expect(withoutCitations('The cycle [1] fixes carbon.')).toBe('The cycle fixes carbon.')
  })

  /**
   * The line this pattern deliberately draws. Deleting is not the cheap guess that placing a
   * boundary is, so anything that is not shaped like a footnote is left where the page put it —
   * a bracketed aside is the author's words, not the encyclopedia's plumbing.
   */
  it('leaves bracketed prose alone', () => {
    expect(withoutCitations('The array [1, 2, 3] is sorted.')).toBe('The array [1, 2, 3] is sorted.')
    expect(withoutCitations('He said [the author] disagreed.')).toBe('He said [the author] disagreed.')
  })
})
