import { afterEach, describe, expect, it } from 'vitest'
import type { Passage } from '../extraction/sentences'
import { sentencesIn } from '../extraction/sentences'
import { attachSentenceHighlight } from './highlight'
import { PANEL_STYLES } from './styles'

/**
 * What the overlay actually paints, in real Chrome. Every assertion here rests on a point
 * being *over* a sentence, which is layout — jsdom reports all client rects as zero, so
 * `elementFromPoint` would find nothing and these would pass while hovering nothing at all.
 */

let mounted: HTMLElement | null = null
let detach: (() => void) | null = null

/**
 * The article under the real stylesheet, in a shadow root — which is where it lives in the
 * panel, and what `sentenceAtPoint` hit-tests through. Both details are load-bearing rather
 * than ceremony: without the sheet the overlay's marks are ordinary blocks that take up flow
 * and sit over the very text they describe, so nothing can be hovered at all.
 */
function mount(html: string): { surface: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div')
  // The shadow host is click-through by design and only `.piko-panel` re-enables pointer
  // events, and only under `data-preview`. Both are why the article is nested exactly as the
  // panel nests it: hit-testing is the thing under test, so faking the structure would fake
  // the answer — an article mounted bare reports `body` at every point.
  host.setAttribute('data-preview', '')
  const root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  // Entrance is a transform transition, so the panel is still travelling for 180ms after it
  // opens. Measuring a point mid-flight and clicking it a frame later aims at where the text
  // used to be; nothing here is about the animation, so it is turned off rather than waited out.
  style.textContent = `${PANEL_STYLES}\n* { transition: none !important; }`
  root.appendChild(style)

  const panel = document.createElement('div')
  panel.className = 'piko-panel'

  const surface = document.createElement('div')
  surface.className = 'piko-article'
  surface.innerHTML = html
  panel.appendChild(surface)
  root.appendChild(panel)

  document.body.appendChild(host)
  mounted = host
  return { surface, root }
}

afterEach(() => {
  detach?.()
  detach = null
  mounted?.remove()
  mounted = null
})

/** The centre of some words, found by what they say. */
function pointAt(block: HTMLElement, words: string): { x: number; y: number } {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node as Text).data.indexOf(words)
    if (at < 0) continue
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, at + words.length)
    const rect = range.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  throw new Error(`no text node holds ${words}`)
}

/** Hover resolution is collapsed to one lookup per frame, so the paint lands a frame later. */
async function hover(surface: HTMLElement, point: { x: number; y: number }): Promise<void> {
  surface.dispatchEvent(
    new PointerEvent('pointermove', { clientX: point.x, clientY: point.y, bubbles: true }),
  )
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

const FIRST = 'Plain opening.'
const SECOND = 'Second sentence here.'

/**
 * Whether each kind of mark is on the page at all. Counts are line counts — one box per
 * visual line the run occupies — so they say how the column happened to wrap, which is not
 * what any rule here is about.
 */
type Marks = { hovered: boolean; clipped: boolean }

const marksIn = (surface: HTMLElement): Marks => ({
  hovered: surface.querySelector('.piko-mark-hover') !== null,
  clipped: surface.querySelector('.piko-mark-clip') !== null,
})

function attach(surface: HTMLElement, root: ShadowRoot, clipped: readonly Passage[]): void {
  const handle = attachSentenceHighlight({
    surface,
    article: surface,
    root,
    clipped: () => clipped,
    onToggle: () => {},
    onExtend: () => {},
  })
  detach = handle.destroy
}

/**
 * A clipped passage keeps its own stronger colour under the cursor, and a passage is a run —
 * so the question the repaint asks has to be "does a clipped passage COVER this sentence",
 * not "does one equal it". Asked as equality, hovering the second sentence of a two-sentence
 * note paints a hover mark over text that is already kept, and the note appears to lose its
 * colour wherever the cursor rests on it.
 */
describe('hovering a sentence a note already holds', () => {
  it('paints no hover mark over the later sentence of a passage', async () => {
    const { surface, root } = mount(`<p>${FIRST} ${SECOND}</p>`)
    const block = surface.querySelector('p')!
    const sentences = sentencesIn(block, 'en')
    const whole: Passage = {
      block,
      start: sentences[0]!.start,
      end: sentences[1]!.end,
      text: `${FIRST} ${SECOND}`,
    }

    attach(surface, root, [whole])
    await hover(surface, pointAt(block, 'Second sentence'))

    expect(marksIn(surface)).toEqual({ hovered: false, clipped: true })
  })

  /**
   * The contrast that makes the test above mean something: the same point, the same gesture,
   * with only the first sentence kept. A hover mark here is exactly what should appear.
   */
  it('still paints one over a sentence no note holds', async () => {
    const { surface, root } = mount(`<p>${FIRST} ${SECOND}</p>`)
    const block = surface.querySelector('p')!
    const sentences = sentencesIn(block, 'en')
    const justTheFirst: Passage = { block, ...sentences[0]! }

    attach(surface, root, [justTheFirst])
    await hover(surface, pointAt(block, 'Second sentence'))

    expect(marksIn(surface)).toEqual({ hovered: true, clipped: true })
  })
})
