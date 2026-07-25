import { IFRAME_LOAD_TIMEOUT_MS } from '../../../shared/constants'
import type { Dispatch } from '../../state/previewState'

/**
 * The load-vs-timeout race here is a heuristic backstop, not a certainty: a host page's own
 * frame-src CSP, or a JS frame-buster, can silently keep the target from ever rendering with
 * no JS-visible signal (cross-origin iframes can't be inspected). The manual framed/extracted
 * toggle in the panel header is the real safety net for whatever this timeout misses.
 */
/**
 * The iframe starts at opacity 0 rather than being inserted only once ready — it still
 * fetches and renders normally in the background either way, we're just choosing when to
 * reveal it. Swapping straight from the loading text to a freshly-created (empty) iframe
 * produced a visible blank-white flash before the target page actually painted; this keeps
 * the spinner up until the iframe's own `load` event fires, then crossfades.
 */
export function renderFramed(root: HTMLElement, finalUrl: string, dispatch: Dispatch): () => void {
  const wrapper = document.createElement('div')
  wrapper.className = 'lockin-framed-wrapper'

  const iframe = document.createElement('iframe')
  iframe.className = 'lockin-iframe'
  iframe.src = finalUrl

  const spinner = document.createElement('div')
  spinner.className = 'lockin-spinner'

  wrapper.append(iframe, spinner)
  root.replaceChildren(wrapper)

  let settled = false
  const timeoutId = setTimeout(() => {
    if (settled) return
    settled = true
    dispatch({ type: 'IframeTimedOut' })
  }, IFRAME_LOAD_TIMEOUT_MS)

  iframe.addEventListener('load', () => {
    if (settled) return
    settled = true
    clearTimeout(timeoutId)
    wrapper.classList.add('lockin-framed-loaded')
  })

  return () => {
    settled = true
    clearTimeout(timeoutId)
  }
}
