import type { ExtractedArticle } from '../../extraction/extract'
import type { Passage } from '../../extraction/sentences'
import { findPassages } from '../../extraction/sentences'
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

export function renderExtracted(
  root: HTMLElement,
  article: ExtractedArticle,
  context: ExtractedContext,
): () => void {
  const wrapper = document.createElement('div')
  wrapper.className = 'piko-article'

  const title = document.createElement('h1')
  title.textContent = article.title
  wrapper.appendChild(title)

  if (article.byline) {
    const byline = document.createElement('div')
    byline.className = 'piko-byline'
    byline.textContent = article.byline
    wrapper.appendChild(byline)
  }

  const body = document.createElement('div')
  body.innerHTML = article.contentHtml // already run through DOMPurify in extract.ts
  wrapper.appendChild(body)

  root.replaceChildren(wrapper)

  const locale = document.documentElement.lang || 'en'
  const { store, sourceUrl, originUrl, root: shadowRoot } = context

  let clippedHits: Passage[] = []

  function refreshClipped(): void {
    const mine = new Set(
      store
        .all()
        .filter((clipping) => clipping.sourceUrl === sourceUrl)
        .map((clipping) => clipping.text),
    )
    clippedHits = findPassages(wrapper, locale, mine)
  }

  refreshClipped()

  /** Whatever a passage taken here is a clipping of. */
  const clippingOf = (text: string): Clipping => ({
    text,
    sourceUrl,
    sourceTitle: article.title,
    originUrl,
    at: Date.now(),
  })

  const highlight = attachSentenceHighlight({
    surface: wrapper,
    article: wrapper,
    root: shadowRoot,
    clipped: () => clippedHits,
    onToggle(hit) {
      store.toggle(clippingOf(hit.text))
    },
    onExtend({ grown, supersedes }) {
      store.extend(clippingOf(grown.text), new Set(supersedes.map((p) => p.text)))
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
