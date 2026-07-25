import { createClippingsStore } from '../state/clippings'
import type { Dispatch, PreviewState } from '../state/previewState'
import { copyText } from './clipboard'
import { displayUrl } from './formatUrl'
import { ICON, iconButton } from './iconButton'
import { createClippingsPane } from './views/clippingsPane'
import { PANEL_STYLES } from './styles'
import { renderError } from './views/errorView'
import { renderExtracted } from './views/extractedView'
import { renderFramed } from './views/framedView'
import { renderLoading } from './views/loadingView'

export type PanelHandle = {
  render: (state: PreviewState) => void
}

/**
 * Owns the panel's DOM: a shadow-root host appended directly to <html> (not nested into an
 * arbitrary page element, which could hijack `position: fixed`'s containing block via an
 * ancestor's transform/filter/will-change).
 */
export function mountPanel(dispatch: Dispatch): PanelHandle {
  const host = document.createElement('div')
  host.setAttribute('data-hidden', '') // hidden until the first render() call proves otherwise
  const shadow = host.attachShadow({ mode: 'open' })

  const styleEl = document.createElement('style')
  styleEl.textContent = PANEL_STYLES
  shadow.appendChild(styleEl)

  // The URL is already spelled out in full, so it IS the copy control — a separate icon
  // beside it would be a second affordance pointing at the same string. Opening it
  // elsewhere is a genuinely different action, so that keeps a button of its own.
  let currentUrl = ''

  const urlLabel = document.createElement('button')
  urlLabel.className = 'piko-url'
  urlLabel.addEventListener('click', () => {
    // Synchronous, inside the click handler — see clipboard.ts.
    const ok = copyText(currentUrl)
    urlLabel.textContent = ok ? 'Link copied' : "Couldn't copy — select the URL instead"
    urlLabel.classList.add(ok ? 'is-done' : 'is-failed')
    setTimeout(() => {
      urlLabel.textContent = displayUrl(currentUrl)
      urlLabel.classList.remove('is-done', 'is-failed')
    }, 1400)
  })

  const newTabButton = iconButton('Open in a new tab', ICON.newTab)
  newTabButton.classList.add('piko-url-open')
  newTabButton.addEventListener('click', () => {
    window.open(currentUrl, '_blank', 'noopener,noreferrer')
  })

  const toggleButton = document.createElement('button')
  toggleButton.className = 'piko-button'
  toggleButton.addEventListener('click', () => dispatch({ type: 'ManualModeToggled' }))

  const closeButton = document.createElement('button')
  closeButton.className = 'piko-button piko-close'
  closeButton.textContent = '✕'
  closeButton.setAttribute('aria-label', 'Close preview')
  closeButton.addEventListener('click', () => dispatch({ type: 'Dismissed' }))

  const header = document.createElement('div')
  header.className = 'piko-header'
  header.append(urlLabel, newTabButton, toggleButton, closeButton)

  const content = document.createElement('div')
  content.className = 'piko-content'

  // The clippings journal spans previews rather than belonging to any one of them, so it's
  // created once with the panel and outlives every individual `render()`.
  const clippings = createClippingsStore()
  const clippingsPane = createClippingsPane(clippings)

  const body = document.createElement('div')
  body.className = 'piko-body'
  body.append(content, clippingsPane.root)

  const panel = document.createElement('div')
  panel.className = 'piko-panel'
  panel.append(header, body)

  // Painted first so `panel`, appended after it, sits visually on top; pointer-events are
  // re-enabled on both explicitly since :host itself is click-through (see styles.ts). Now
  // that the backdrop covers the full viewport, it's also the dismiss-on-outside-click
  // target directly — a document-level listener can't tell backdrop clicks apart from panel
  // clicks once shadow-DOM event retargeting is in play (both report `target` as `host`).
  const backdrop = document.createElement('div')
  backdrop.className = 'piko-backdrop'
  backdrop.addEventListener('click', () => dispatch({ type: 'Dismissed' }))
  shadow.append(backdrop, panel)

  document.documentElement.appendChild(host)

  let isOpen = false
  let cleanupCurrentView: (() => void) | null = null

  document.addEventListener(
    'keydown',
    (event) => {
      if (isOpen && event.key === 'Escape') dispatch({ type: 'Dismissed' })
    },
    { capture: true },
  )

  function render(state: PreviewState): void {
    cleanupCurrentView?.()
    cleanupCurrentView = null

    if (state.kind === 'idle') {
      isOpen = false
      host.toggleAttribute('data-hidden', true)
      content.replaceChildren()
      return
    }
    isOpen = true
    host.toggleAttribute('data-hidden', false)

    currentUrl = state.kind === 'ready' ? state.finalUrl : state.target.url
    // Shown trimmed, copied whole — the title carries the full string for anyone checking.
    urlLabel.textContent = displayUrl(currentUrl)
    urlLabel.title = `Copy link — ${currentUrl}`

    const canToggle = state.kind === 'ready' && state.html !== null
    toggleButton.style.display = canToggle ? 'inline-block' : 'none'
    const showingExtracted = state.kind === 'ready' && state.content.mode === 'extracted'
    toggleButton.classList.toggle('active', showingExtracted)
    toggleButton.textContent = showingExtracted ? 'Live page' : 'Reader'

    switch (state.kind) {
      case 'loading':
        renderLoading(content, state.target)
        break
      case 'error':
        renderError(content, state.reason)
        break
      case 'ready':
        if (state.content.mode === 'framed') {
          cleanupCurrentView = renderFramed(content, state.finalUrl, dispatch)
        } else {
          cleanupCurrentView = renderExtracted(content, state.content.article, {
            store: clippings,
            sourceUrl: state.finalUrl,
            // The host page is by definition where the reader was standing when they dragged.
            originUrl: window.location.href === state.finalUrl ? null : window.location.href,
            root: shadow,
          })
        }
        break
    }

    // Clipping only happens in reader mode, so the pane earns its width there unconditionally;
    // in framed mode it appears only when there's already something to review.
    const clippable = state.kind === 'ready' && state.content.mode === 'extracted'
    clippingsPane.root.toggleAttribute('data-hidden', !clippable && clippings.all().length === 0)
  }

  return { render }
}
