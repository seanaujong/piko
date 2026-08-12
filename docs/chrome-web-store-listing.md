# Chrome Web Store submission — copy/paste fields

Everything the Developer Dashboard asks for, ready to paste, kept here because the dashboard is
not version-controlled and re-deriving this under review pressure is how a listing ends up
saying something the extension does not do. Upload `piko-<version>.zip` (from `npm run package`)
as the package.

**Read the permissions section before submitting.** Piko asks for access to every site, which is
the slowest category of review there is, and the justification is the part of this document that
actually decides whether the listing goes through. It is written to be true rather than
reassuring: everything claimed below is checkable in the source.

## Store listing

**Product name**

```
Piko
```

**Summary** (≤ 132 chars)

```
Preview links by dragging them
```

**Category:** `Productivity`
**Language:** `English`

**Description**

```
Piko lets you preview links by dragging them. Read through websites without losing context!

As you read with Piko, hover and click on sentences to save them as notes.

Free and open source (MIT).
```

## Privacy practices

These map onto the **Privacy practices** tab. Piko requests three API permissions (`storage`,
`scripting` and `contextMenus`) and broad host access, so there are four justification boxes to
fill. None of the API permissions raises an install warning — that is what qualified them — but
the dashboard asks for a justification per declared permission whether it warns or not. Fill them
in order.

### Single purpose

The dashboard wants **one** purpose, and Piko has two entry points, so this states the purpose
and shows both as ways into it rather than listing two features.

```
Piko lets a reader open a linked article in place and keep the sentences worth keeping. A
hyperlink dragged out of a page opens that page's article over it in reader mode; the toolbar
icon does the same for the page already open. On either, clicking a sentence saves it to a
local journal with a link back to that exact sentence. Everything happens in the browser.
```

### Permission justification — `storage`

```
The journal of clipped sentences is kept in chrome.storage.local so that it survives closing a
tab or restarting the browser, which is the entire point of a journal. It holds only what the
user clipped: the sentence, the page it came from, that page's title, the page they were on
when they dragged the link, and the time. It stays on the device and is never transmitted.

The same local storage holds the list of sites the user has told Piko to stay off, which is
a list of hostnames they chose themselves and is likewise never transmitted.
```

### Permission justification — `scripting`

The reviewer-facing point is that this is the mechanism behind the whole "asked for at runtime,
not at install" design in the host permission justification below: the manifest declares no
`content_scripts`, so nothing can run in a page until this permission does the registering, on
the reader's own say-so. `background/contentScriptRegistration.ts` is the whole of it.

```
Piko's manifest declares no content_scripts, so it can reach no page until the reader grants
access from its own onboarding page. This permission is what registers the content script
afterward, with chrome.scripting.registerContentScripts — and unregisters it the moment access
is revoked, or updates it when the reader excludes a site, so an old registration is never left
matching a page it should no longer run on.

Piko does not use scripting.executeScript or any other means of injecting arbitrary code. The
only script ever registered is the extension's own bundled content.js, and only once host access
has been granted.
```

### Permission justification — `contextMenus`

The reviewer-facing point is that this permission is what makes the broad host access
*revocable per site* by the user, which is worth saying plainly in the box.

```
Right-clicking Piko's toolbar icon offers "Never run Piko on <this site>", which is how a user
keeps Piko off a site they consider sensitive — their bank, for example. The extension holds no
list of such sites on the user's behalf beyond a few sign-in, webmail and password-manager
hosts it refuses by default; this permission is what lets the user name their own. The same
menu offers the reverse, so the choice can be undone from where it was made, and Piko's options
page lists every entry so it can also be undone from anywhere. No page content is read to build
the menu: it is titled from the address of the active tab.
```

### Host permission justification — all sites, requested at runtime

Piko declares `optional_host_permissions`, not `host_permissions`, and declares no
`content_scripts` — so **the install prompt says nothing about your browsing**. Access is asked
for on Piko's own onboarding page, which the install opens, and Chrome's confirmation follows a
paragraph explaining what it enables. That is still `<all_urls>` once granted, and the
justification below is what the dashboard wants for it.

Two things a reviewer may check, both true: an extension declaring only `content_scripts` for
`<all_urls>` and no `host_permissions` at all still receives the broad-host grant and its
warning, which is why neither key appears here; and the grant is one decision covering every
site rather than a prompt per site, because the gesture Piko exists for is dragging a link on a
page the reader is *already* on.

```
Piko is a drag gesture on a hyperlink, so it has to already be listening on whatever page the
reader is on when they perform it. activeTab grants access only after the user clicks the
extension's icon, which is one click too late — by then the drag has happened and been missed.
There is also no way to know in advance which sites a reader will use it on, and a fixed list
would simply not work anywhere else.

The permission is optional and is not requested at install. After installing, Piko opens a page
explaining what the access is for; nothing works until the reader presses the button there and
confirms Chrome's prompt. A reader who prefers to grant particular sites only can do that from
chrome://extensions instead, and Piko stays inert everywhere else.

Two capabilities need the access:

• The content script reads the text of the current page to find sentence boundaries, draw the
  highlight under the sentence being hovered, and record the one that is clicked. It also
  renders the reading panel. All of this stays in the page.

• The background service worker fetches the URL of a dragged link, so the article can be shown
  in place. This is the same page the browser would load if the link were clicked, requested
  from the extension rather than the page. It is sent with credentials omitted and no referrer,
  so it carries no cookies for that site. Its response headers are also the only way to learn
  whether the page permits being framed, which a page-context fetch cannot read at all.

The access is broad, so it is narrowed everywhere it can be:

• Piko does not run on webmail, password managers, chat or single-sign-on pages. The list is in
  the source at src/shared/sensitiveHosts.ts and is passed as excludeMatches when the content
  script is registered; the background worker refuses to fetch those hosts as well. Banking is
  deliberately not on the list: it cannot be enumerated honestly, and a partial list would claim
  more than it delivers.

• Nothing is added to any page until the reader drags a link or presses the toolbar icon. The
  panel is built on first use, not on page load.

• A preview begins only from a genuine drag. Events synthesised by page script are ignored, so a
  page cannot decide what the extension fetches.

• The worker will not fetch a private address on behalf of a public page — no localhost, no
  192.168.x.x, no link-local metadata. This is the browser's own Private Network Access rule,
  applied to a fetch that happens outside the page and would not otherwise be subject to it.

No other host is contacted, there is no server belonging to this extension, and nothing about
the pages a reader visits is stored unless they clip a sentence from one.
```

Each claim above is enforced by a test rather than by intention; `CLAUDE.md`'s invariants table
names the file for each. If one is ever relaxed, this text has to change with it.

### Remote code

Answer **No** — *"I am not using remote code."* Everything executable is bundled into
`content.js` and `background.js` at build time by esbuild, Preact and DOMPurify included. The
extension fetches the HTML of a page the reader dragged a link to, which is **data it parses and
renders as text**, not code it executes: it goes through Readability and then DOMPurify, and the
result is inserted as sanitized markup into a shadow root. Framed pages are shown in an
`<iframe>`, where the page runs in its own origin under the browser's normal rules, exactly as it
would in a tab.

### Data usage

**Not "no collection."** Chrome's own user-data FAQ is explicit that local-only counts:
*"Extensions are required to disclose how they handle user data, even when data is processed or
stored locally on a user's device and is not transmitted to external servers or third parties"* —
"handle" is defined there as *"collecting, transmitting, using, or sharing user data."*

Check:

- **Website content and resources** — the sentence text and hyperlinks Piko reads to extract an
  article and find sentence boundaries.
- **Web history** — the URL and title of the page a clipping came from, and the page the reader
  was on when they dragged the link, both held in the journal.

For each, the honest answer to the dashboard's own follow-up questions is: collected, yes; kept
in `chrome.storage.local`; never transferred off the device. Then check all three certifications,
which hold regardless of what's checked above — they are about *sharing* and *use*, not about
local storage:

- I do not sell or transfer user data to third parties, outside the approved use cases. ✅
- I do not use or transfer user data for purposes unrelated to my item's single purpose. ✅
- I do not use or transfer user data to determine creditworthiness or for lending. ✅

…and the final *"I certify that the above disclosures are accurate"* box.

**Confirm the two category names and their follow-up questions against the live dashboard before
submitting.** They're taken from Chrome's user-data FAQ
(<https://developer.chrome.com/docs/webstore/program-policies/user-data-faq>), fetched and read
for this doc rather than recalled, but that page describes the policy in prose — it is not a
screenshot of the form, and the dashboard may phrase the same categories differently.

If a future version ever syncs the journal (`chrome.storage.sync` would be enough to count), the
"never transferred off the device" half of the answer flips, and this note is where to start.

### Privacy policy URL

```
https://github.com/seanaujong/piko/blob/main/PRIVACY.md
```

Live, and it has to stay that way — the dashboard rejects a policy URL it cannot fetch, and it
re-checks on later submissions rather than only the first. Making the repository private takes
the listing's privacy policy down with it.

## Support contact

Set at the **account** level in the dashboard, not per item — so it is whatever hi-chu's listing
uses, and it appears on Piko's store page too. Sean's call: shared with hi-chu, not a dedicated
address for Piko.

## Instructions for reviewers (test instructions)

Piko shows nothing on install until access is granted and a gesture is made, so a reviewer who
only clicks around will conclude it does nothing. **Step 1 is not optional** — without the grant
Piko is inert by design, and a reviewer who skips it will find a broken extension and say so.

The field itself caps at 500 characters, which is why this is the drag path only — the toolbar
icon's alternate entry point and the journal's export button are real, but a reviewer who has
seen one sentence highlighted and kept has already seen the mechanism that carries them too.

```
Piko does nothing until host access is granted — start at step 1, or it looks broken.

1. Press "Allow Piko on all sites" and confirm Chrome's prompt.
2. Open an article, e.g. https://en.wikipedia.org/wiki/Photosynthesis
3. Drag a hyperlink a short distance and release — it opens in a panel, in reader mode.
4. Hover a sentence to highlight it; click to save it to the journal.

No login or payment needed.
```

## Assets checklist

- [x] Package zip — `npm run package` → `piko-<version>.zip`
- [x] Store icon 128×128 — `npm run icons:store` (`scripts/store-icon.mjs`), written to
      `store-assets/store-icon-128.png`. Not `public/icons/icon128.png`, which is the toolbar
      icon and runs edge to edge — the store drops its tile into its own rounded frame, so this
      instead rasterizes the same SVG at 96×96 and pads it into a transparent 128×128 canvas.
- [ ] Screenshots — `npm run shots:store` (`shots/store.shots.ts`) writes 1280×800, no alpha, to
      `store-assets/screenshots/`, gitignored rather than committed: nothing in the repo links to
      them, so unlike the icon there is nothing they need a stable URL for, and they are cheap to
      regenerate. Run it fresh before each submission and look before uploading — the three it
      produces are a link mid-drag with the panel open over the page, a sentence highlighted
      under the cursor, and the journal with two sources and its chip row.
- [ ] Small promo tile 440×280 — optional
- [x] Privacy policy URL live — confirmed serving (HTTP 200) at the URL below

## After submission

A new item with broad host permissions is the slow path; expect longer than a routine update.
Bump both versions with `npm run release-bump` for each resubmission — the store rejects an
upload whose version is not higher than the last one it accepted.
