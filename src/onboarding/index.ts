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
 */
import { ALL_SITES } from '../background/contentScriptRegistration'

const button = document.getElementById('grant') as HTMLButtonElement | null
const status = document.getElementById('status')

function say(message: string, state: 'idle' | 'granted' | 'declined'): void {
  if (!status) return
  status.textContent = message
  status.dataset.state = state
}

async function reflectCurrentAccess(): Promise<void> {
  if (await chrome.permissions.contains(ALL_SITES)) {
    say('Piko is allowed on all sites. Drag a hyperlink on any page to try it.', 'granted')
    if (button) {
      button.disabled = true
      button.textContent = 'Already allowed'
    }
  }
}

button?.addEventListener('click', async () => {
  try {
    const granted = await chrome.permissions.request(ALL_SITES)
    if (granted) {
      say('Done. Drag a hyperlink on any page to try it.', 'granted')
      button.disabled = true
      button.textContent = 'Already allowed'
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
