/**
 * What a store change costs on the page, in real Chrome.
 *
 * Two paths run on every single change to the journal, and neither is scoped to what changed:
 * `findPassages` re-walks and re-segments the container to find where the clipped sentences
 * are, and `repaint()` rebuilds every mark. This measures both against an article the size of
 * a long encyclopedia entry, at journal sizes from one clipping to five hundred.
 *
 * It has to be real Chrome, for the same reason the geometry suite is: jsdom reports every
 * client rect as zero, so `repaint` would "run" without measuring or laying out anything and
 * report a number that means nothing.
 *
 * This prints rather than asserts. The numbers are the input to a design decision — whether
 * relocation should be scoped to the viewport, whether the band machinery should be replaced
 * with the CSS Custom Highlight API — and a bound is only worth pinning once that decision is
 * made. What it does assert is that the article it measured is one the segmenter actually
 * reads back, so the timings are for real work.
 */

import { describe, expect, it } from 'vitest'
import { BLOCK_SELECTOR, findPassages, sentencesIn } from '../src/content/extraction/sentences'
import type { Passage } from '../src/content/extraction/sentences'
import { attachSentenceHighlight } from '../src/content/panel/highlight'
import { PANEL_STYLES } from '../src/content/panel/styles'
import { syntheticArticle } from './article'
import { measure, ms, spread, table } from './report'

/** Roughly the block count of a long Wikipedia entry. */
const PARAGRAPHS = 220

const article = syntheticArticle(PARAGRAPHS)
const LOCALE = 'en'

/**
 * A fresh copy of the article, so nothing is carried over between measurements: `sentencesIn`
 * caches per element in a WeakMap, and re-using one container would measure a warm cache while
 * claiming to measure a cold one.
 */
function mount(): HTMLElement {
  // The real rules, not a hand-written stand-in — `.piko-marks` has to be out of flow, or the
  // hundreds of mark divs become layout boxes and push the article around as they are painted.
  if (!document.querySelector('style[data-bench]')) {
    const style = document.createElement('style')
    style.setAttribute('data-bench', '')
    style.textContent = PANEL_STYLES
    document.head.appendChild(style)
  }

  const wrapper = document.createElement('div')
  wrapper.className = 'piko-article'
  wrapper.style.cssText = 'position: relative; width: 640px; font: 16px/1.6 Georgia, serif;'
  wrapper.innerHTML = article.html
  document.body.replaceChildren(wrapper)
  return wrapper
}

/**
 * `count` sentences spread through the article rather than taken off the front, so relocation
 * walks the whole page to find them the way it would for a journal built over a real read.
 */
function scattered(count: number): Set<string> {
  const stride = Math.max(1, Math.floor(article.sentences.length / count))
  const picked: string[] = []
  for (let index = 0; picked.length < count && index < article.sentences.length; index += stride) {
    picked.push(article.sentences[index]!)
  }
  return new Set(picked)
}

describe('the article this measures', () => {
  it('is one the segmenter reads back exactly as generated', () => {
    const wrapper = mount()
    const read = [...wrapper.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)]
      .flatMap((block) => sentencesIn(block, LOCALE))
      .map((s) => s.text)

    expect(read).toHaveLength(article.sentences.length)

    // Reported as the first disagreeing pair. A deep-equal over a couple of thousand strings
    // prints a diff nobody can read, and the useful information is which one drifted.
    const at = read.findIndex((text, index) => text !== article.sentences[index])
    const detail =
      at < 0
        ? 'none'
        : `#${at}: read ${JSON.stringify(read[at])}, generated ${JSON.stringify(article.sentences[at])}`
    expect(detail).toBe('none')

    console.log(
      `\narticle: ${PARAGRAPHS} paragraphs · ` +
        `${wrapper.querySelectorAll(BLOCK_SELECTOR).length} blocks · ` +
        `${article.sentences.length} sentences · ` +
        `${Math.round((wrapper.textContent ?? '').length / 1000)}k characters`,
    )
  })
})

describe('relocating clippings after a store change', () => {
  it('measures the walk at journal sizes a real read produces', () => {
    const rows: string[][] = []

    for (const count of [1, 50, 500]) {
      const wrapper = mount()
      const texts = scattered(count)

      // The first call segments every block in the article; later ones hit the WeakMap. Both
      // are real: the cold one happens once per render, the warm one on every store change
      // after it — which is the one that runs per clip.
      const cold = measure(1, () => void findPassages(wrapper, LOCALE, texts))
      const warm = measure(15, () => void findPassages(wrapper, LOCALE, texts))

      const found = findPassages(wrapper, LOCALE, texts).length
      rows.push([`${count} clipped`, String(found), spread(cold), spread(warm)])
    }

    console.log(
      table(
        'findPassages over the whole article, per store change',
        ['journal', 'found', 'cold (first walk)', 'warm (cached segmentation)'],
        rows,
      ),
    )
  })
})

describe('repainting marks', () => {
  it('measures a full repaint at the mark counts one page can carry', () => {
    const rows: string[][] = []

    for (const count of [1, 10, 50, 200]) {
      const wrapper = mount()
      const hits: Passage[] = findPassages(wrapper, LOCALE, scattered(count))

      const highlight = attachSentenceHighlight({
        surface: wrapper,
        article: wrapper,
        root: document,
        clipped: () => hits,
        onToggle: () => {},
        onExtend: () => {},
      })

      // Warm the layout once so the first sample isn't paying for the initial reflow.
      highlight.repaint()
      const sample = measure(11, () => highlight.repaint())
      const marks = wrapper.querySelectorAll('.piko-marks > *').length

      highlight.destroy()
      rows.push([`${count} marks`, String(marks), spread(sample), ms(sample.median / count)])
    }

    // A scroll over the host page repaints once per frame, so a 16.7ms budget is the line
    // between marks that travel with the page and marks that lag behind it.
    console.log(
      table(
        'repaint() — every mark rebuilt, once per scroll frame on the host surface',
        ['clipped here', 'mark divs', 'per repaint', 'per mark'],
        rows,
      ),
    )
  })
})
