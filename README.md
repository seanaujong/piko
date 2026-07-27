# Piko

Drag a link, read it in place. Piko is a small Chrome extension for link-dense pages —
instead of opening a tab you'll never come back to, drag the hyperlink and the article
opens over the page you're already on.

- Drag a link → the article appears in a panel, in reader mode
- Or click the toolbar icon → the page you're already on becomes clippable
- Hover a sentence → it lights up
- Click it → it's clipped to a journal that persists across reloads
- Export the journal → one Markdown file, ready to drop into an Obsidian vault, where each
  quote links back to the exact sentence on the page it came from

**Piko's bet is engagement, not summarisation.** A summariser exists so you don't have to
read; every Piko feature is meant to be a gesture that costs almost nothing to perform but
still requires you to actually look. The test any new feature has to pass: *does this
increase the reader's engagement, or perform it on their behalf?* That's why there's no
model in here — a generated summary or a generated recall question both replace the
reading rather than provoke it.

## How it's built

A **pure core behind a thin shell**, with one extra wrinkle a normal web app doesn't have:
the shell is split across two *processes*. A content script can't read HTTP response
headers, so deciding whether a page may be framed has to happen in the background service
worker, and the two halves talk over a discriminated union of messages. Everything
interesting between them is pure — the reducer that decides what to show, the text
segmentation, the line geometry, the clippings projections.

```
┌─────────────────────────────────────────────────────────────────────┐
│ content/index.ts                           the shell (impure) · DOM │
│ Two ways in: a hyperlink dragged out of the page, or the            │
│ toolbar icon on the page you are already reading. Folds             │
│ events into PreviewState and renders the result — it                │
│ decides nothing itself; every choice is the reducer's.              │
└─────────────────────────────────────────────────────────────────────┘
                                   │ a drag: CHECK_FRAMEABILITY ── shared/messages.ts, the seam
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ background/frameability.ts                         impure · network │
│ The ONLY place that can read X-Frame-Options and                    │
│ frame-ancestors — a page-context fetch() cannot see                 │
│ response headers at all, whatever its CORS mode.                    │
│ Returns the html either way, so a later fallback to                 │
│ reader mode costs no second round-trip.                             │
└─────────────────────────────────────────────────────────────────────┘
                                   │ FRAME_OK | FRAME_BLOCKED | UNSUPPORTED_CONTENT | FETCH_ERROR
                                   ▼
───────────────── the core — REDUCE → DERIVE → RENDER ─────────────────
┌─────────────────────────────────────────────────────────────────────┐
│ state/previewState.ts                            pure · the reducer │
│ transition(state, event) → state. Owns reader-vs-framed             │
│ and every fallback: blocked, timed out, unextractable.              │
│ PreviewState/PreviewEvent are discriminated unions, so              │
│ an unhandled case fails the typecheck, not the user.                │
└─────────────────────────────────────────────────────────────────────┘
                                   │ resolving 'ready' extracts, synchronously
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ extraction/extract.ts                                          pure │
│ Readability + DOMPurify, inlined into the reducer because           │
│ it is synchronous work over html already fetched.                   │
│ html → ExtractedArticle (textContent + safe HTML)                   │
└─────────────────────────────────────────────────────────────────────┘
──────────────────── two surfaces, one hit-tester ─────────────────────
┌───────────────────────────────┐     ┌───────────────────────────────┐
│ panel/views/*                 │     │ panel/hostClipping.ts         │
│ the dragged article, in       │     │ the page itself — skips all   │
│ the panel's own scrolling     │     │ of the above; nothing was     │
│ container                     │     │ fetched and nothing framed    │
└───────────────────────────────┘     └───────────────────────────────┘
                └──────────────────┬──────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ panel/highlight.ts + extraction/sentences.ts                   pure │
│ attachSentenceHighlight paints bands into an overlay;               │
│ sentencesIn · lineBandsFor · sentenceAtPoint decide where           │
│ a sentence is. The surfaces differ by three options, not            │
│ by a second definition of what a sentence is.                       │
└─────────────────────────────────────────────────────────────────────┘
                                   │ a click clips the sentence under it
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ state/clippings.ts                              pure core + storage │
│ createClippingsStore → chrome.storage.local                         │
│ sessionsOf · sourcesInSessionOrder · visibleClippings               │
│ Every projection is derived at point of use, not stored.            │
└─────────────────────────────────────────────────────────────────────┘
```

Every rule that holds this shape together is argued in the docblocks of the file that owns
it — why bands come from measured lines, why frameability can only be answered in the worker,
why one row refuses a redraw. `CLAUDE.md` carries the index of those rules, a line each, naming
the file with the argument and the test that fails when it breaks, and doubles as the
contributor's workflow map: how to build, how to verify in a real browser, and where to make a
change.

## Develop

```sh
npm install
npm run check       # the gate: typecheck + tests
npm test            # Vitest alone
npm run build       # esbuild → dist/ (content.js + background.js + manifest + icons)
npm run icons       # re-rasterize public/icons/icon.svg at 16/32/48/128
```

Three suites, split by what each needs. The pure layers — the reducer, the segmenter, the
clippings projections — run under jsdom, beside the modules they cover. Highlight *geometry*
runs in real Chrome, because it measures client rects and jsdom reports every rect as zero,
which would make those assertions pass while proving nothing. And `e2e/` drives the actually
loaded extension against local fixture pages, covering the manifest, the background worker
and `chrome.storage` — it rebuilds `dist/` first, so it always tests the shipped bundle.

What still rests on a human: clipboard writes, whether the browser honours a scroll-to-text
link, and whether anything *looks* right. `CLAUDE.md` marks which rules fall where, and
`e2e/MANUAL.md` is the procedure for checking them by hand.

## Install

From source, which is currently the only way:

1. `npm install && npm run build`
2. Visit `chrome://extensions`, enable **Developer mode** (top-right).
3. **Load unpacked** → select `dist/`.
4. Piko opens its onboarding page. Press **Allow Piko on all sites** and confirm — nothing works
   until you do, by design. That page is also Piko's options page: right-click the toolbar icon
   and choose **Options** to read it again.
5. Open any link-dense page and drag a hyperlink.

After any later rebuild you must click the reload icon on Piko's card at
`chrome://extensions` **and** refresh the tabs you're testing in — an already-open tab
keeps running the old content script, and it can't talk to the reloaded extension.

## Permissions

**Installing Piko grants it nothing.** The manifest declares `storage` and `scripting` — neither
of which mentions your browsing — and asks for host access *optionally*, at runtime. After
install, Piko opens a page explaining what the access is for; until you press the button there
and confirm, Piko is inert on every site.

Once granted, that access is `<all_urls>`, because the gesture is dragging a link on whatever
page you are already reading and there is no way to know in advance which pages those are. If you
would rather grant particular sites, `chrome://extensions` will do that instead.

There is no analytics, no account, and no network call to anywhere but the page you dragged.

Access that broad is worth saying more about than which permission it is:

- **Piko does not run on webmail, password managers, chat, or sign-in pages.** The list is
  `src/shared/sensitiveHosts.ts`, the manifest's `exclude_matches` is asserted against it, and
  the background worker refuses to fetch those hosts too. Banking is deliberately *not* on the
  list — it cannot be enumerated, and a partial list would claim more than it delivers.
- **A preview starts only from a real drag.** An event synthesised by page script is ignored, so
  a page cannot decide what Piko fetches.
- **The fetch carries no cookies and no referrer**, and it will not reach an address on your own
  network — a public page cannot use Piko to read your router, your intranet or your localhost.
- **Nothing is read from a page until you ask.** Piko notices a drag and a toolbar click; it
  looks at the text only once one of those has happened, and stores only what you clip.
