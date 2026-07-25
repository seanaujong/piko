/**
 * A long article, generated rather than committed.
 *
 * The paths worth measuring all scale with the *page*, not with the journal, so they need an
 * input the size of a real encyclopedia entry. Saving one would put a megabyte of someone
 * else's prose in the repo and pin the numbers to whatever that page happened to look like;
 * generating it makes the size a knob and keeps the shape explicit.
 *
 * Shape matters as much as size here, because each feature of real markup costs something
 * different: inline elements make `Range.getClientRects()` emit duplicates, citation markers
 * make the segmenter break in the middle of a sentence, and pretty-printed source puts line
 * feeds where UAX #29 sees paragraph breaks. All three are represented.
 *
 * `sentences` is what `sentencesIn` should read back, in document order. A bench asserts that
 * before measuring anything — a generator that has drifted from the segmenter would otherwise
 * produce timings for relocating text that is not in the page.
 */

const WORDS = [
  'tide', 'moon', 'gravity', 'ocean', 'water', 'surface', 'force', 'orbit',
  'cycle', 'coastal', 'current', 'energy', 'motion', 'period', 'range', 'shore',
  'level', 'basin', 'sun', 'earth', 'mass', 'distance', 'effect', 'model',
  'system', 'pattern', 'region', 'season', 'wave', 'depth', 'rise', 'fall',
  'friction', 'bulge', 'resonance', 'harbour', 'estuary', 'sediment', 'transport',
  'satellite', 'record', 'station', 'average', 'variation', 'phase', 'amplitude',
  'prediction', 'navigation',
] as const

/**
 * A linear congruential generator, seeded by the caller.
 *
 * `Math.random()` would make every run measure a different article, so a regression and a
 * different draw would be indistinguishable.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

export type SyntheticArticle = {
  /** Article markup, ready to inject into a container or serve as a page. */
  html: string
  /** Every sentence in it, in document order, exactly as `sentencesIn` reports them. */
  sentences: string[]
}

export function syntheticArticle(paragraphs: number, seed = 20_260_725): SyntheticArticle {
  const random = lcg(seed)
  const upTo = (limit: number): number => Math.floor(random() * limit)
  const word = (): string => WORDS[upTo(WORDS.length)]!

  const sentences: string[] = []
  const blocks: string[] = []
  let ordinal = 0

  /**
   * One sentence, as both the text it reads as and the markup it renders from. The ordinal
   * keeps every sentence in the article unique, so a clipping relocated by text match can only
   * land on the one it came from.
   */
  function sentence(): { text: string; html: string } {
    ordinal += 1
    const body = ['Observation', String(ordinal), ...Array.from({ length: 8 + upTo(14) }, word)]
    const citation = upTo(5) === 0 ? `[${1 + upTo(40)}]` : ''

    // Inline markup the range has to cross is what makes getClientRects emit overlapping
    // duplicates, so a third of the sentences carry some.
    const marked = [...body]
    if (upTo(3) === 0) {
      const at = 2 + upTo(marked.length - 2)
      const tag = (['a', 'b', 'em'] as const)[upTo(3)]!
      marked[at] =
        tag === 'a' ? `<a href="#${ordinal}">${marked[at]}</a>` : `<${tag}>${marked[at]}</${tag}>`
    }

    // A line feed mid-sentence, which the segmenter treats as a paragraph break and
    // `endsSentence` has to reject. A quarter of the sentences are wrapped this way.
    const joined =
      upTo(4) === 0
        ? `${marked.slice(0, 4).join(' ')}\n      ${marked.slice(4).join(' ')}`
        : marked.join(' ')

    return {
      text: `${body.join(' ')}.${citation}`,
      html: `${joined}.${citation ? `<sup>${citation}</sup>` : ''}`,
    }
  }

  for (let index = 0; index < paragraphs; index += 1) {
    // Headings and list items are in BLOCK_SELECTOR too, so the walk should meet them here.
    if (index % 7 === 0) {
      ordinal += 1
      // No terminator, like a real heading: it segments as a single sentence covering the lot.
      const heading = `Section ${ordinal} ${word()} ${word()}`
      sentences.push(heading)
      blocks.push(`<h2>${heading}</h2>`)
    }

    const made = Array.from({ length: 3 + upTo(4) }, sentence)
    for (const item of made) sentences.push(item.text)
    blocks.push(`<p>${made.map((item) => item.html).join(' ')}</p>`)

    if (index % 11 === 5) {
      const items = Array.from({ length: 3 }, sentence)
      for (const item of items) sentences.push(item.text)
      blocks.push(`<ul>${items.map((item) => `<li>${item.html}</li>`).join('')}</ul>`)
    }
  }

  return { html: `<article>${blocks.join('\n')}</article>`, sentences }
}

/** The same article as a whole page, for the suites that serve one over http. */
export function articlePage(title: string, article: SyntheticArticle): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { max-width: 40rem; margin: 2rem auto; font: 16px/1.6 Georgia, serif; }
</style>
</head>
<body>
${article.html}
</body>
</html>`
}
