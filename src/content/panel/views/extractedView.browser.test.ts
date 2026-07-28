import { afterEach, describe, expect, it } from 'vitest'
import type { ExtractedArticle } from '../../extraction/extract'
import { createClippingsStore } from '../../state/clippings'
import { PANEL_STYLES } from '../styles'
import { renderExtracted } from './extractedView'

/**
 * What a table does to the column around it, measured in real Chrome.
 *
 * This has to be a layout test and cannot be a jsdom one: every assertion below is a
 * comparison between a scroll width and a client width, and jsdom reports both as zero. The
 * whole suite would pass against a stylesheet that does nothing at all.
 *
 * The two tests are the two halves of one decision. A table is the only thing extraction
 * produces that will not wrap, so the sheet has to say both what a wide one may not do — widen
 * the column, which would drag the prose sideways — and what a narrow one may not do — stretch
 * to fill it, which is how a two-row infobox ends up spanning the article.
 */

const SOURCE = 'https://en.wikipedia.org/wiki/Cephalopod'

/** Wider than the 680px article column several times over, and none of it able to wrap. */
const WIDE_TABLE = `<table><tbody>${Array.from(
  { length: 3 },
  (_, row) =>
    `<tr>${Array.from({ length: 8 }, (_, col) => `<td>Cephalopoda-r${row}c${col}</td>`).join('')}</tr>`,
).join('')}</tbody></table>`

/** The shape a Wikipedia infobox actually arrives in: two columns of short values. */
const NARROW_TABLE =
  '<table><tbody><tr><th>Kingdom:</th><td>Animalia</td></tr><tr><th>Phylum:</th><td>Mollusca</td></tr></tbody></table>'

const article = (bodyHtml: string): ExtractedArticle => ({
  title: 'Cephalopod',
  contentHtml: `<p>A cephalopod is any member of the molluscan class Cephalopoda.</p>${bodyHtml}`,
  textContent: 'A cephalopod is any member of the molluscan class Cephalopoda.',
})

const mounted: { host: HTMLElement; cleanup: () => void }[] = []

/**
 * Mounts the real extracted view under the real stylesheet, inside a content box wide enough
 * that the article's own 680px cap — not the viewport — is what bounds the column.
 */
function mountArticle(bodyHtml: string) {
  const host = document.createElement('div')
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = PANEL_STYLES
  shadow.appendChild(style)

  // Stands in for the panel's scrolling content area, which normally takes its width from
  // .piko-body's flex row rather than from a declaration of its own.
  const content = document.createElement('div')
  content.className = 'piko-content'
  content.style.cssText = 'width:900px;height:400px;'
  shadow.appendChild(content)
  document.body.appendChild(host)

  const cleanup = renderExtracted(content, article(bodyHtml), {
    store: createClippingsStore(),
    sourceUrl: SOURCE,
    originUrl: null,
    root: shadow,
  })
  mounted.push({ host, cleanup })

  return {
    content,
    articleEl: shadow.querySelector<HTMLElement>('.piko-article')!,
    table: shadow.querySelector<HTMLElement>('table'),
  }
}

afterEach(() => {
  for (const { host, cleanup } of mounted.splice(0)) {
    cleanup()
    host.remove()
  }
})

describe('a table inside the extracted article', () => {
  it('scrolls itself rather than widening the column', () => {
    // The control: the same article with nothing but prose in it. Measuring against this
    // rather than against the 680px cap keeps the test about the invariant that matters —
    // a table changes nothing about the column — and not about the padding arithmetic.
    const proseOnly = mountArticle('').articleEl.getBoundingClientRect().width

    const { content, articleEl, table } = mountArticle(WIDE_TABLE)

    // Guards the fixture. A table whose content already fits cannot demonstrate anything
    // about overflow, so this test would pass without exercising a single rule under test.
    expect(table!.scrollWidth).toBeGreaterThan(articleEl.clientWidth)

    // The table absorbed that overflow onto a scroll axis of its own, and stops at the column.
    // Without the rules under test both widths report the table's full natural size instead,
    // because a table box that cannot scroll simply spills.
    expect(table!.scrollWidth).toBeGreaterThan(table!.clientWidth)
    expect(table!.clientWidth).toBeLessThanOrEqual(articleEl.clientWidth)
    expect(articleEl.getBoundingClientRect().width).toBe(proseOnly)

    // The prose around it never moves: the panel's content area gains no scroll axis at all.
    expect(content.scrollWidth).toBeLessThanOrEqual(content.clientWidth)
  })

  it('leaves a narrow table at its own width instead of stretching it', () => {
    const { articleEl, table } = mountArticle(NARROW_TABLE)

    expect(table!.scrollWidth).toBeLessThanOrEqual(table!.clientWidth)
    expect(table!.getBoundingClientRect().width).toBeLessThan(articleEl.clientWidth / 2)
  })
})
