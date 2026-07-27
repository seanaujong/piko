# Privacy Policy — Piko

_Last updated: 2026-07-26_

**Piko does not collect, store, transmit, or sell any personal or user data.**

Everything Piko does happens in your own browser. It has no server, no account, and no
analytics. Specifically:

- **What it reads.** Piko's content script runs on the pages you visit so that dragging a
  link, or pressing its toolbar icon, works without you having to turn it on first. What it
  reads is the text of the page in front of you — enough to find sentence boundaries, draw a
  highlight under the sentence you are hovering, and record the one you click. This never
  leaves your browser.
- **What it fetches.** When you drag a link, Piko fetches **that link's page** so it can be
  read in place. This is a request to the site you were already heading to, and it is the
  only network request Piko makes. It carries **no cookies or credentials** for that site,
  because the request is made from the extension rather than from the page, so the copy Piko
  fetches is the signed-out one. Nothing about you is included, and no request is ever made
  to any server belonging to Piko — there isn't one.
- **What it stores.** The sentences you clip are saved in your browser's own extension
  storage (`chrome.storage.local`) so the journal survives closing a tab. Each entry holds
  the sentence, the page it came from, that page's title, the page you were on when you
  dragged the link, and the time you clipped it. This is stored **on your device only** and
  is never uploaded. You can delete all of it at any time from the journal's own delete
  button, or by removing the extension. The same storage holds any sites you have told Piko
  to stay off — hostnames you chose yourself, kept on the same terms.
- **Sites you exclude.** Right-clicking Piko's toolbar icon offers to keep Piko off the site
  you are on; the same menu takes it back, and Piko's options page lists every site you have
  named so you can read or undo the whole list without going back to any of them. Piko then
  neither runs on that site nor fetches
  links pointing at it. Piko also refuses a short built-in list of sign-in, webmail,
  password-manager and chat hosts without being asked. That list is short on purpose: it
  covers categories that can be listed nearly completely, and banking cannot — so your bank
  is yours to name.
- **What leaves your browser, and only when you ask.** Copying a clipping puts it on your
  clipboard. Exporting the journal writes a Markdown file to your downloads. Both happen only
  on a click you make, and both go where you tell them.
- **What it does *not* do.** No analytics, no tracking, no cookies, no accounts, no remote
  logging, no advertising, no third-party services, and no AI model — Piko sends your reading
  nowhere, to nobody, for nothing. No data is ever sold or shared, because none is ever
  collected.

## Why it asks for access to every site

Piko requests access to all sites for one reason: it cannot know in advance which page you
will drag a link on. The extension does nothing at all until you drag a hyperlink or press
its toolbar icon, and it has no interest in any page you do not do that on. This access is
what makes a drag work on the page you happen to be reading; it is not used to observe your
browsing, and nothing about the pages you visit is recorded unless you clip a sentence.

Piko is open source, so you can check every claim above against the code:
<https://github.com/seanaujong/piko>.

Questions or corrections? Open an issue at <https://github.com/seanaujong/piko/issues>.
