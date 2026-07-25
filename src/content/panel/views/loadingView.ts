import type { LinkTarget } from '../../state/previewState'

export function renderLoading(root: HTMLElement, target: LinkTarget): void {
  const wrapper = document.createElement('div')
  wrapper.className = 'lockin-loading'
  wrapper.textContent = `Loading ${target.anchorText ?? target.url}…`
  root.replaceChildren(wrapper)
}
