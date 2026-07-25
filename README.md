# Piko

Drag a link, read it in place. Piko is a small Chrome extension for link-dense pages —
instead of opening a tab you'll never come back to, drag the hyperlink and the article
opens over the page you're already on.

- Drag a link → the article appears in a panel, in reader mode
- Or click the toolbar icon → the page you're already on becomes clippable
- Hover a sentence → it lights up
- Click it → it's clipped to a journal that persists across reloads

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
│ holds PreviewState; wires drag → dispatch → render.                 │
│ Decides nothing itself — every choice is the reducer's.             │
└─────────────────────────────────────────────────────────────────────┘
                                   │  CHECK_FRAMEABILITY  ── shared/messages.ts, the seam
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ background/frameability.ts                         impure · network │
│ The ONLY place that can read X-Frame-Options and                    │
│ frame-ancestors — a page-context fetch() cannot see                 │
│ response headers at all, whatever its CORS mode.                    │
│ Returns the html either way, so a later fallback to                 │
│ reader mode costs no second round-trip.                             │
└─────────────────────────────────────────────────────────────────────┘
                                   │  FRAME_OK | FRAME_BLOCKED | UNSUPPORTED_CONTENT | FETCH_ERROR
                                   ▼
───────────────── the core — REDUCE → DERIVE → RENDER ─────────────────
┌─────────────────────────────────────────────────────────────────────┐
│ state/previewState.ts                            pure · the reducer │
│ transition(state, event) → state. Owns reader-vs-framed             │
│ and every fallback: blocked, timed out, unextractable.              │
│ PreviewState/PreviewEvent are discriminated unions, so              │
│ an unhandled case fails the typecheck, not the user.                │
└─────────────────────────────────────────────────────────────────────┘
                                   │  resolving 'ready' runs both, synchronously
                                   ▼
┌───────────────────────────────┐     ┌───────────────────────────────┐
│ extraction/extract.ts         │     │ extraction/sentences.ts       │
│ Readability + DOMPurify       │     │ segmentation + line geometry  │
│ html → ExtractedArticle       │     │ sentencesIn · lineBandsFor    │
│ (textContent + safe HTML)     │     │ sentenceAtPoint               │
└───────────────────────────────┘     └───────────────────────────────┘
                                   │  ExtractedArticle + the sentence index
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ panel/views/*                                    shell · shadow DOM │
│ loadingView · framedView · extractedView · errorView                │
│ clippingsPane — chronological, source-filtered                      │
│ One shadow root; the host page's CSS can't reach in.                │
└─────────────────────────────────────────────────────────────────────┘
                                   │  a click over extracted content clips the sentence under it
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ state/clippings.ts                              pure core + storage │
│ createClippingsStore → chrome.storage.local                         │
│ tallyBySource · visibleClippings · gapBefore · toMarkdown           │
│ Every projection is derived at point of use, not stored.            │
└─────────────────────────────────────────────────────────────────────┘
```

Two things that fall out of this shape and are worth stating plainly:

**One hit-tester, two surfaces.** Clipping a preview and clipping the live page run the same
code with three options flipped: where pointer events come from (the host overlay is
click-through, so they come from the document), whether marks repaint on scroll (a fixed
overlay doesn't travel with the page), and whether the click is swallowed (a sentence on a
real page is often inside a link). There is no second definition of what a sentence is.

**Reader mode is the default; framing is the fallback.** Sentence highlighting only works
over content Piko itself extracted — a framed page is a cross-origin iframe whose DOM is
unreadable, so there is nothing to hit-test. Defaulting to the frame would have hidden the
whole clipping feature behind a toggle. Framing survives as the escape hatch for pages
Readability can't make sense of.

**No text is ever mutated to highlight it.** Wrapping sentences in `<span>`s would rewrite
the article's DOM and break the extraction it came from. Instead a separate overlay layer
paints translucent bands positioned from the block's *measured* line structure. Line
spacing inside a paragraph is not uniform — an inline image or a large-font span shifts it
by a dozen pixels — so the bands are derived from real line rects, never from a
`line-height` lattice.

For exact shapes and signatures, read the source: `previewState.ts` is the whole state
machine in one file, and `sentences.ts` carries the segmentation and geometry rules in
comments next to the code they constrain. `CLAUDE.md` is the contributor's orientation map
— how to build, how to verify a change in a real browser, and where to make one.

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

What still rests on a human: clipboard writes and whether the browser honours a
scroll-to-text link. Their payloads are tested; only the browser's half isn't.
`CLAUDE.md` marks exactly which rules fall where.

## Install

From source, which is currently the only way:

1. `npm install && npm run build`
2. Visit `chrome://extensions`, enable **Developer mode** (top-right).
3. **Load unpacked** → select `dist/`.
4. Open any link-dense page and drag a hyperlink.

After any later rebuild you must click the reload icon on Piko's card at
`chrome://extensions` **and** refresh the tabs you're testing in — an already-open tab
keeps running the old content script, and it can't talk to the reloaded extension.

## Permissions

`storage` (the clippings journal, kept in `chrome.storage.local` — nothing leaves your
machine) and `<all_urls>` host access, which is what lets the background worker fetch a
dragged link to check whether it can be framed. There is no analytics, no account, and no
network call to anywhere but the page you dragged.
