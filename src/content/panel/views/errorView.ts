export function renderError(root: HTMLElement, reason: string): void {
  const wrapper = document.createElement('div')
  wrapper.className = 'piko-error'
  wrapper.textContent = reason
  root.replaceChildren(wrapper)
}
