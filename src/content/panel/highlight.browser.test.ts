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

/** A click at a point, the way the highlighter hears one. */
function click(surface: HTMLElement, point: { x: number; y: number }): void {
  surface.dispatchEvent(
    new MouseEvent('click', { clientX: point.x, clientY: point.y, bubbles: true }),
  )
}

const FIRST = 'Plain opening.'
const SECOND = 'Second sentence here.'
const THIRD = 'A third one, longer than the others, so the run has to wrap the column.'

/**
 * Where a kind of mark was actually painted, box by box.
 *
 * Boxes rather than a count, because the rule under test is about *extent* — how far a hover
 * reaches — and a count only says how the column happened to wrap. Two runs painted over the
 * same span produce identical boxes whatever the wrapping does, so comparing one kind of mark
 * against the other asserts they cover the same text without asserting where the lines break.
 */
type Box = { left: string; top: string; width: string; height: string }

const boxesOf = (surface: HTMLElement, kind: string): Box[] =>
  [...surface.querySelectorAll<HTMLElement>(`.piko-mark-${kind}`)].map(({ style }) => ({
    left: style.left,
    top: style.top,
    width: style.width,
    height: style.height,
  }))

function attach(
  surface: HTMLElement,
  root: ShadowRoot,
  clipped: readonly Passage[],
  onToggle: (hit: Passage) => void = () => {},
): void {
  const handle = attachSentenceHighlight({
    surface,
    article: surface,
    root,
    clipped: () => clipped,
    onToggle,
    onExtend: () => {},
  })
  detach = handle.destroy
}

/** A note over a run of sentences, spelled the way the journal spells one. */
function noteOver(block: HTMLElement, from: number, to: number): Passage {
  const sentences = sentencesIn(block, 'en')
  return {
    block,
    start: sentences[from]!.start,
    end: sentences[to]!.end,
    text: sentences
      .slice(from, to + 1)
      .map((s) => s.text)
      .join(' '),
  }
}

/**
 * What the cursor is on is the note, not the sentence the hit-test landed on.
 *
 * A note is a run, so pointing anywhere in it is pointing at all of it — and the reader's next
 * click acts on all of it. The mark has to say so: a hover that lit only the sentence under the
 * cursor would promise to drop a third of a note and then drop the whole thing.
 */
describe('hovering a sentence a note already holds', () => {
  it('lights the whole note, not the sentence under the cursor', async () => {
    const { surface, root } = mount(`<p>${FIRST} ${SECOND} ${THIRD}</p>`)
    const block = surface.querySelector('p')!

    attach(surface, root, [noteOver(block, 0, 2)])
    await hover(surface, pointAt(block, 'Second sentence'))

    // Same boxes as the note itself paints — so the hover covers exactly the note's extent,
    // however the three sentences happened to wrap.
    expect(boxesOf(surface, 'hover')).toEqual(boxesOf(surface, 'clip'))
    expect(boxesOf(surface, 'hover').length).toBeGreaterThan(0)
  })

  /**
   * The contrast that makes the test above mean something: the same point, with only the first
   * sentence kept. Now the cursor is on plain text, so the hover is the sentence alone and
   * stops well short of the note beside it.
   */
  it('lights only the sentence when no note holds it', async () => {
    const { surface, root } = mount(`<p>${FIRST} ${SECOND} ${THIRD}</p>`)
    const block = surface.querySelector('p')!

    attach(surface, root, [noteOver(block, 0, 0)])
    await hover(surface, pointAt(block, 'Second sentence'))

    expect(boxesOf(surface, 'hover')).not.toEqual(boxesOf(surface, 'clip'))
    expect(boxesOf(surface, 'hover').length).toBeGreaterThan(0)
    expect(boxesOf(surface, 'clip').length).toBeGreaterThan(0)
  })

  /**
   * And what the click carries. The journal knows a note by its text and by nothing else, so a
   * click that named the single sentence it landed on would not match the note holding it —
   * `toggle` would file that sentence as a *second* note overlapping the first, rather than
   * removing the one the reader was pointing at.
   */
  it('hands a click the whole note it landed in', async () => {
    const { surface, root } = mount(`<p>${FIRST} ${SECOND} ${THIRD}</p>`)
    const block = surface.querySelector('p')!
    const note = noteOver(block, 0, 2)

    const toggled: Passage[] = []
    attach(surface, root, [note], (hit) => toggled.push(hit))
    click(surface, pointAt(block, 'Second sentence'))

    expect(toggled.map((hit) => hit.text)).toEqual([`${FIRST} ${SECOND} ${THIRD}`])
  })

  it('hands a click the bare sentence when no note holds it', async () => {
    const { surface, root } = mount(`<p>${FIRST} ${SECOND} ${THIRD}</p>`)
    const block = surface.querySelector('p')!

    const toggled: Passage[] = []
    attach(surface, root, [noteOver(block, 0, 0)], (hit) => toggled.push(hit))
    click(surface, pointAt(block, 'Second sentence'))

    expect(toggled.map((hit) => hit.text)).toEqual([SECOND])
  })
})
