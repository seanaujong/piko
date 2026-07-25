import type { ExtensionRequest, TabRequest } from '../shared/messages'
import { checkFrameability } from './frameability'

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
  switch (message.type) {
    case 'CHECK_FRAMEABILITY':
      checkFrameability(message.targetUrl, message.pageOrigin).then(sendResponse)
      return true // keep the message channel open for the async sendResponse above
    default: {
      const exhaustive: never = message.type
      return exhaustive
    }
  }
})

/**
 * The toolbar icon is the way into the journal that doesn't require dragging a link, and the
 * same click arms clipping on the page. `chrome.action` is a manifest key, not a permission,
 * so this costs no install warning; sending to a tab rides on the host permissions already
 * granted rather than needing `tabs`.
 */
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return
  const request: TabRequest = { type: 'TOGGLE_CLIPPING' }
  // A tab that predates the most recent extension reload has no listener; failing quietly is
  // right, because the panel would have no way to report it either.
  void chrome.tabs.sendMessage(tab.id, request).catch(() => {})
})
