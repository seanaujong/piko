import type { ExtractedArticle } from '../../extraction/extract'

export function renderExtracted(root: HTMLElement, article: ExtractedArticle): void {
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
  body.innerHTML = article.contentHtml // already run through DOMPurify in extract.ts before reaching here
  wrapper.appendChild(body)

  root.replaceChildren(wrapper)
}
