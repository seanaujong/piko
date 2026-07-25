import type { CheckFrameabilityRequest, CheckFrameabilityResponse } from '../shared/messages'
import { startDragTracking } from './dragTracking'
import { mountPanel } from './panel/mountPanel'
import type { LinkTarget, PreviewEvent, PreviewState } from './state/previewState'
import { transition } from './state/previewState'

let state: PreviewState = { kind: 'idle' }
const panel = mountPanel(dispatch, startPreview)

function dispatch(event: PreviewEvent): void {
  state = transition(state, event)
  panel.render(state)
}

// Bumped on every new drag so a late-arriving response from an earlier, superseded drag
// never clobbers whatever the panel is now showing — the reducer stays free of this
// request-lifecycle concern entirely; it only ever sees semantically-current events.
let generation = 0

function requestFrameabilityCheck(target: LinkTarget): void {
  const myGeneration = ++generation
  const request: CheckFrameabilityRequest = {
    type: 'CHECK_FRAMEABILITY',
    targetUrl: target.url,
    pageOrigin: window.location.origin,
  }

  try {
    chrome.runtime.sendMessage(request, (response: CheckFrameabilityResponse | undefined) => {
      if (myGeneration !== generation) return

      if (!response) {
        dispatch({
          type: 'FrameCheckFailed',
          reason: chrome.runtime.lastError?.message ?? 'No response from the extension background.',
        })
        return
      }

      switch (response.type) {
        case 'FRAME_OK':
          dispatch({ type: 'FrameCheckOk', finalUrl: response.finalUrl, html: response.html })
          break
        case 'FRAME_BLOCKED':
          dispatch({ type: 'FrameCheckBlocked', finalUrl: response.finalUrl, html: response.html })
          break
        case 'UNSUPPORTED_CONTENT':
          dispatch({ type: 'UnsupportedContent', contentType: response.contentType })
          break
        case 'FETCH_ERROR':
          dispatch({ type: 'FrameCheckFailed', reason: response.reason })
          break
      }
    })
  } catch {
    // Most commonly "Extension context invalidated" — this tab's content script predates
    // the extension's most recent reload, and its chrome.runtime connection is now dead.
    // Fails the preview cleanly instead of leaving it stuck on "loading" forever.
    dispatch({
      type: 'FrameCheckFailed',
      reason: 'Piko was updated — refresh this page to keep using the preview.',
    })
  }
}

/**
 * The one way a preview begins, whatever asked for it — a drag on the page, or the clippings
 * pane reopening a clipping's source. Both go through the same reducer event, so neither the
 * state machine nor the panel has to know which it was.
 */
function startPreview(target: LinkTarget): void {
  dispatch({ type: 'PreviewRequested', target })
  requestFrameabilityCheck(target)
}

startDragTracking(startPreview)
