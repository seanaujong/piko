import { findSentences, type SentenceHit } from '../extraction/sentences'
import type { Clipping, ClippingsStore } from '../state/clippings'
import { attachSentenceHighlight } from './highlight'

/**
 * Clipping over the page the reader is actually on, rather than over a preview of another one.
 *
 * This is the same hit-tester the preview uses, pointed at `document.body` instead of at
 * extracted content — no second definition of what a sentence is, or of where it sits. Three
 * things genuinely differ on this surface, and they are the three options passed below:
 *
 *  - the overlay must be click-through, so pointer events come from the document instead,
 *  - it is fixed rather than inside a scrolling container, so it repaints as the page moves,
 *  - a sentence is often inside a link, so the clipping click must not also navigate.
 *
 * Deliberately armed only while the reader asked for it. Hit-testing every click on every
 * page would make Piko a thing that happens *to* you, and would break ordinary browsing.
 */
export function attachHostClipping(surface: HTMLElement, store: ClippingsStore): () => void {
  const locale = document.documentElement.lang || 'en'
  const article = document.body

  let clippedHits: SentenceHit[] = []

  function refreshClipped(): void {
    const here = new Set(
      store
        .all()
        .filter((clipping) => clipping.sourceUrl === window.location.href)
        .map((clipping) => clipping.text),
    )
    clippedHits = findSentences(article, locale, here)
  }

  refreshClipped()

  const highlight = attachSentenceHighlight({
    surface,
    events: document,
    article,
    root: document,
    repaintOnScroll: true,
    suppressActivation: true,
    clipped: () => clippedHits,
    onToggle(hit) {
      const clipping: Clipping = {
        text: hit.text,
        sourceUrl: window.location.href,
        sourceTitle: document.title || window.location.hostname,
        // Nothing was dragged to get here — the reader was already on this page.
        originUrl: null,
        at: Date.now(),
      }
      store.toggle(clipping)
    },
  })

  const unsubscribe = store.subscribe(() => {
    refreshClipped()
    highlight.repaint()
  })

  return () => {
    unsubscribe()
    highlight.destroy()
  }
}
