import { describe, expect, it } from 'vitest'
import type { Passage } from './sentences'
import {
  findPassages,
  noteCovering,
  passageExtendedTo,
  rangeForSpan,
  sentencesIn,
  withoutCitations,
} from './sentences'

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

describe('rangeForSpan', () => {
  it('spans the text nodes an offset range crosses', () => {
    const el = block('An <a href="#">encyclopedia</a> is a <b>reference</b> work. Next.')
    const [first] = sentencesIn(el, 'en')
    const range = rangeForSpan(el, first!.start, first!.end)

    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('An encyclopedia is a reference work.')
  })

  it('locates a sentence that starts partway through a text node', () => {
    const el = block('First one. Second one.')
    const [, second] = sentencesIn(el, 'en')
    const range = rangeForSpan(el, second!.start, second!.end)

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
    const range = rangeForSpan(el, second!.start, second!.end)

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

/**
 * A clipping is a contiguous run of sentences in one block, and one sentence is the run of
 * length one. The fixture is the passage that prompted the feature: two sentences that are one
 * thought, where keeping only the first keeps a fact without the reason it mattered.
 */
describe('passages', () => {
  const FIRST =
    'JavaScript (also known as ECMAScript) started its life as a simple scripting language for browsers.'
  const SECOND =
    'At the time it was invented, it was expected to be used for short snippets of code embedded in a web page — writing more than a few dozen lines of code would have been somewhat unusual.'
  const THIRD = 'For this reason, web browsers were slow to adopt it.'

  /** A container of `<p>` blocks, since that is what the hit-tester is pointed at. */
  function article(...paragraphs: string[]): HTMLElement {
    const el = document.createElement('div')
    el.innerHTML = paragraphs.map((text) => `<p>${text}</p>`).join('')
    return el
  }

  const sentenceIn = (container: HTMLElement, index: number): Passage => {
    const block = container.querySelector('p')!
    const sentence = sentencesIn(block, 'en')[index]!
    return { block, ...sentence }
  }

  describe('findPassages', () => {
    it('finds a run of two sentences stored as one text', () => {
      const container = article([FIRST, SECOND].join(' '))
      const [found, ...rest] = findPassages(container, 'en', new Set([`${FIRST} ${SECOND}`]))

      expect(rest).toEqual([])
      expect(found!.text).toBe(`${FIRST} ${SECOND}`)
      // The span reaches from the first sentence's start to the second's end, which is what
      // lets one Range and one set of line bands paint the whole passage.
      expect(found!.start).toBe(sentenceIn(container, 0).start)
      expect(found!.end).toBe(sentenceIn(container, 1).end)
    })

    it('still finds a lone sentence, which is the run of one', () => {
      const container = article([FIRST, SECOND].join(' '))
      const found = findPassages(container, 'en', new Set([SECOND]))

      expect(found.map((p) => p.text)).toEqual([SECOND])
    })

    it('finds a run that starts partway into the block', () => {
      const container = article([FIRST, SECOND, THIRD].join(' '))
      const found = findPassages(container, 'en', new Set([`${SECOND} ${THIRD}`]))

      expect(found.map((p) => p.text)).toEqual([`${SECOND} ${THIRD}`])
      expect(found[0]!.start).toBe(sentenceIn(container, 1).start)
    })

    /**
     * The block is the limit. Two sentences that read consecutively but sit in different
     * paragraphs are not one passage, because there is no single element to measure a run
     * against — see `Passage`.
     */
    it('never joins across a block boundary', () => {
      const container = article(FIRST, SECOND)

      expect(findPassages(container, 'en', new Set([`${FIRST} ${SECOND}`]))).toEqual([])
    })

    it('finds nothing when asked for nothing', () => {
      expect(findPassages(article(FIRST), 'en', new Set())).toEqual([])
    })
  })

  describe('passageExtendedTo', () => {
    /** Clip the first sentence, then reach forward to the second — the whole point of this. */
    it('grows the note in the block to reach the clicked sentence', () => {
      const container = article([FIRST, SECOND].join(' '))
      const kept = sentenceIn(container, 0)

      const extension = passageExtendedTo(sentenceIn(container, 1), [kept], 'en')

      expect(extension!.grown.text).toBe(`${FIRST} ${SECOND}`)
      expect(extension!.grown.start).toBe(kept.start)
      expect(extension!.grown.end).toBe(sentenceIn(container, 1).end)
      // The note it grew from leaves the journal; the grown one stands in its place.
      expect(extension!.supersedes.map((p) => p.text)).toEqual([FIRST])
    })

    it('grows backwards just as readily', () => {
      const container = article([FIRST, SECOND].join(' '))
      const kept = sentenceIn(container, 1)

      const extension = passageExtendedTo(sentenceIn(container, 0), [kept], 'en')

      expect(extension!.grown.text).toBe(`${FIRST} ${SECOND}`)
      expect(extension!.supersedes.map((p) => p.text)).toEqual([SECOND])
    })

    /**
     * Reaching past a sentence takes it too. Leaving it out would make the stored text differ
     * from the stretch that lights up, and the highlight is the only account of what a note
     * holds.
     */
    it('takes in whatever it reached over', () => {
      const container = article([FIRST, SECOND, THIRD].join(' '))
      const kept = sentenceIn(container, 0)

      const extension = passageExtendedTo(sentenceIn(container, 2), [kept], 'en')

      expect(extension!.grown.text).toBe(`${FIRST} ${SECOND} ${THIRD}`)
    })

    /**
     * A note between the anchor and the click cannot arise from the rule itself — anything
     * lying between them would be nearer the click than the anchor is, and would have been
     * the anchor. So this feeds it the overlap it cannot produce: a journal already holding
     * both a sentence and a passage containing it, which is what an older journal or a
     * hand-edited store can look like. The span covers both, so both are superseded and the
     * journal comes out clean rather than carrying a sentence that belongs to two notes.
     */
    it('supersedes every note the new span covers, repairing overlap it finds', () => {
      const container = article([FIRST, SECOND, THIRD].join(' '))
      const block = container.querySelector('p')!
      const sentences = sentencesIn(block, 'en')
      const alone = sentenceIn(container, 0)
      const overlapping: Passage = {
        block,
        start: sentences[0]!.start,
        end: sentences[1]!.end,
        text: `${FIRST} ${SECOND}`,
      }

      const extension = passageExtendedTo(sentenceIn(container, 2), [alone, overlapping], 'en')

      expect(extension!.grown.text).toBe(`${FIRST} ${SECOND} ${THIRD}`)
      expect(extension!.supersedes.map((p) => p.text).sort()).toEqual(
        [FIRST, `${FIRST} ${SECOND}`].sort(),
      )
    })

    /**
     * Equidistant notes either side, which is the one case where "nearest" does not decide.
     * The tie goes to the note that reads first, so the gesture stays predictable; joining
     * both is still available, as a second reach.
     */
    it('grows the earlier note when two are equally near', () => {
      const container = article([FIRST, SECOND, THIRD].join(' '))
      const before = sentenceIn(container, 0)
      const after = sentenceIn(container, 2)

      const extension = passageExtendedTo(sentenceIn(container, 1), [before, after], 'en')

      expect(extension!.grown.text).toBe(`${FIRST} ${SECOND}`)
      expect(extension!.supersedes.map((p) => p.text)).toEqual([FIRST])
    })

    it('grows the nearest note rather than the first one', () => {
      const container = article([FIRST, SECOND, THIRD].join(' '))
      const far = sentenceIn(container, 0)
      const near = sentenceIn(container, 1)

      const extension = passageExtendedTo(sentenceIn(container, 2), [far, near], 'en')

      expect(extension!.grown.text).toBe(`${SECOND} ${THIRD}`)
      expect(extension!.supersedes.map((p) => p.text)).toEqual([SECOND])
    })

    it('keeps the clicked sentence alone when the block holds no note yet', () => {
      const container = article([FIRST, SECOND].join(' '))

      const extension = passageExtendedTo(sentenceIn(container, 1), [], 'en')

      expect(extension!.grown.text).toBe(SECOND)
      expect(extension!.supersedes).toEqual([])
    })

    /** A note in another paragraph is not the note being reached from. */
    it('ignores notes in other blocks', () => {
      const container = article(FIRST, SECOND)
      const elsewhere = container.querySelectorAll('p')[0]!
      const kept: Passage = { block: elsewhere, ...sentencesIn(elsewhere, 'en')[0]! }

      const here = container.querySelectorAll('p')[1]!
      const hit: Passage = { block: here, ...sentencesIn(here, 'en')[0]! }

      const extension = passageExtendedTo(hit, [kept], 'en')

      expect(extension!.grown.text).toBe(SECOND)
      expect(extension!.supersedes).toEqual([])
    })

    /**
     * Nothing to do, said as nothing rather than as a write that changes nothing — the click
     * is left to the page instead of being swallowed. Shrinking is deliberately not a gesture;
     * a plain click removes the whole note, which is the way back.
     */
    it('refuses when the note already reaches here', () => {
      const container = article([FIRST, SECOND].join(' '))
      const block = container.querySelector('p')!
      const both = sentencesIn(block, 'en')
      const whole: Passage = {
        block,
        start: both[0]!.start,
        end: both[1]!.end,
        text: `${FIRST} ${SECOND}`,
      }

      expect(passageExtendedTo(sentenceIn(container, 0), [whole], 'en')).toBeNull()
      expect(passageExtendedTo(sentenceIn(container, 1), [whole], 'en')).toBeNull()
    })

    /**
     * The gesture that used to do nothing. Two notes side by side is exactly the arrangement a
     * reader wants joined, and the old rule made it the one arrangement it could not touch: the
     * nearest note to a reach landing on a note is that note itself, at distance zero, so the
     * span never grew and the reach returned null.
     */
    it('joins the note the reach lands on', () => {
      const container = article([FIRST, SECOND].join(' '))
      const alone = sentenceIn(container, 0)
      const beside = sentenceIn(container, 1)

      const extension = passageExtendedTo(beside, [alone, beside], 'en')

      expect(extension!.grown.text).toBe(`${FIRST} ${SECOND}`)
      expect(extension!.supersedes.map((p) => p.text).sort()).toEqual([FIRST, SECOND].sort())
    })

    /** Reaching from a note is the same gesture whichever of the two the cursor is on. */
    it('joins the note the reach comes from, reached the other way', () => {
      const container = article([FIRST, SECOND].join(' '))
      const alone = sentenceIn(container, 0)
      const beside = sentenceIn(container, 1)

      const extension = passageExtendedTo(alone, [alone, beside], 'en')

      expect(extension!.grown.text).toBe(`${FIRST} ${SECOND}`)
      expect(extension!.supersedes.map((p) => p.text).sort()).toEqual([FIRST, SECOND].sort())
    })

    /**
     * A note the span reaches into but does not cover would be superseded whole and replaced by
     * something shorter, so the reader would join two sentences and watch a third leave the
     * journal. The span takes such a note whole instead.
     */
    it('takes a note it reaches into whole, rather than truncating it', () => {
      const container = article([FIRST, SECOND, THIRD].join(' '))
      const block = container.querySelector('p')!
      const sentences = sentencesIn(block, 'en')
      const alone = sentenceIn(container, 0)
      const pair: Passage = {
        block,
        start: sentences[1]!.start,
        end: sentences[2]!.end,
        text: `${SECOND} ${THIRD}`,
      }

      // Reaching the pair's FIRST sentence: the span alone would stop at the end of SECOND.
      const extension = passageExtendedTo(sentenceIn(container, 1), [alone, pair], 'en')

      expect(extension!.grown.text).toBe(`${FIRST} ${SECOND} ${THIRD}`)
      expect(extension!.supersedes.map((p) => p.text).sort()).toEqual(
        [FIRST, `${SECOND} ${THIRD}`].sort(),
      )
    })
  })

  /**
   * What the cursor is on. The hit-test answers with a sentence; every gesture means the note
   * that sentence belongs to, and this is the one place that translation happens.
   */
  describe('noteCovering', () => {
    it('answers with the whole note holding the sentence under the cursor', () => {
      const container = article([FIRST, SECOND].join(' '))
      const block = container.querySelector('p')!
      const sentences = sentencesIn(block, 'en')
      const whole: Passage = {
        block,
        start: sentences[0]!.start,
        end: sentences[1]!.end,
        text: `${FIRST} ${SECOND}`,
      }

      // Either sentence of the note, including the later one that is not equal to it.
      expect(noteCovering(sentenceIn(container, 0), [whole])).toBe(whole)
      expect(noteCovering(sentenceIn(container, 1), [whole])).toBe(whole)
    })

    it('answers with nothing when no note holds it', () => {
      const container = article([FIRST, SECOND].join(' '))

      expect(noteCovering(sentenceIn(container, 1), [sentenceIn(container, 0)])).toBeNull()
      expect(noteCovering(sentenceIn(container, 0), [])).toBeNull()
    })

    /** A note in another paragraph holds nothing here, however the offsets line up. */
    it('never answers with a note from another block', () => {
      const container = article(FIRST, FIRST)
      const [there, here] = [...container.querySelectorAll('p')]
      const kept: Passage = { block: there!, ...sentencesIn(there!, 'en')[0]! }
      const hit: Passage = { block: here!, ...sentencesIn(here!, 'en')[0]! }

      expect(noteCovering(hit, [kept])).toBeNull()
    })
  })

  /**
   * The two halves have to agree on how a run reads, or a passage could be taken and never
   * painted again: one builds the text that gets stored, the other looks for it in the page.
   */
  it('stores a grown passage as the text that finds it again', () => {
    const container = article([FIRST, SECOND].join(' '))
    const extension = passageExtendedTo(sentenceIn(container, 1), [sentenceIn(container, 0)], 'en')

    const found = findPassages(container, 'en', new Set([extension!.grown.text]))

    expect(found.map((p) => p.text)).toEqual([extension!.grown.text])
    expect(found[0]!.start).toBe(extension!.grown.start)
    expect(found[0]!.end).toBe(extension!.grown.end)
  })
})
