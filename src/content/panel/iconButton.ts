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
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16" y2="16"/>',
  here: '<path d="M12 21s7-6.7 7-11a7 7 0 1 0-14 0c0 4.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  trash: '<polyline points="3 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
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
