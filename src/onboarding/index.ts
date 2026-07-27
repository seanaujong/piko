/**
 * The one interaction on the onboarding page: asking for host access.
 *
 * `chrome.permissions.request` must be called from inside a user gesture, which is why this is a
 * click handler and not something the worker does on install. Chrome answers with its own
 * dialog; nothing here can pre-empt or skip it, and a decline is a legitimate outcome rather
 * than an error — Piko simply stays inert until the reader changes their mind.
 *
 * The registration that follows a grant belongs to the background worker, which listens on
 * `chrome.permissions.onAdded`. This page deliberately does not register anything itself: a
 * grant made from `chrome://extensions` rather than from this button has to work identically,
 * and it will only do that if one listener owns the consequence.
 *
 * The page is reached a second time, from the icon's Options item, so it has a *state* and not
 * just a control. That state is one attribute — `showAccess` is the only writer of it, and the
 * two versions of the copy are in the HTML rather than in strings here. What belongs in script
 * is the answer to "is Piko allowed?"; which sentence that answer selects is presentation.
 */
import { ALL_SITES } from '../background/contentScriptRegistration'

const button = document.getElementById('grant') as HTMLButtonElement | null
const status = document.getElementById('status')

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
    say('Not allowed, so Piko will stay inert. You can press the button again whenever.', 'declined')
  } catch (error) {
    // Requesting outside a gesture is the usual cause, and it cannot happen from here — but a
    // silent failure on the one control this page has would be the worst outcome, so say it.
    say(
      error instanceof Error ? `Chrome refused the request: ${error.message}` : 'Chrome refused the request.',
      'declined',
    )
  }
})

void reflectCurrentAccess()
