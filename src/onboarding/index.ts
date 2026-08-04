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
import { startDragTracking } from '../content/dragTracking'
import { renderSiteList, siteRows } from './siteList'

const button = document.getElementById('grant') as HTMLButtonElement | null
const status = document.getElementById('status')
const sites = document.getElementById('sites')
const practiceSaid = document.getElementById('practice-said')

/**
 * The one answer the button cannot give for itself: that the grant did not happen, and why.
 *
 * Success has no counterpart here. A granted button turns green and says so, which is the same
 * news a green line under it would carry — and the heading and the paragraph above have both
 * already changed by then, so a fourth telling was three too many. A refusal has no such
 * spokesman: nothing about a button that still reads *Allow Piko on all sites* explains that
 * Chrome was asked and said no.
 */
function refuse(message: string): void {
  if (!status) return
  status.textContent = message
  status.dataset.state = 'declined'
}

/** Reveals the copy written for one of the two states, and settles the control that changes it. */
function showAccess(granted: boolean): void {
  document.documentElement.dataset.access = granted ? 'granted' : 'absent'
  if (!granted || !button) return

  button.disabled = true
  button.textContent = '✓ Already allowed'
  button.dataset.state = 'granted'

  // A reader who declined and then changed their mind still has the refusal on screen, and it is
  // not true any more. Cleared here rather than in the click handler because this is the one
  // place that knows access was granted, whichever of the two routes arrived at it.
  if (status) {
    status.textContent = ''
    status.dataset.state = 'idle'
  }
}

async function reflectCurrentAccess(): Promise<void> {
  showAccess(await chrome.permissions.contains(ALL_SITES))
}

button?.addEventListener('click', async () => {
  try {
    const granted = await chrome.permissions.request(ALL_SITES)
    if (granted) {
      showAccess(true)
      return
    }
    refuse('Not allowed, so Piko will not run anywhere. Press the button again whenever you change your mind.')
  } catch (error) {
    // Requesting outside a gesture is the usual cause, and it cannot happen from here — but a
    // silent failure on the one control this page has would be the worst outcome, so say it.
    refuse(
      error instanceof Error ? `Chrome refused the request: ${error.message}` : 'Chrome refused the request.',
    )
  }
})

async function showSites(): Promise<void> {
  if (!sites) return
  const rows = siteRows(await readExcludedSites())
  sites.replaceChildren(renderSiteList(rows, (host) => void includeSite(host)))
}

/**
 * Confirms the one gesture this page teaches and cannot itself perform.
 *
 * The content script is registered for `<all_urls>`, which covers http, https, file and ftp and
 * does not cover `chrome-extension:` — the scheme this page is served on. No grant and no reload
 * changes that, so a link dragged here is an ordinary dragged link. That leaves the tutorial
 * describing the product's headline gesture on the one page that cannot answer it, while the
 * reader's likeliest first instinct is to try it on the link sitting in the paragraph.
 *
 * So the motion is confirmed and the outcome is not faked. Nothing is previewed and nothing is
 * fetched; the paragraph this reveals says what happened, which is that the gesture was right and
 * that this page is not one Piko runs on.
 *
 * **The whole tracker, not a watcher on one marked link.** Reusing what the content script runs
 * leaves one definition of the gesture rather than a second one written to resemble it, and
 * answers for whatever links this page holds rather than for the one element someone remembered
 * to tag. What differs between the two callers is only what they do with the answer: the content
 * script previews, and this explains.
 *
 * Reuse carries the guards across as well as the rule, and both earn their place here for reasons
 * of their own. `isTrusted` keeps the confirmation honest — it claims *you did this*, and a
 * script-made event is evidence that nobody did. The gated `preventDefault` on drop is what stops
 * Chrome navigating this tab to a link dropped onto it, which would throw the reader off the
 * tutorial at the moment they followed it correctly.
 *
 * The teardown is dropped deliberately: there is no standing down from an extension page, which
 * lives exactly as long as the tab showing it.
 */
startDragTracking(() => practiceSaid?.removeAttribute('hidden'))

// Redrawn from storage rather than from the click that changed it, so a list edited from the
// icon's menu in another window lands here on the same path — and so the row only goes once the
// write it stands for actually landed.
onExcludedSitesChanged(() => void showSites())

void reflectCurrentAccess()
void showSites()
