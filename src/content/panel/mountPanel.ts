import type { Dispatch, PreviewState } from '../state/previewState'
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

  const urlLabel = document.createElement('div')
  urlLabel.className = 'lockin-url'

  const toggleButton = document.createElement('button')
  toggleButton.className = 'lockin-button'
  toggleButton.addEventListener('click', () => dispatch({ type: 'ManualModeToggled' }))

  const closeButton = document.createElement('button')
  closeButton.className = 'lockin-button lockin-close'
  closeButton.textContent = '✕'
  closeButton.setAttribute('aria-label', 'Close preview')
  closeButton.addEventListener('click', () => dispatch({ type: 'Dismissed' }))

  const header = document.createElement('div')
  header.className = 'lockin-header'
  header.append(urlLabel, toggleButton, closeButton)

  const content = document.createElement('div')
  content.className = 'lockin-content'

  const body = document.createElement('div')
  body.className = 'lockin-body'
  body.appendChild(content)

  const panel = document.createElement('div')
  panel.className = 'lockin-panel'
  panel.append(header, body)

  // Painted first so `panel`, appended after it, sits visually on top; pointer-events are
  // re-enabled on both explicitly since :host itself is click-through (see styles.ts). Now
  // that the backdrop covers the full viewport, it's also the dismiss-on-outside-click
  // target directly — a document-level listener can't tell backdrop clicks apart from panel
  // clicks once shadow-DOM event retargeting is in play (both report `target` as `host`).
  const backdrop = document.createElement('div')
  backdrop.className = 'lockin-backdrop'
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

    urlLabel.textContent = state.kind === 'ready' ? state.finalUrl : state.target.url

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
          renderExtracted(content, state.content.article)
        }
        break
    }
  }

  return { render }
}
