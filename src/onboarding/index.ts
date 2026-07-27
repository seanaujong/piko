/**
 * Piko's options page, which is also the page the install opens.
 *
 * Two settings, and they are the two questions the extension can be asked: *may Piko run at
 * all*, and *where may it not*. Everything else on the page is the explanation that has to
 * accompany the first one, which is why the install lands here rather than on a page of prose
 * with the button somewhere else.
 *
 * **The grant.** `chrome.permissions.request` must be called from inside a user gesture, which is
 * why it is a click handler and not something the worker does on install. Chrome answers with its
 * own dialog; nothing here can pre-empt or skip it, and a decline is a legitimate outcome rather
 * than an error — Piko simply stays inert until the reader changes their mind.
 *
 * The registration that follows a grant belongs to the background worker, which listens on
 * `chrome.permissions.onAdded`. This page deliberately does not register anything itself: a
 * grant made from `chrome://extensions` rather than from this button has to work identically,
 * and it will only do that if one listener owns the consequence. The same holds for the site
 * list below — it writes the reader's list and nothing else, and the worker's
 * `onExcludedSitesChanged` does the rest, exactly as it does for the icon's menu.
 *
 * **Both readouts are derived, never remembered.** `showAccess` and `showSites` each ask their
 * source and rebuild from the answer, so a list changed from the icon's menu while this tab sits
 * open is not a stale view — it is the same rebuild the first paint took.
 */
import { ALL_SITES } from '../background/contentScriptRegistration'
import { includeSite, onExcludedSitesChanged, readExcludedSites } from '../background/excludedSites'
import { renderSiteList, siteRows } from './siteList'

const button = document.getElementById('grant') as HTMLButtonElement | null
const status = document.getElementById('status')
const sites = document.getElementById('sites')

function say(message: string, state: 'idle' | 'granted' | 'declined'): void {
  if (!status) return
  status.textContent = message
  status.dataset.state = state
}

/** Reveals the copy written for one of the two states, and settles the control that changes it. */
function showAccess(granted: boolean): void {
  document.documentElement.dataset.access = granted ? 'granted' : 'absent'
  if (granted && button) {
    button.disabled = true
    button.textContent = 'Already allowed'
  }
}

async function reflectCurrentAccess(): Promise<void> {
  const granted = await chrome.permissions.contains(ALL_SITES)
  showAccess(granted)
  if (granted) say('Piko is allowed on all sites.', 'granted')
}

button?.addEventListener('click', async () => {
  try {
    const granted = await chrome.permissions.request(ALL_SITES)
    if (granted) {
      showAccess(true)
      say('Done. Try it below.', 'granted')
      return
    }
    say('Not allowed, so Piko will not run anywhere. Press the button again whenever you change your mind.', 'declined')
  } catch (error) {
    // Requesting outside a gesture is the usual cause, and it cannot happen from here — but a
    // silent failure on the one control this page has would be the worst outcome, so say it.
    say(
      error instanceof Error ? `Chrome refused the request: ${error.message}` : 'Chrome refused the request.',
      'declined',
    )
  }
})

async function showSites(): Promise<void> {
  if (!sites) return
  const rows = siteRows(await readExcludedSites())
  sites.replaceChildren(renderSiteList(rows, (host) => void includeSite(host)))
}

// Redrawn from storage rather than from the click that changed it, so a list edited from the
// icon's menu in another window lands here on the same path — and so the row only goes once the
// write it stands for actually landed.
onExcludedSitesChanged(() => void showSites())

void reflectCurrentAccess()
void showSites()
