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
Piko — drag a link, read it in place
```

**Summary** (≤ 132 chars)

```
Drag a hyperlink to read the article in place, and keep the sentences worth keeping in a journal.
```

**Category:** `Productivity`
**Language:** `English`

**Description**

```
Piko is for link-dense reading — the article with forty interesting links in it, where
following one means losing the page you were on and following all forty means forty tabs
you never come back to.

Drag a hyperlink. The article opens over the page you are already reading, in reader
mode, and closes with Escape. Nothing about where you were changes.

Or press the toolbar icon, and the page you are already on becomes clippable with the
journal docked beside it.

On either one, hovering a sentence lights it up and clicking keeps it. Clipped sentences
go to a journal that persists across reloads, grouped by the page they came from and by
the sitting you were in, searchable, and narrowed by span of time. Every clipping links
back to the exact sentence on the page it came from — not to the top of the article.

When you want it elsewhere, one button exports the whole journal as a Markdown file: one
section per source, a quote per clipping, and each quote linked to its own sentence. It
drops straight into an Obsidian vault or any folder of Markdown notes.

Piko's bet is engagement, not summarisation. A summariser exists so you don't have to
read; every gesture here costs almost nothing to perform and still requires you to look.
That is why there is no AI in it: a generated summary and a generated recall question both
replace the reading rather than provoke it.

Free and open source (MIT). No account, no analytics, no servers, and no data collected.
```

## Privacy practices

These map onto the **Privacy practices** tab. Piko requests one API permission (`storage`) and
broad host access, so there are two justification boxes to fill rather than hi-chu's one. Fill
them in order.

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
```

### Host permission justification — all sites

The honest version of why this cannot be `activeTab`, which is the first question a reviewer
will have.

```
Piko is a drag gesture on a hyperlink, so it has to already be listening on whatever page the
reader is on when they perform it. activeTab grants access only after the user clicks the
extension's icon, which is one click too late — by then the drag has happened and been missed.
There is also no way to know in advance which sites a reader will use it on, and a fixed list
would simply not work anywhere else.

Two capabilities need the access:

• The content script reads the text of the current page to find sentence boundaries, draw the
  highlight under the sentence being hovered, and record the one that is clicked. It also
  renders the reading panel. All of this stays in the page.

• The background service worker fetches the URL of a dragged link, so the article can be shown
  in place. This is the same page the browser would load if the link were clicked, requested
  from the extension rather than the page, and it carries no cookies or credentials for that
  site. Its response headers are also the only way to learn whether the page permits being
  framed, which a page-context fetch cannot read at all.

No other host is contacted, there is no server belonging to this extension, and nothing about
the pages a reader visits is stored unless they clip a sentence from one.
```

### Remote code

Answer **No** — *"I am not using remote code."* Everything executable is bundled into
`content.js` and `background.js` at build time by esbuild, Preact and DOMPurify included. The
extension fetches the HTML of a page the reader dragged a link to, which is **data it parses and
renders as text**, not code it executes: it goes through Readability and then DOMPurify, and the
result is inserted as sanitized markup into a shadow root. Framed pages are shown in an
`<iframe>`, where the page runs in its own origin under the browser's normal rules, exactly as it
would in a tab.

### Data usage

Disclose **no** collection — leave every category unchecked. "Collect" in the dashboard's terms
means transferring data off the user's device, and Piko transfers nothing anywhere: the journal
is written to local extension storage, and the only network request is for the page the reader
asked to read. Then check all three certifications:

- I do not sell or transfer user data to third parties, outside the approved use cases. ✅
- I do not use or transfer user data for purposes unrelated to my item's single purpose. ✅
- I do not use or transfer user data to determine creditworthiness or for lending. ✅

…and the final *"I certify that the above disclosures are accurate"* box.

Note for whoever fills this in: the journal does hold page text and URLs, which *are* the
"website content" and "web history" categories by name. Those boxes describe **collection**,
which is transmission off the device — and there is none. If a future version ever syncs the
journal (`chrome.storage.sync` would be enough to count), this answer changes and this note is
where to start.

### Privacy policy URL

```
https://github.com/seanaujong/piko/blob/main/PRIVACY.md
```

Live, and it has to stay that way — the dashboard rejects a policy URL it cannot fetch, and it
re-checks on later submissions rather than only the first. Making the repository private takes
the listing's privacy policy down with it.

## Support contact

Set at the **account** level in the dashboard, not per item — which means it is currently
whatever hi-chu's listing uses, and would appear on Piko's store page as well. Decide before
submitting whether that address should serve both extensions or whether Piko wants its own.

## Instructions for reviewers (test instructions)

Piko shows nothing on install until a gesture is made, so a reviewer who only clicks around will
conclude it does nothing. Give them the trigger explicitly.

```
Piko does nothing until you drag a link or press its toolbar icon — there is no popup and no
options page. No account, login, or payment is needed. To see it work:

1. Install the extension, then open any article with links in it — for example
   https://en.wikipedia.org/wiki/Photosynthesis
2. DRAG any hyperlink in the text a short distance and let go. That linked article opens in a
   panel over the page, in reader mode. Press Escape to close it.
3. HOVER a sentence in that panel — it highlights. CLICK it, and it is saved to the journal in
   the column on the right.
4. Alternatively, press Piko's toolbar icon on any article. The journal docks to the right of
   the page and the page itself becomes clippable in the same way.
5. In the journal, the download button exports everything as a Markdown file, and each entry's
   link reopens the source page at that exact sentence.

Everything runs locally. The only network request is for the page whose link was dragged — the
same page the browser would load had the link been clicked. Nothing is collected or transmitted.
```

## Assets checklist

- [x] Package zip — `npm run package` → `piko-<version>.zip`
- [ ] Store icon 128×128 — needs its own frame, NOT `public/icons/icon128.png`, which is the
      toolbar icon and runs edge to edge. The store drops its tile into a rounded frame, so the
      artwork wants to sit at 96×96 with 16px of transparent padding per side, and the
      transparency has to survive the export.
- [ ] Screenshots — 1280×800 (or 640×400), 1–5. The obvious three: a link mid-drag with the
      panel open over the page, a sentence highlighted under the cursor, and the journal with
      several sources and its chip row.
- [ ] Small promo tile 440×280 — optional
- [ ] Privacy policy URL live — push `PRIVACY.md` first

## After submission

A new item with broad host permissions is the slow path; expect longer than a routine update.
Bump both versions with `npm run release-bump` for each resubmission — the store rejects an
upload whose version is not higher than the last one it accepted.
