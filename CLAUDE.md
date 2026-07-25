# CLAUDE.md — Piko

## At a glance
A Chrome MV3 extension with two clipping surfaces over one hit-tester. **Drag a hyperlink**
and the article opens in place, in reader mode. **Click the toolbar icon** and the page you
are already on becomes clippable, with the journal docked beside it. On either surface,
hovering a sentence highlights it and clicking clips it to a persistent journal.

**The filter for any new feature** is engagement, not summarisation: *does this increase
the reader's engagement, or perform it on their behalf?* This is the rule that keeps
rejecting the obvious AI features — a generated summary or a generated recall question
both look active and both replace the reading. Apply it before building, not after.

**Where each kind of thing is written down.** This file is the workflow map — how to build, how
to verify, where to make a change — plus the *index* of the project's invariants. `README.md`
has the architecture diagram and the layering prose. The *argument* for any single rule lives in
the docblocks of the file that owns it, never here; the index below names that file for each
one, so a rule and its justification cannot drift apart.

## Build, run, verify
```sh
npm install
npm run check       # THE GATE: typecheck + tests. Run before every commit.
npm test            # Vitest alone. The authority — assert against a real run, don't mental-math.
npm run build       # esbuild → dist/
npm run icons       # only after editing public/icons/icon.svg
npm run bench       # measurements, NOT in the gate — see below
```

**`npm run bench` prints, it doesn't assert** — add `--reporter=verbose` for the tables. Three
benches over a generated 220-paragraph article, each isolating a different cost: `reading` what
a store change costs on the page, `pane` what the journal costs to draw at up to 5,000
clippings, `journal` what it costs to persist. They exist to answer design questions with
numbers rather than intuition, and have overturned two confident guesses so far. Each bench file
opens with what it measures and why that number is the interesting one; `vitest.bench.config.ts`
says why they're kept out of the gate and why the command is `vitest run` rather than
`vitest bench`.

**Three suites, split by what they need.** `npm test` runs all of them.

- **`unit`** — `*.test.ts` under jsdom, colocated beside each module. Enough DOM for
  `DOMParser`, `textContent` and `Range`, which is all the pure layers touch. Covers the
  whole `transition` reducer including every fallback and stale-event branch, sentence
  segmentation, the clippings projections, and URL formatting.
- **`geometry`** — `*.browser.test.ts` in real Chrome via Playwright, because it measures
  *layout*. jsdom reports every client rect as zero, so these assertions would pass there
  while proving nothing — which is precisely how the band bugs survived as long as they did.
  Chrome runs through `channel: 'chrome'`, so no browser is downloaded here.
- **`e2e`** — `e2e/*.test.ts`, driving the **actually-loaded extension** in Chromium against
  local fixture pages. The only suite that exercises the manifest, the background worker, the
  message round-trip and `chrome.storage`. It rebuilds `dist/` first, so it always tests the
  shipped bundle. **This replaces the manual reload-and-drag loop** — the most expensive step
  in developing this project.

Two effects reach past all three suites and stay on eyes only — see *What only a human can
guard* under Conventions & invariants.

## Verifying a change in Chrome
`npm test` now drives the loaded extension itself, so reach for the e2e suite first and keep
the manual loop for judging how something *looks*. Two launch requirements there are
non-obvious and were established by measurement, so don't "simplify" them:

- **`channel: 'chromium'`, not `channel: 'chrome'`.** Branded Chrome ignores
  `--load-extension` now; the extension never appears at all, and no `--disable-features`
  incantation brought it back.
- **Full Chromium, not the headless shell.** Plain `headless: true` resolves to
  chrome-headless-shell, which has no extension support; pairing it with `channel: 'chromium'`
  selects the complete browser in new-headless mode, which does.
- **Clipping toggles, and the profile is shared across tests.** Clear `chrome.storage` in a
  `beforeEach` through the service worker, or a test that re-clips an earlier test's sentence
  silently un-clips it and reads zero.

When you do go to the browser by hand, know its traps — each below has already cost an hour.

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
source filter chips only appear at two or more sources) → open the search field and type
(the list and the chip counts both narrow; Escape closes the search, not the preview) →
press a span marker (the row keeps only that span) → on a page you have clipped from, the
pin scope appears and its chips are outlined → toggle Live page and back (marks re-paint
from a text match) → scroll (marks travel) → reload the tab (`chrome.storage.local`
restores).

Two things a normal pass won't reach, because both need a journal older than the sitting
you are in: session dividers want two clippings more than 45 minutes apart, and the chip
row's span markers want clippings in different spans — a fresh journal is all one span and
renders a single `Today`. Lower `SESSION_GAP_MS` temporarily rather than faking a stored
timestamp; for the spans there is no such dial, so trust `clippings.test.ts` and check the
look rather than the logic.

## Where to make a change
Layering and dependency direction are in `README.md`'s diagram. Practically:

| If you're changing… | Start in |
|---|---|
| what the preview decides to show, or any fallback | `content/state/previewState.ts` — the whole state machine |
| the drag gesture itself | `content/dragTracking.ts` |
| whether a page can be framed | `background/frameability.ts` (**not** the content script — its header says why) |
| the message contract between the two | `shared/messages.ts`, then the `switch` in `background/index.ts` |
| what the panel looks like | `content/panel/views/*` + `content/panel/styles.ts` |
| the clippings pane's markup or behaviour | `content/panel/views/clippingsPane.tsx` — the one Preact component |
| clipping the live page | `content/panel/hostClipping.ts` |
| what the toolbar icon does | `background/index.ts` sends, `content/index.ts` receives |
| sentence boundaries or highlight geometry | `content/extraction/sentences.ts` |
| the clippings journal or its projections | `content/state/clippings.ts` |
| what narrows the journal (source, query, span) | `JournalFilters` + `visibleClippings` in `clippings.ts` |

The panel's `.piko-body` is a flex row deliberately built to take a second child; that's
where the clippings pane lives, and where another pane would go.

**One Preact component, not a framework.** `clippingsPane.tsx` is the only view Preact renders;
`loadingView`, `framedView`, `extractedView` and `errorView` are plain DOM builders and there is
no plan to convert them. What the pane earned it with is in its own docblocks and in `README.md`.
Before reaching for it in a *new* view, ask what state a node is carrying that a rebuild would
lose — if the answer is none, plain DOM is the cheaper boundary.

Mechanically there is nothing to set up: JSX is configured in `tsconfig.json` (`jsx: react-jsx`,
`jsxImportSource: preact`) and mirrored in `esbuild.config.mjs`, so a new `.tsx` file just works.
`preact` is a runtime dependency and ships inside `content.js`.

## Conventions & invariants — don't break these
An **index**, not the argument. Each rule is stated once with its enforcement level, the file
whose docblocks own the *reasoning* — why it exists, what it cost to learn, what it deliberately
doesn't cover — and what fails the build when it's violated. Follow the "reasoning owned by"
column before changing one of these; the argument lives next to the code it governs, so a rule
and its justification can't drift apart. Run every machine check at once with `npm run check`.

**Reading the tag.** ✅ machine-checked — a test or the typechecker fails the build.
👁 review-only — nothing catches a violation, so a human holds the line. Shrinking the 👁 count
is the point; what's left is layering (rules about *where* code belongs, which a test can't
express) and effects that leave the page entirely.

**The meta-rule: watch the test fail before trusting it.** Revert the fix, see red, restore.
Every ✅ below has been watched failing, and that is not ceremony — the first version of "extent
comes from the band, not the sentence" contrasted bold against plain text, which Chrome reports
at the *same* rect top. It passed with the bug reintroduced and was protecting nothing until a
font-size contrast made it real.

| Invariant | | Reasoning owned by | Checked by |
|---|---|---|---|
| Rules live in the reducer; events stay mechanical, and the content script decides nothing | ✅ | `content/state/previewState.ts`, `content/index.ts` | `previewState.test.ts` |
| `PreviewState`/`PreviewEvent` are discriminated unions and `transition`'s `switch` is exhaustive — never add a `default:` | ✅ | `content/state/previewState.ts` | `npm run typecheck` |
| Frameability is answered in the background worker; a page-context `fetch()` cannot see response headers | 👁 | `background/frameability.ts` | — |
| Article text is never mutated to highlight it — paint an overlay, don't wrap in `<span>`s | 👁 | `content/extraction/sentences.ts`, `content/panel/highlight.ts` | — |
| Bands come from the block's measured lines, never a line-height grid and never the drawn sentence's own rects | ✅ | `content/extraction/sentences.ts` (`lineBandsFor`) | `sentences.browser.test.ts` |
| Client rects are merged by visual line before painting, never used raw | ✅ | `content/extraction/sentences.ts` (`lineRectsForSentence`) | `sentences.browser.test.ts` |
| Hit-testing goes through the shadow root's `elementFromPoint`, then rect containment — never a caret lookup | 👁 | `content/extraction/sentences.ts` (`sentenceAtPoint`) | — |
| Segmentation is `Intl.Segmenter` plus two corrections, never a regex split on `.` | ✅ | `content/extraction/sentences.ts` (`sentencesIn`, `pastCitation`, `endsSentence`) | `sentences.test.ts` |
| A clipboard write is synchronous inside a real click handler, in the content script | 👁 | `content/panel/clipboard.ts` | — |
| `clipboardWrite` stays out of the manifest — it buys nothing and costs an install warning | 👁 | `content/panel/clipboard.ts` | — |
| `:host(:hover)`, never `:host:hover` — the bare-chained form silently never matches | 👁 | `content/panel/styles.ts` | — |
| No backticks inside `styles.ts`'s CSS comments; the sheet is one template literal | ✅ | `content/panel/styles.ts` | `npm run typecheck` |
| Source order is the mechanism in `styles.ts`, and `all: initial` erases what earlier rules set | 👁 | `content/panel/styles.ts` | — |
| Two surfaces, one hit-tester: the differences are three options, not a second code path | 👁 | `content/panel/hostClipping.ts`, `content/panel/highlight.ts` (`Options`) | — |
| Host clipping is armed only while the reader asked for it, and the rail's presence IS the indicator | ✅ | `content/panel/hostClipping.ts`, `content/panel/mountPanel.ts` | `e2e/extension.test.ts` |
| The backdrop is gated on `data-preview`, not on the host being visible | ✅ | `content/panel/styles.ts` (`.piko-backdrop`), `content/panel/mountPanel.ts` | `e2e/extension.test.ts` |
| Escape inside a text field belongs to the field, and the guard reads `composedPath()` | ✅ | `content/panel/mountPanel.ts` | `e2e/extension.test.ts` |
| Projections are derived at point of use, never cached onto state | ✅ | `content/state/clippings.ts` | `clippings.test.ts` |
| The session rule lives in `sameSitting` and only there — both readers ask that predicate | ✅ | `content/state/clippings.ts` (`sameSitting`) | `clippings.test.ts` |
| Every narrowing goes through `visibleClippings`; filters intersect, sources union among themselves | ✅ | `content/state/clippings.ts` (`visibleClippings`, `JournalFilters`) | `clippings.test.ts` |
| Chips are ordered by sitting, not by count | ✅ | `content/state/clippings.ts` (`sourcesInSessionOrder`) | `clippings.test.ts` |
| The chip row is ordered by time and nothing else — "here" marks chips, it never moves them | ✅ | `content/state/clippings.ts` (`sourcesOnOrFrom`), `clippingsPane.tsx` (`ChipRow`) | `clippingsPane.test.ts` |
| A span label is one short word, because vertical text's length is its height | ✅ | `content/state/clippings.ts` (`AGE_BAND_LABEL`) | `clippingsPane.browser.test.ts` |
| The store hands out snapshots — the array is replaced on every change, never mutated | ✅ | `content/state/clippings.ts` (`createClippingsStore`) | `clippings.test.ts`, `npm run typecheck` |
| A row refuses an update it doesn't need, so `ClipEntry`'s props stay reference-stable | ✅ | `clippingsPane.tsx` (`ClipEntry`, `remove`) | `clippingsPane.test.ts` |
| `keyOf` mirrors `isSame`, and one pane instance is re-parented rather than rendered twice | ✅ | `clippingsPane.tsx` (`keyOf`), `content/panel/mountPanel.ts` (`dockPaneIn`) | `clippingsPane.test.ts`, `e2e/extension.test.ts` |

### What only a human can guard
Two effects leave the page entirely, and no suite here can follow them. Re-confirm both by hand
after touching either path; the traps that make them unreachable from automation are under
*Driving it with browser automation* above.

- **A clipboard write landing.** Reading it back to check raises a permission prompt that
  freezes the renderer, so confirmation is a human pasting somewhere. `copyText` has no test at
  all — both its branches end in a browser API whose effect is invisible from script.
- **A `#:~:text=` link activating.** The directive needs a browser- or user-initiated
  navigation; driven through CDP the page loads at the top with nothing highlighted, even for
  text that is verbatim on the page. The URL it needs *is* tested — `textFragment.test.ts` pins
  the construction — so only the browser's half is on eyes.

## Pointers
- `README.md` — architecture diagram, layering, install, permissions.
- **Before starting, check `.claude/handoffs/TODO.md`** — the living handoff carrying
  current status, next step, and the decisions-and-rejected-alternatives log (why there's
  no LLM, why the name, what's been measured and shelved). It is local and gitignored, so
  a fresh clone won't have it; don't rely on it existing.
- Chrome MV3 docs are the authority on permission warnings and clipboard rules — check a
  permission's user-facing install warning before adopting it. That check is what ruled
  out `clipboardWrite`.
