import type { Clipping, ClippingsStore } from '../../state/clippings'
import { gapBefore, tallyBySource, toMarkdown, visibleClippings } from '../../state/clippings'
import { copyText } from '../clipboard'

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
  root.className = 'lockin-clips'

  const title = document.createElement('div')
  title.className = 'lockin-clips-title'
  title.textContent = 'Clippings'

  const count = document.createElement('span')
  count.className = 'lockin-clips-count'

  const copyButton = document.createElement('button')
  copyButton.className = 'lockin-button lockin-clips-copy'
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
  header.className = 'lockin-clips-header'
  header.append(title, count, copyButton)

  const filters = document.createElement('div')
  filters.className = 'lockin-clips-filters'

  const list = document.createElement('div')
  list.className = 'lockin-clips-list'

  root.append(header, filters, list)

  function renderFilters(all: readonly Clipping[]): void {
    filters.replaceChildren()
    const tallies = tallyBySource(all)
    // A filter over a single source narrows nothing — it would just be noise.
    if (tallies.length < 2) return

    for (const tally of tallies) {
      const chip = document.createElement('button')
      chip.className = 'lockin-chip'
      chip.setAttribute('aria-pressed', String(activeSources.has(tally.sourceUrl)))
      chip.title = tally.sourceUrl

      const label = document.createElement('span')
      label.textContent = tally.sourceTitle

      const badge = document.createElement('span')
      badge.className = 'lockin-chip-count'
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
      reset.className = 'lockin-chip lockin-chip-reset'
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
      empty.className = 'lockin-clips-empty'
      empty.textContent = 'Click a sentence in the article to clip it.'
      list.appendChild(empty)
      return
    }

    items.forEach((clipping, index) => {
      const gap = gapBefore(items, index)
      if (gap !== null) {
        const divider = document.createElement('div')
        divider.className = 'lockin-clips-divider'
        divider.textContent = gapLabel(gap)
        list.appendChild(divider)
      }

      const entry = document.createElement('div')
      entry.className = 'lockin-clip'

      const when = document.createElement('span')
      when.className = 'lockin-clip-when'
      when.textContent = relativeTime(clipping.at)

      const body = document.createElement('div')
      body.className = 'lockin-clip-body'
      body.textContent = clipping.text

      const source = document.createElement('span')
      source.className = 'lockin-clip-source'
      source.textContent = clipping.originUrl
        ? `${clipping.sourceTitle} · dragged from ${clipping.originUrl}`
        : clipping.sourceTitle
      body.appendChild(source)

      const remove = document.createElement('button')
      remove.className = 'lockin-clip-remove'
      remove.textContent = '✕'
      remove.setAttribute('aria-label', 'Remove clipping')
      remove.addEventListener('click', () => store.toggle(clipping))

      entry.append(when, body, remove)
      list.appendChild(entry)
    })
  }

  store.subscribe(render)
  render()

  return { root, render }
}
