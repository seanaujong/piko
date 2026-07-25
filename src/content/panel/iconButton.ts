/**
 * Square icon buttons, shared by the panel header and the clippings list.
 *
 * The markup strings are module constants that never carry page content, so assigning them
 * with innerHTML opens no injection surface — unlike article HTML, which goes through
 * DOMPurify in extract.ts.
 */
export const ICON = {
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  copied: '<polyline points="20 6 9 17 4 12"/>',
  newTab:
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  remove: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
} as const

export const iconMarkup = (parts: string): string =>
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${parts}</svg>`

export function iconButton(label: string, parts: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'piko-icon-button'
  button.title = label
  button.setAttribute('aria-label', label)
  button.innerHTML = iconMarkup(parts)
  return button
}

/**
 * Swap to a confirmation glyph and back. Copy is otherwise silent — the clipboard gives no
 * feedback of its own, and a write that quietly failed is indistinguishable from one that
 * worked.
 */
export function flashResult(button: HTMLButtonElement, ok: boolean, resting: string): void {
  button.innerHTML = iconMarkup(ok ? ICON.copied : resting)
  button.classList.add(ok ? 'is-done' : 'is-failed')
  setTimeout(() => {
    button.innerHTML = iconMarkup(resting)
    button.classList.remove('is-done', 'is-failed')
  }, 1400)
}
