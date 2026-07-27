import type { LinkTarget } from './state/previewState'

/**
 * A same-page anchor jump (href="#cite_note-27") still resolves to an http(s) URL via
 * anchor.href (e.g. the current page's own URL plus a fragment) — checking protocol alone
 * doesn't exclude it, and previewing the page the user is already on is pointless.
 */
function isSamePageAnchor(anchor: HTMLAnchorElement): boolean {
  return (
    anchor.hash !== '' &&
    anchor.origin === location.origin &&
    anchor.pathname === location.pathname &&
    anchor.search === location.search
  )
}

function resolveLinkTarget(event: DragEvent): LinkTarget | null {
  // `isTrusted` is false for any event page script synthesised with dispatchEvent. Without this
  // the page itself can start a preview with no reader involved at all — fabricate a drag on an
  // anchor of its choosing and the background worker fetches that URL from the reader's network
  // position. The gesture is supposed to be evidence that a person wanted this; a synthetic
  // event is evidence of nothing. See `fetchPolicy.ts` for what a fetch is worth to an attacker.
  if (!event.isTrusted) return null
  if (!(event.target instanceof Element)) return null
  const anchor = event.target.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if (anchor.protocol !== 'http:' && anchor.protocol !== 'https:') return null
  if (isSamePageAnchor(anchor)) return null
  return { url: anchor.href, anchorText: anchor.textContent?.trim() || undefined }
}

/**
 * Wires native dragstart/dragover/drop/dragend on `document` and calls `onDragEnd` only for
 * http(s) links. preventDefault on dragover/drop is gated behind a per-gesture flag — this
 * content script runs on <all_urls>, so an unconditional preventDefault would break every
 * other page's own drag-and-drop (image drags, text drags, Trello/Gmail-style DnD).
 *
 * The callback fires on dragend, not dragstart: Chrome suppresses/throttles page rendering
 * for the duration of an active native drag, so anything shown while still dragging (like
 * the panel's entrance transition) never actually gets painted mid-drag — it just snaps to
 * its final state once the drag concludes. Waiting for dragend (which always fires, whether
 * the drag was dropped or cancelled) is what lets that transition actually play.
 *
 * Returns the way to stop. Excluding a site has to take effect on the tab the reader is standing
 * on, and these four listeners are the part of Piko with an effect the page can *feel*: the
 * gated preventDefault on dragover is what makes a link droppable. Leaving them attached after a
 * stand-down would keep altering drag behaviour on the one site the reader asked Piko to leave.
 */
export function startDragTracking(onDragEnd: (target: LinkTarget) => void): () => void {
  let isTrackingDrag = false
  let pendingTarget: LinkTarget | null = null
  // One signal for all four, so a listener added later cannot be forgotten by the teardown.
  const listeners = new AbortController()
  const options = { capture: true, signal: listeners.signal }

  document.addEventListener(
    'dragstart',
    (event) => {
      const target = resolveLinkTarget(event)
      if (!target) return
      isTrackingDrag = true
      pendingTarget = target
    },
    options,
  )

  document.addEventListener(
    'dragover',
    (event) => {
      if (isTrackingDrag) event.preventDefault()
    },
    options,
  )

  document.addEventListener(
    'drop',
    (event) => {
      if (isTrackingDrag) event.preventDefault()
    },
    options,
  )

  document.addEventListener(
    'dragend',
    () => {
      isTrackingDrag = false
      if (!pendingTarget) return
      const target = pendingTarget
      pendingTarget = null
      onDragEnd(target)
    },
    options,
  )

  return () => listeners.abort()
}
