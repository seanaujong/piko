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
npm run typecheck   # tsc --noEmit — the only automatic gate that exists today
npm run build       # esbuild → dist/
npm run icons       # only after editing public/icons/icon.svg
```

**There is no test suite.** `npm run typecheck` is the entire machine-checked gate, which
is why almost every invariant below is tagged 👁. Treat adding the first tests as ordinary
work rather than a project: `sentences.ts` is pure (text in, sentences/bands out) and its
rules are already written down as measured numbers — they just need pinning.

## Verifying a change in Chrome
The real surface is a drag on a live page, and nothing about it is automated. Budget for
this loop and know its traps — each one below has already cost an hour once.

**Every cycle:** `npm run build` → click reload on Piko's card at `chrome://extensions` →
**refresh the test tab.** Skipping the refresh leaves an orphaned content script whose
`chrome.runtime` is dead; a retry won't recover it, only a real refresh will. Piko fails
loudly here ("Piko was updated — refresh this page") rather than hanging, so if you see
that message, this is why.

**Driving it with browser automation** (Claude-in-Chrome and similar):

- `left_click_drag` fires the `dragend` flow **roughly one attempt in two**. A single
  non-trigger is not a regression — retry, or retry on a different link. If you need to
  force the panel open regardless, remove the host element's `data-hidden` attribute.
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
**👁 review-only** (nothing catches a violation — a human must). The 👁 count is high
because there is no test suite; shrinking it is the point.

- 👁 **Rules live in the reducer, events stay mechanical.** If `transition()` grows a
  branch that encodes a *policy*, that's right; if an event's handling grows rule-based
  `if`s scattered elsewhere, the logic is in the wrong layer. `content/index.ts` folds and
  renders — it decides nothing.
- ✅ **`PreviewState` and `PreviewEvent` are discriminated unions** and `transition`'s
  `switch` is exhaustive. Adding a variant without handling it fails `npm run typecheck`.
  Keep it that way; don't add a `default:` case.
- 👁 **The frameability check belongs in the background worker.** A page-context `fetch()`
  cannot read `X-Frame-Options` or `frame-ancestors` regardless of CORS mode. This looks
  like an easy simplification into the content script and is not one.
- 👁 **Never mutate article text to highlight it.** No wrapping in `<span>`s — paint an
  overlay. Rewriting the DOM breaks the extraction the content came from.
- 👁 **Highlight bands come from the block's measured line structure, never a line-height
  grid and never the rects of the sentence being drawn.** Spacing inside one paragraph is
  not uniform (measured heights `26.4, 25.6, 37.4, 37, 28.9` on a single paragraph), and
  bold/superscript rects differ enough to shift a band by ~4px. `lineBandsFor` measures
  real lines and puts boundaries at gap midpoints so bands tile by construction.
- 👁 **Merge client rects by visual line before painting.** `Range.getClientRects()`
  emits overlapping duplicates over inline markup — one measured sentence gave 11 raw
  rects with 6 overlapping — which paints as a dark patch on every link. Use
  `lineRectsForSentence`, never raw rects.
- 👁 **Hit-test with `root.elementFromPoint()` on the shadow root, then rect containment.**
  `ShadowRoot` has no `caretRangeFromPoint`, and the document's version doesn't pierce the
  boundary — it returns the host's ancestor. Do not reintroduce a caret-based lookup.
- 👁 **Don't regex-split sentences on `.`** `Intl.Segmenter` handles `U.S.`/`Fig. 2`/`3.5`
  correctly; it also splits `.[15]` in two, which `sentencesIn` fixes by walking a
  bracket-depth array and pushing boundaries past a citation run. Both halves matter.
- 👁 **Keep any clipboard write synchronous inside a real click handler, in the content
  script.** An `await` before it, or routing through the service worker, loses transient
  activation. `navigator.clipboard` is unavailable on `http://` pages (secure-context) —
  feature-detect `window.isSecureContext` and fall back to `document.execCommand('copy')`.
- 👁 **Don't add the `clipboardWrite` permission.** On a real click over HTTPS it buys
  nothing you don't already have, and costs a user-facing install warning.
- 👁 **`:host(:hover)`, never `:host:hover`** — the bare-chained form silently never
  matches in shadow-DOM CSS.
- 👁 **Derive projections, don't store them.** Source tallies, visible sets, and session
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
