import type { ExtensionRequest, TabRequest } from '../shared/messages'
import { checkFrameability } from './frameability'
import { hasHostAccess, syncContentScriptRegistration } from './contentScriptRegistration'

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
 * Registration follows the grant, from wherever the grant changes.
 *
 * The worker is not long-lived, so the top-level call matters as much as the events: a worker
 * woken for an unrelated reason is the one that notices a registration that went missing.
 */
void syncContentScriptRegistration()
chrome.runtime.onStartup.addListener(() => void syncContentScriptRegistration())
chrome.permissions.onAdded.addListener(() => void syncContentScriptRegistration())
chrome.permissions.onRemoved.addListener(() => void syncContentScriptRegistration())

/**
 * Piko can reach nothing until the reader says otherwise, so the first thing after install is
 * the page that explains what is being asked for and why. Chrome's own install prompt no longer
 * carries that question, which is the point — it is a better question when it is asked in
 * Piko's words, next to a description of the gesture it enables.
 */
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void openOnboarding()
})

function openOnboarding(): Promise<chrome.tabs.Tab> {
  return chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
}

/**
 * The toolbar icon is the way into the journal that doesn't require dragging a link, and the
 * same click arms clipping on the page. `chrome.action` is a manifest key, not a permission, so
 * this costs no install warning.
 *
 * Without the grant there is no content script to receive the message, and a click that did
 * nothing would read as a broken extension — so it opens the page that explains why instead.
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return

  if (!(await hasHostAccess())) {
    void openOnboarding()
    return
  }

  const request: TabRequest = { type: 'TOGGLE_CLIPPING' }
  // A tab that predates the most recent extension reload has no listener; failing quietly is
  // right, because the panel would have no way to report it either.
  void chrome.tabs.sendMessage(tab.id, request).catch(() => {})
})
