/**
 * Clipboard writes, with the two constraints that actually bite.
 *
 * No manifest permission is involved. On a real click over an HTTPS page, a content script's
 * `navigator.clipboard.writeText()` is allowed by the click's own transient activation, with
 * no prompt and no indicator. Adding `clipboardWrite` would only lift an activation
 * requirement already satisfied, and it costs a user-facing install warning — "Modify data
 * you copy and paste" — so it is deliberately absent from the manifest.
 *
 * What does bite:
 *  - `navigator.clipboard` is not exposed to content scripts outside a secure context, so an
 *    `http://` page needs the deprecated-but-unrestricted `execCommand` path.
 *  - Transient activation is lost by awaiting anything first. This must be called
 *    synchronously from the click handler, never after a round-trip.
 */
export function copyText(text: string): boolean {
  if (window.isSecureContext && navigator.clipboard) {
    // Fire-and-forget: awaiting here would not change the outcome, and the rejection is
    // already handled by the fallback below never running for the secure-context case.
    void navigator.clipboard.writeText(text).catch(() => copyViaSelection(text))
    return true
  }
  return copyViaSelection(text)
}

/**
 * `execCommand('copy')` copies *the current selection*, so unlike `writeText` it needs a live
 * selection to exist. Establishing one inside a shadow root is unreliable, so the textarea is
 * parked in the host document instead.
 */
function copyViaSelection(text: string): boolean {
  const staging = document.createElement('textarea')
  staging.value = text
  staging.setAttribute('readonly', '')
  staging.style.position = 'fixed'
  staging.style.top = '-1000px'
  staging.style.opacity = '0'
  document.body.appendChild(staging)

  try {
    staging.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    staging.remove()
  }
}
