import { RAIL_GUTTER } from '../../shared/constants'
import { createClippingsStore } from '../state/clippings'
import type { Dispatch, PreviewState } from '../state/previewState'
import { copyText } from './clipboard'
import { displayUrl } from './formatUrl'
import { ICON, iconButton } from './iconButton'
import { attachHostClipping } from './hostClipping'
import { createClippingsPane } from './views/clippingsPane'
import { PANEL_STYLES } from './styles'
import { renderError } from './views/errorView'
import { renderExtracted } from './views/extractedView'
import { renderFramed } from './views/framedView'
import { renderLoading } from './views/loadingView'

export type PanelHandle = {
  render: (state: PreviewState) => void
  /**
   * Arm clipping on the page itself and dock the journal beside it. One affordance for both,
   * because they are one thing: the rail being visible IS the indicator that clicks are being
   * intercepted, so there is no invisible mode to forget you are in.
   */
  toggleHostClipping: () => void
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
  toggleButton.className = 'piko-button piko-mode-toggle'
  toggleButton.addEventListener('click', () => dispatch({ type: 'ManualModeToggled' }))

  // The pane's own close button can put it away, so something has to bring it back — and the
  // header is where the panel's other reversible switch already lives. Being a toggle rather
  // than a one-way "show" is what keeps the two controls from disagreeing: `active` reflects
  // whether the pane is up, whichever control last changed it.
  const clipsButton = document.createElement('button')
  clipsButton.className = 'piko-button piko-clips-toggle'
  clipsButton.textContent = 'Clippings'
  clipsButton.addEventListener('click', () => {
    paneDismissed = !paneDismissed
    refreshPane()
  })

  const closeButton = document.createElement('button')
  closeButton.className = 'piko-button piko-close'
  closeButton.textContent = '✕'
  closeButton.setAttribute('aria-label', 'Close preview')
  closeButton.addEventListener('click', () => dispatch({ type: 'Dismissed' }))

  // Two groups, pushed to opposite ends: what the preview *is* on the left, what to do with
  // it on the right. Grouping them as elements rather than spacing them with a margin on one
  // child is what keeps the arrangement from depending on a single declaration — an earlier
  // version pushed the actions over with `margin-right: auto` on the new-tab button, and
  // `.piko-icon-button`'s `all: initial` later in the sheet silently reset it.
  const source = document.createElement('div')
  source.className = 'piko-header-source'
  source.append(urlLabel, newTabButton)

  const actions = document.createElement('div')
  actions.className = 'piko-header-actions'
  actions.append(clipsButton, toggleButton, closeButton)

  const header = document.createElement('div')
  header.className = 'piko-header'
  header.append(source, actions)

  const content = document.createElement('div')
  content.className = 'piko-content'

  // The clippings journal spans previews rather than belonging to any one of them, so it's
  // created once with the panel and outlives every individual `render()`.
  const clippings = createClippingsStore()
  const clippingsPane = createClippingsPane(clippings, {
    onClose() {
      // Closing means different things on the two surfaces, and only the panel knows which one
      // the pane is docked in. In the rail the pane's visibility IS the signal that clicks are
      // being intercepted, so putting it away has to disarm clipping too — a rail that closed
      // while the page stayed armed would be exactly the invisible mode this design avoids.
      // Inside a preview it is one column of two, and closing it just widens the article.
      if (detachHostClipping) stopHostClipping()
      else dismissPaneForThisPreview()
    },
  })

  const body = document.createElement('div')
  body.className = 'piko-body'
  body.append(content, clippingsPane.root)

  const panel = document.createElement('div')
  panel.className = 'piko-panel'
  panel.append(header, body)

  // Where the journal docks when there is no preview to sit inside.
  const rail = document.createElement('div')
  rail.className = 'piko-rail'
  rail.toggleAttribute('data-hidden', true)

  // Host-page marks are painted over the viewport rather than inside the panel.
  const hostSurface = document.createElement('div')
  hostSurface.className = 'piko-host-surface'

  // Painted first so `panel`, appended after it, sits visually on top; pointer-events are
  // re-enabled on both explicitly since :host itself is click-through (see styles.ts). Now
  // that the backdrop covers the full viewport, it's also the dismiss-on-outside-click
  // target directly — a document-level listener can't tell backdrop clicks apart from panel
  // clicks once shadow-DOM event retargeting is in play (both report `target` as `host`).
  const backdrop = document.createElement('div')
  backdrop.className = 'piko-backdrop'
  backdrop.addEventListener('click', () => dispatch({ type: 'Dismissed' }))
  shadow.append(hostSurface, backdrop, panel, rail)

  document.documentElement.appendChild(host)

  let isOpen = false
  let cleanupCurrentView: (() => void) | null = null
  let detachHostClipping: (() => void) | null = null
  /** Reset when the preview closes, so a dismissal lasts the preview it was made in. */
  let paneDismissed = false
  /** Whether the preview currently on screen is one a sentence can be clipped from. */
  let previewIsClippable = false
  /** The page's own inline margin, held while the rail is borrowing space from it. */
  let pageMarginRight: string | null = null

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return
      if (detachHostClipping) stopHostClipping()
      else if (isOpen) dispatch({ type: 'Dismissed' })
    },
    { capture: true },
  )

  /** The pane is one instance, re-parented — its filters and scroll survive the move. */
  function dockPaneIn(parent: HTMLElement): void {
    if (clippingsPane.root.parentElement !== parent) parent.appendChild(clippingsPane.root)
  }

  function dismissPaneForThisPreview(): void {
    paneDismissed = true
    refreshPane()
  }

  /**
   * The pane is worth offering when there is clipping to do or something already clipped;
   * within that, whether it is up is the reader's to decide. Splitting the two is what lets a
   * dismissal be remembered without also having to remember an empty journal.
   */
  function refreshPane(): void {
    const worthOffering = previewIsClippable || clippings.all().length > 0
    const showing = worthOffering && !paneDismissed
    clippingsPane.root.toggleAttribute('data-hidden', !showing)
    clipsButton.style.display = worthOffering ? 'inline-block' : 'none'
    clipsButton.classList.toggle('active', showing)
  }

  /**
   * The rail takes its width out of the page's layout rather than sitting on top of it. An
   * overlay would cover the very sentences the mode exists to let you click, and a page's
   * right-hand furniture — infoboxes, thumbnails, floated figures — is exactly what lands
   * under it.
   *
   * Applied without a transition on purpose. Marks are absolute boxes positioned from rects
   * measured once, so reflowing the page under them over 180ms would slide the text out from
   * beneath every mark for the length of the animation.
   */
  function reserveRailSpace(): void {
    const root = document.documentElement
    if (pageMarginRight === null) pageMarginRight = root.style.marginRight
    // Measured rather than assumed: the rail's width is capped at a fraction of the viewport,
    // so on a narrow window it is narrower than its nominal size.
    root.style.marginRight = `${rail.getBoundingClientRect().width + RAIL_GUTTER * 2}px`
  }

  function releaseRailSpace(): void {
    if (pageMarginRight === null) return
    document.documentElement.style.marginRight = pageMarginRight
    pageMarginRight = null
  }

  // The rail is capped in viewport units, so its width changes as the window does.
  window.addEventListener('resize', () => {
    if (detachHostClipping) reserveRailSpace()
  })

  function stopHostClipping(): void {
    detachHostClipping?.()
    detachHostClipping = null
    rail.toggleAttribute('data-hidden', true)
    releaseRailSpace()
    dockPaneIn(body)
  }

  function startHostClipping(): void {
    // A preview covers the page behind a backdrop, so the two surfaces cannot be armed at
    // once; asking for the page hands the reader back the page.
    if (isOpen) dispatch({ type: 'Dismissed' })
    dockPaneIn(rail)
    rail.toggleAttribute('data-hidden', false)
    clippingsPane.root.toggleAttribute('data-hidden', false)
    host.toggleAttribute('data-hidden', false)
    // Before the hit-tester attaches: it measures the page as laid out, and everything it
    // measures moves when the margin lands.
    reserveRailSpace()
    detachHostClipping = attachHostClipping(hostSurface, clippings)
    clippingsPane.render()
  }

  function render(state: PreviewState): void {
    cleanupCurrentView?.()
    cleanupCurrentView = null

    if (state.kind === 'idle') {
      isOpen = false
      // A dismissal is scoped to the preview it was made in: the next drag is a new reading,
      // and the pane has no affordance of its own to come back with.
      paneDismissed = false
      host.toggleAttribute('data-preview', false)
      // The rail keeps the shadow host visible when the modal is not showing.
      host.toggleAttribute('data-hidden', detachHostClipping === null)
      content.replaceChildren()
      return
    }

    // A drag wins over host clipping: the reader asked for a different page.
    if (detachHostClipping) stopHostClipping()
    isOpen = true
    host.toggleAttribute('data-hidden', false)
    host.toggleAttribute('data-preview', true)

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
    previewIsClippable = state.kind === 'ready' && state.content.mode === 'extracted'
    refreshPane()
  }

  return {
    render,
    toggleHostClipping() {
      if (detachHostClipping) stopHostClipping()
      else startHostClipping()
    },
  }
}
