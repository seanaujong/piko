import type { Clipping, ClippingsStore } from '../../state/clippings'
import { gapBefore, tallyBySource, toMarkdown, visibleClippings } from '../../state/clippings'
import { copyText } from '../clipboard'
import { hostOf } from '../formatUrl'
import { flashResult, ICON, iconButton } from '../iconButton'
import { textFragmentUrl } from '../textFragment'

export type ClippingsPane = {
  root: HTMLElement
  render: () => void
}

const relativeTime = (from: number): string => {
  const minutes = Math.round((Date.now() - from) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

const gapLabel = (ms: number): string => {
  const hours = Math.round(ms / 3_600_000)
  if (hours < 24) return `${hours}h earlier`
  const days = Math.round(hours / 24)
  return days === 1 ? 'the day before' : `${days} days earlier`
}

/**
 * One chronological list, narrowed by source chips — not three grouping modes. Filters
 * compose and are stateless where modes are exclusive and stateful, and because each chip
 * carries its own count the chip row *is* the by-source overview a grouping mode would give.
 * Sessions survive as dividers inside the stream, so the list never changes shape.
 */
export function createClippingsPane(store: ClippingsStore): ClippingsPane {
  const activeSources = new Set<string>()

  const root = document.createElement('div')
  root.className = 'piko-clips'

  const title = document.createElement('div')
  title.className = 'piko-clips-title'
  title.textContent = 'Clippings'

  const count = document.createElement('span')
  count.className = 'piko-clips-count'

  const copyButton = document.createElement('button')
  copyButton.className = 'piko-button piko-clips-copy'
  copyButton.textContent = 'Copy'
  copyButton.addEventListener('click', () => {
    const items = visibleClippings(store.all(), activeSources)
    if (items.length === 0) return
    // Synchronous, inside the click handler — see clipboard.ts.
    const ok = copyText(toMarkdown(items))
    copyButton.textContent = ok ? 'Copied' : 'Blocked'
    setTimeout(() => {
      copyButton.textContent = 'Copy'
    }, 1400)
  })

  const header = document.createElement('div')
  header.className = 'piko-clips-header'
  header.append(title, count, copyButton)

  const filters = document.createElement('div')
  filters.className = 'piko-clips-filters'

  const list = document.createElement('div')
  list.className = 'piko-clips-list'

  root.append(header, filters, list)

  function renderFilters(all: readonly Clipping[]): void {
    filters.replaceChildren()
    const tallies = tallyBySource(all)
    // A filter over a single source narrows nothing — it would just be noise.
    if (tallies.length < 2) return

    for (const tally of tallies) {
      const chip = document.createElement('button')
      chip.className = 'piko-chip'
      chip.setAttribute('aria-pressed', String(activeSources.has(tally.sourceUrl)))
      chip.title = tally.sourceUrl

      const label = document.createElement('span')
      label.textContent = tally.sourceTitle

      const badge = document.createElement('span')
      badge.className = 'piko-chip-count'
      badge.textContent = String(tally.count)

      chip.append(label, badge)
      chip.addEventListener('click', () => {
        if (activeSources.has(tally.sourceUrl)) activeSources.delete(tally.sourceUrl)
        else activeSources.add(tally.sourceUrl)
        render()
      })
      filters.appendChild(chip)
    }

    if (activeSources.size > 0) {
      const reset = document.createElement('button')
      reset.className = 'piko-chip piko-chip-reset'
      reset.textContent = 'Show all'
      reset.addEventListener('click', () => {
        activeSources.clear()
        render()
      })
      filters.appendChild(reset)
    }
  }

  function render(): void {
    const all = store.all()
    const items = visibleClippings(all, activeSources)

    count.textContent =
      activeSources.size > 0 ? `${items.length}/${all.length}` : String(all.length)
    copyButton.style.display = items.length > 0 ? 'inline-block' : 'none'

    renderFilters(all)
    list.replaceChildren()

    if (all.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'piko-clips-empty'
      empty.textContent = 'Click a sentence in the article to clip it.'
      list.appendChild(empty)
      return
    }

    items.forEach((clipping, index) => {
      const gap = gapBefore(items, index)
      if (gap !== null) {
        const divider = document.createElement('div')
        divider.className = 'piko-clips-divider'
        divider.textContent = gapLabel(gap)
        list.appendChild(divider)
      }

      const entry = document.createElement('div')
      entry.className = 'piko-clip'

      const when = document.createElement('span')
      when.className = 'piko-clip-when'
      when.textContent = relativeTime(clipping.at)

      const body = document.createElement('div')
      body.className = 'piko-clip-body'
      body.textContent = clipping.text

      // The way back to a clipping is a link out, not a preview: re-previewing in place
      // would replace whatever the reader currently has open, and giving the panel a history
      // to unwind is a lot of machinery for a pane that shows one page at a time. A new tab
      // costs the reader nothing they had, and the text directive means it opens *at* the
      // sentence rather than at the top of the article.
      //
      // It names the page the sentence lives on. The page it was dragged from is a different
      // page, and inlining both without saying which was which read as one ambiguous line.
      const source = document.createElement('a')
      source.className = 'piko-clip-source'
      source.href = textFragmentUrl(clipping.sourceUrl, clipping.text)
      source.target = '_blank'
      source.rel = 'noopener noreferrer'
      source.textContent = `${clipping.sourceTitle} · ${hostOf(clipping.sourceUrl)}`
      source.title = clipping.originUrl
        ? `Open ${clipping.sourceTitle} at this sentence — dragged from ${clipping.originUrl}`
        : `Open ${clipping.sourceTitle} at this sentence`
      body.appendChild(source)

      // The sentence alone, not the Markdown blockquote: this button is the quick grab, and
      // the header's Copy is the with-attribution export (see toMarkdown).
      const copy = iconButton('Copy this clipping', ICON.copy)
      copy.addEventListener('click', () => {
        // Synchronous, inside the click handler — see clipboard.ts.
        flashResult(copy, copyText(clipping.text), ICON.copy)
      })

      const remove = iconButton('Remove clipping', ICON.remove)
      remove.classList.add('piko-clip-remove')
      remove.addEventListener('click', () => store.toggle(clipping))

      const actions = document.createElement('div')
      actions.className = 'piko-clip-actions'
      actions.append(copy, remove)

      // Time and controls share one meta row above the text, so neither reserves a gutter
      // beside it. In a pane this narrow the sentence needs the full width more than the
      // metadata needs to sit inline with it.
      const meta = document.createElement('div')
      meta.className = 'piko-clip-meta'
      meta.append(when, actions)

      entry.append(meta, body)
      list.appendChild(entry)
    })
  }

  store.subscribe(render)
  render()

  return { root, render }
}
