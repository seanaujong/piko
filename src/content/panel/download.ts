/**
 * Handing a file to the browser, with the constraints that actually bite.
 *
 * No manifest permission is involved, deliberately — the same trade `clipboard.ts` documents.
 * `chrome.downloads` would do this too and costs a user-facing install warning ("Manage your
 * downloads"); an anchor carrying a `download` attribute costs nothing, because the click that
 * triggers it is already a real one.
 *
 * What does bite:
 *  - Transient activation is lost by awaiting anything first, exactly as with the clipboard.
 *    This must be called synchronously from the click handler, never after a round-trip.
 *  - The anchor is parked in the host document rather than in the panel's shadow root, which is
 *    where the clipboard's staging element already goes for the same reason.
 *
 * `true` means the browser accepted the click, not that a file reached the disk — nothing
 * reports the latter back to script. That is why this path is on CLAUDE.md's human-only list
 * alongside the clipboard write it is modelled on.
 */
export function downloadText(filename: string, text: string): boolean {
  let created: string | null = null

  try {
    created = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = created
    anchor.download = filename
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return true
  } catch {
    return false
  } finally {
    // Revoking in the same task can cancel the download the click just started; a turn later the
    // browser holds its own reference to the blob and the URL is safe to drop.
    const url = created
    if (url !== null) setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
