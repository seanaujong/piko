# CLAUDE.md — Piko

## At a glance
A Chrome MV3 extension: drag a hyperlink and the article opens in place, in reader mode,
where hovering a sentence highlights it and clicking clips it to a persistent journal.

**The filter for any new feature** is engagement, not summarisation: *does this increase
the reader's engagement, or perform it on their behalf?* This is the rule that keeps
rejecting the obvious AI features — a generated summary or a generated recall question
both look active and both replace the reading. Apply it before building, not after.

This file is the workflow map: how to build, how to verify, where to make a change.
`README.md` has the architecture diagram and the layering prose.

## Build, run, verify
```sh
npm install
npm run check       # THE GATE: typecheck + tests. Run before every commit.
npm test            # Vitest alone. The authority — assert against a real run, don't mental-math.
npm run build       # esbuild → dist/
npm run icons       # only after editing public/icons/icon.svg
```

**Two suites, split by what they need.** `npm test` runs both.

- **`unit`** — `*.test.ts` under jsdom, colocated beside each module. Enough DOM for
  `DOMParser`, `textContent` and `Range`, which is all the pure layers touch. Covers the
  whole `transition` reducer including every fallback and stale-event branch, sentence
  segmentation, the clippings projections, and URL formatting.
- **`geometry`** — `*.browser.test.ts` in real Chrome via Playwright, because it measures
  *layout*. jsdom reports every client rect as zero, so these assertions would pass there
  while proving nothing — which is precisely how the band bugs survived as long as they did.
  Chrome runs through `channel: 'chrome'`, so no browser is downloaded; if the run reports a
  missing executable, that config was lost, not that you need `playwright install`.

**Still on eyes only:** clipboard writes and text-fragment activation. Neither is reachable
from automation (see the traps below), so test the *payload* — `toMarkdown`,
`textFragmentUrl` — and leave the browser's half to a human.

**When adding an invariant, watch its test fail before trusting it.** Revert the fix, see
red, restore. This is not ceremony: the first version of "extent comes from the band, not
the sentence" used bold-vs-plain text, which Chrome reports at the *same* rect top — so it
passed with the bug reintroduced and was protecting nothing. A font-size contrast was what
made it real. Every ✅ below has been watched failing.

## Verifying a change in Chrome
The real surface is a drag on a live page, and nothing about it is automated. Budget for
this loop and know its traps — each one below has already cost an hour once.

**Every cycle:** `npm run build` → click reload on Piko's card at `chrome://extensions` →
**refresh the test tab.** Skipping the refresh leaves an orphaned content script whose
`chrome.runtime` is dead; a retry won't recover it, only a real refresh will. Piko fails
loudly here ("Piko was updated — refresh this page") rather than hanging, so if you see
that message, this is why.

**Driving it with browser automation** (Claude-in-Chrome and similar):

- **Don't use `left_click_drag` — dispatch the drag events.** The mouse-drag automation is
  unreliable at firing `dragend` (three consecutive failures on one run). `startDragTracking`
  never checks `isTrusted`, so a synthetic pair drives the real flow every time:
  `a.dispatchEvent(new DragEvent('dragstart', {bubbles: true}))` then the same with
  `'dragend'`. This is the harness to reach for first, not a fallback.
- **Never `navigator.clipboard.readText()` to verify a copy landed.** It raises a permission
  prompt that freezes the renderer — a CDP call timed out at 45s this way. `copyText` is
  fire-and-forget by design, so a clipboard write can only be confirmed by a human pasting.
- **Scroll-to-text fragments can't be verified from automation.** Navigating to a
  `#:~:text=` URL through CDP does not activate the directive — the page loads at the top
  with nothing highlighted, even for text that is verbatim on the page, because the
  directive needs a browser- or user-initiated navigation. Clicking an injected anchor
  didn't navigate at all. Verify the URL *construction* by running `textFragmentUrl` under
  Node (`npx esbuild <file> --format=cjs`, then require it) and assert on the decoded
  output; leave activation to a human click.
- **A synthetic scroll wheel over the panel scrolls the host page, not the preview.** The
  wheel event doesn't route into the shadow tree. This looks exactly like a broken scroll
  container and is not one: `.piko-content` is the real scroll owner. Drive it with
  `content.scrollTop = …` or `el.scrollIntoView()` inside the shadow root. Do not conclude
  from this that human scrolling is broken — that has never been shown.
- **A blank-looking reader pane is usually a large lead image still loading**, not failed
  extraction. Check `.piko-article`'s `textContent.length` before believing a screenshot.
- Everything lives in one open shadow root on a `<div>` appended to `document.documentElement`
  — reach it with `[...document.documentElement.children].find(e => e.shadowRoot).shadowRoot`.
- Don't trigger `alert`/`confirm`; a modal dialog freezes the automation channel.

**What a full manual pass covers,** in the order that finds bugs fastest: drag a link →
reader mode renders → hover a sentence (bands tile the lines, no double-painting over
links) → click it (mark persists, pane count increments) → clip from a second page (the
source filter chips only appear at two or more sources) → toggle Live page and back (marks
re-paint from a text match) → scroll (marks travel) → reload the tab (`chrome.storage.local`
restores). Session dividers need two clippings more than 45 minutes apart, so they don't
show up in a normal pass; lower `SESSION_GAP_MS` temporarily rather than faking a stored
timestamp.

## Where to make a change
Layering and dependency direction are in `README.md`'s diagram. Practically:

| If you're changing… | Start in |
|---|---|
| what the preview decides to show, or any fallback | `content/state/previewState.ts` — the whole state machine |
| the drag gesture itself | `content/dragTracking.ts` |
| whether a page can be framed | `background/frameability.ts` (**not** the content script — see below) |
| the message contract between the two | `shared/messages.ts`, then the `switch` in `background/index.ts` |
| what the panel looks like | `content/panel/views/*` + `panel/styles.ts` |
| sentence boundaries or highlight geometry | `content/extraction/sentences.ts` |
| the clippings journal or its projections | `content/state/clippings.ts` |

The panel's `.piko-body` is a flex row deliberately built to take a second child; that's
where the clippings pane lives, and where another pane would go.

## Conventions & invariants
Tagged by how each is enforced: **✅ machine-checked** (a type or test fails the build),
**👁 review-only** (nothing catches a violation — a human must). Shrinking the 👁 count is
the point. What remains is layering and browser-boundary behaviour: rules about *where* code
belongs, which a test can't express, and effects that leave the page entirely.

- ✅ **Rules live in the reducer, events stay mechanical.** If `transition()` grows a
  branch that encodes a *policy*, that's right; if an event's handling grows rule-based
  `if`s scattered elsewhere, the logic is in the wrong layer. `content/index.ts` folds and
  renders — it decides nothing. `previewState.test.ts` pins every branch, including the
  stale-event refusals and the manual toggle's free round trip.
- ✅ **`PreviewState` and `PreviewEvent` are discriminated unions** and `transition`'s
  `switch` is exhaustive. Adding a variant without handling it fails `npm run typecheck`.
  Keep it that way; don't add a `default:` case.
- 👁 **The frameability check belongs in the background worker.** A page-context `fetch()`
  cannot read `X-Frame-Options` or `frame-ancestors` regardless of CORS mode. This looks
  like an easy simplification into the content script and is not one.
- 👁 **Never mutate article text to highlight it.** No wrapping in `<span>`s — paint an
  overlay. Rewriting the DOM breaks the extraction the content came from.
- ✅ **Highlight bands come from the block's measured line structure, never a line-height
  grid and never the rects of the sentence being drawn.** Spacing inside one paragraph is
  not uniform (measured heights `26.4, 25.6, 37.4, 37, 28.9` on a single paragraph), and
  bold/superscript rects differ enough to shift a band by ~4px. `lineBandsFor` measures
  real lines and puts boundaries at gap midpoints so bands tile by construction.
  `sentences.browser.test.ts` asserts a zero seam between every pair of adjacent bands,
  including on a deliberately non-uniform paragraph; watched failing at 6px and 8px gaps.
- ✅ **Merge client rects by visual line before painting.** `Range.getClientRects()`
  emits overlapping duplicates over inline markup — one measured sentence gave 11 raw
  rects with 6 overlapping — which paints as a dark patch on every link. Use
  `lineRectsForSentence`, never raw rects — the browser suite asserts one rect per line and
  no overlap between them.
- 👁 **Hit-test with `root.elementFromPoint()` on the shadow root, then rect containment.**
  `ShadowRoot` has no `caretRangeFromPoint`, and the document's version doesn't pierce the
  boundary — it returns the host's ancestor. Do not reintroduce a caret-based lookup.
- ✅ **Don't regex-split sentences on `.`** `Intl.Segmenter` handles `U.S.`/`Fig. 2`/`3.5`
  correctly; it also splits `.[15]` in two, which `sentencesIn` fixes by walking a
  bracket-depth array and pushing boundaries past a citation run. Both halves matter, and
  `sentences.test.ts` covers both — watched failing as `knowledge.[` + `15] However`.
- 👁 **Keep any clipboard write synchronous inside a real click handler, in the content
  script.** An `await` before it, or routing through the service worker, loses transient
  activation. `navigator.clipboard` is unavailable on `http://` pages (secure-context) —
  feature-detect `window.isSecureContext` and fall back to `document.execCommand('copy')`.
- 👁 **Don't add the `clipboardWrite` permission.** On a real click over HTTPS it buys
  nothing you don't already have, and costs a user-facing install warning.
- 👁 **`:host(:hover)`, never `:host:hover`** — the bare-chained form silently never
  matches in shadow-DOM CSS.
- ✅ **No backticks inside `styles.ts`'s CSS comments.** The whole stylesheet is one
  template literal, so quoting a property name the way you would in prose terminates the
  string and reports `TS1005: ',' expected` at a line far from the actual mistake. Name
  properties in plain words instead.
- ✅ **Derive projections, don't store them.** Source tallies, visible sets, and session
  gaps are computed at point of use in `clippings.ts`. Caching them on state is how
  staleness bugs get in.

## Pointers
- `README.md` — architecture diagram, layering, install, permissions.
- **Before starting, check `.claude/handoffs/TODO.md`** — the living handoff carrying
  current status, next step, and the decisions-and-rejected-alternatives log (why there's
  no LLM, why the name, what's been measured and shelved). It is local and gitignored, so
  a fresh clone won't have it; don't rely on it existing.
- Chrome MV3 docs are the authority on permission warnings and clipboard rules — check a
  permission's user-facing install warning before adopting it. That check is what ruled
  out `clipboardWrite`.
