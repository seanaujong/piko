/**
 * The content script: folds events into `PreviewState` and renders the result.
 *
 * It decides nothing. Every choice about what a preview shows belongs to `transition`, and this
 * file's job is to notice things — a drag, a response from the background worker, the toolbar
 * icon — and say so. What it does own is the request lifecycle around those messages, which is
 * a concern about the network rather than about the reader: see `generation` below.
 */
import type {
  CheckFrameabilityRequest,
  CheckFrameabilityResponse,
  TabRequest,
} from '../shared/messages'
import { startDragTracking } from './dragTracking'
import { mountPanel, type PanelHandle } from './panel/mountPanel'
import type { LinkTarget, PreviewEvent, PreviewState } from './state/previewState'
import { transition } from './state/previewState'

let state: PreviewState = { kind: 'idle' }

/**
 * The panel is built on the first gesture, not on page load.
 *
 * Piko runs on every site a reader visits, and mounting eagerly meant every one of them got a
 * shadow host on `<html>` and a stylesheet injected before the reader had asked for anything.
 * Nothing was *read* that way — the trackers below only attach listeners — but "Piko does
 * nothing until you drag a link or press the icon", which is the claim the broad host permission
 * rests on, was true of the data and false of the DOM.
 *
 * A guarantee that holds on every site is worth more than a list of the sites it holds on, so
 * this is the stronger half of the same promise `shared/sensitiveHosts.ts` makes narrowly.
 */
let panel: PanelHandle | null = null

function livePanel(): PanelHandle {
  panel ??= mountPanel(dispatch)
  return panel
}

function dispatch(event: PreviewEvent): void {
  state = transition(state, event)
  livePanel().render(state)
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

/** The one way a preview begins: name the request, then go ask whether the page can be framed. */
function startPreview(target: LinkTarget): void {
  dispatch({ type: 'PreviewRequested', target })
  requestFrameabilityCheck(target)
}

const stopDragTracking = startDragTracking(startPreview)

/**
 * Undo the injection, as far as an injected script can.
 *
 * `excludeMatches` keeps Piko out of an excluded site from its next load; it can do nothing
 * about this tab, where the script is already running. Chrome offers no way to unload a content
 * script, so what is reachable is everything it *does* — the listeners, the panel, the page's
 * borrowed margin — and that is what this gives back. The script stays resident and inert.
 *
 * Deliberately one-way, with no matching wake-up. Re-arming would mean this file holding a rule
 * about whether Piko may run, and that rule belongs to the worker, which owns the list. A tab
 * that is told to stand down stands down until it is reloaded.
 */
let stoodDown = false

function standDown(): void {
  stoodDown = true
  stopDragTracking()
  panel?.unmount()
  panel = null
  state = { kind: 'idle' }
}

// The toolbar icon is the entry point that needs no drag: it arms clipping on this page and
// docks the journal beside it.
chrome.runtime.onMessage.addListener((message: TabRequest) => {
  switch (message.type) {
    case 'TOGGLE_CLIPPING':
      // The worker will not send this for an excluded site, and this checks anyway — the same
      // both-directions instinct as `fetchPolicy` guarding a fetch that `excludeMatches` should
      // already have prevented. A remounted panel on the site a reader just excluded is exactly
      // the failure this whole feature exists to prevent, so it is worth one boolean.
      if (stoodDown) break
      livePanel().toggleHostClipping()
      break
    case 'STAND_DOWN':
      standDown()
      break
  }
})
