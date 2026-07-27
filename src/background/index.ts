import type { ExtensionRequest, TabRequest } from '../shared/messages'
import { checkFrameability } from './frameability'
import { hasHostAccess, syncContentScriptRegistration } from './contentScriptRegistration'
import {
  excludeSite,
  excludedEntryFor,
  includeSite,
  onExcludedSitesChanged,
  readExcludedSites,
} from './excludedSites'
import { actionForMenuItem, siteMenuItems } from './siteMenu'

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

// The reader's own list changes what the script may be registered for, on the same terms a
// permission change does — so it wakes the same sync rather than a parallel one.
onExcludedSitesChanged(() => {
  void syncContentScriptRegistration()
  refreshSiteMenu()
})

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

  // An excluded site gets nothing, including from the icon. Doing nothing reads as broken in
  // general and does not here: it is the reader's own answer to "never run Piko on this site",
  // and the menu that answers it is one right-click away on this very icon.
  if (tab.url && excludedEntryFor(tab.url, await readExcludedSites())) return

  const request: TabRequest = { type: 'TOGGLE_CLIPPING' }
  // A tab that predates the most recent extension reload has no listener; failing quietly is
  // right, because the panel would have no way to report it either.
  void chrome.tabs.sendMessage(tab.id, request).catch(() => {})
})

/**
 * The site menu is rebuilt rather than updated, because what it *offers* changes with the page:
 * one item to exclude, or two when there is a parent worth offering, or one to undo, or a
 * disabled line for a site the shipped list already covers. Chrome has no "set the menu to
 * this", so a rebuild is `removeAll` followed by creates — two calls that must not interleave
 * with another rebuild's, hence the chain rather than a bare `void`.
 */
let menuWork: Promise<void> = Promise.resolve()

function refreshSiteMenu(): void {
  menuWork = menuWork.then(rebuildSiteMenu).catch(() => {})
}

async function rebuildSiteMenu(): Promise<void> {
  await chrome.contextMenus.removeAll()

  // Before the grant there is no site Piko could run on, so there is nothing to keep it off.
  if (!(await hasHostAccess())) return

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.url) return

  for (const item of siteMenuItems(tab.url, await readExcludedSites())) {
    chrome.contextMenus.create({
      id: item.id,
      title: item.title,
      enabled: item.enabled,
      contexts: ['action'],
    })
  }
}

refreshSiteMenu()
chrome.runtime.onStartup.addListener(refreshSiteMenu)
chrome.runtime.onInstalled.addListener(refreshSiteMenu)
chrome.permissions.onAdded.addListener(refreshSiteMenu)
chrome.permissions.onRemoved.addListener(refreshSiteMenu)
chrome.tabs.onActivated.addListener(refreshSiteMenu)
chrome.windows.onFocusChanged.addListener(refreshSiteMenu)
// A navigation within the same tab changes the site the menu is about, and `status: 'complete'`
// is not the trigger — the address changes before the load finishes, and the menu should be
// about where the reader now is rather than where they were.
chrome.tabs.onUpdated.addListener((_tabId, changed) => {
  if (changed.url) refreshSiteMenu()
})

chrome.contextMenus.onClicked.addListener((info) => {
  const action = actionForMenuItem(String(info.menuItemId))
  if (action) void applySiteMenuAction(action)
})

async function applySiteMenuAction(action: {
  verb: 'exclude' | 'include'
  host: string
}): Promise<void> {
  if (action.verb === 'include') {
    // No matching wake-up for the open tabs: they have no content script to wake. Registration
    // catches up on their next load, which is the earliest Chrome can inject into them at all.
    await includeSite(action.host)
    return
  }

  await excludeSite(action.host)

  // Every open tab on the site, not just the one that was right-clicked — a reader with their
  // bank open in three tabs excluded it in all three, and leaving two of them live would make
  // the guarantee depend on which tab they happened to be standing in.
  const excluded = await readExcludedSites()
  const request: TabRequest = { type: 'STAND_DOWN' }
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id === undefined || !tab.url) continue
    if (!excludedEntryFor(tab.url, excluded)) continue
    void chrome.tabs.sendMessage(tab.id, request).catch(() => {})
  }
}
