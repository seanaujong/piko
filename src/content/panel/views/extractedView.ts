import type { ExtractedArticle } from '../../extraction/extract'
import type { SentenceHit } from '../../extraction/sentences'
import { BLOCK_SELECTOR, sentencesIn } from '../../extraction/sentences'
import type { Clipping, ClippingsStore } from '../../state/clippings'
import { attachSentenceHighlight } from '../highlight'

export type ExtractedContext = {
  store: ClippingsStore
  /** The previewed page — what a clipping taken here is "from". */
  sourceUrl: string
  /** The page the reader was on when they dragged, or null if they opened it directly. */
  originUrl: string | null
  /** The shadow root the panel renders into; hit testing must go through it. */
  root: DocumentOrShadowRoot
}

/**
 * Stored clippings are plain text, so on each render they have to be located again in the
 * freshly-built DOM to be painted. Matching on text rather than on a stored node path is what
 * lets a clipping survive re-extraction, a framed/reader toggle, and a later revisit.
 */
function locateClipped(
  articleEl: HTMLElement,
  locale: string,
  texts: ReadonlySet<string>,
): SentenceHit[] {
  if (texts.size === 0) return []

  const hits: SentenceHit[] = []
  for (const block of articleEl.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    for (const sentence of sentencesIn(block, locale)) {
      if (texts.has(sentence.text)) hits.push({ block, ...sentence })
    }
  }
  return hits
}

export function renderExtracted(
  root: HTMLElement,
  article: ExtractedArticle,
  context: ExtractedContext,
): () => void {
  const wrapper = document.createElement('div')
  wrapper.className = 'lockin-article'

  const title = document.createElement('h1')
  title.textContent = article.title
  wrapper.appendChild(title)

  if (article.byline) {
    const byline = document.createElement('div')
    byline.className = 'lockin-byline'
    byline.textContent = article.byline
    wrapper.appendChild(byline)
  }

  const body = document.createElement('div')
  body.innerHTML = article.contentHtml // already run through DOMPurify in extract.ts
  wrapper.appendChild(body)

  root.replaceChildren(wrapper)

  const locale = document.documentElement.lang || 'en'
  const { store, sourceUrl, originUrl, root: shadowRoot } = context

  let clippedHits: SentenceHit[] = []

  function refreshClipped(): void {
    const mine = new Set(
      store
        .all()
        .filter((clipping) => clipping.sourceUrl === sourceUrl)
        .map((clipping) => clipping.text),
    )
    clippedHits = locateClipped(wrapper, locale, mine)
  }

  refreshClipped()

  const highlight = attachSentenceHighlight({
    surface: wrapper,
    article: wrapper,
    root: shadowRoot,
    clipped: () => clippedHits,
    onToggle(hit) {
      const clipping: Clipping = {
        text: hit.text,
        sourceUrl,
        sourceTitle: article.title,
        originUrl,
        at: Date.now(),
      }
      store.toggle(clipping)
    },
  })

  // The store is the single source of truth for what's clipped; the painted rects are
  // re-derived from it rather than being updated alongside it in two places.
  const unsubscribe = store.subscribe(() => {
    refreshClipped()
    highlight.repaint()
  })

  return () => {
    unsubscribe()
    highlight.destroy()
  }
}
