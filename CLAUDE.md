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
npm run icons:sheet # the contact sheet an icon edit is judged on — see below
npm run bench       # measurements, NOT in the gate — see below
npm run package     # piko-<version>.zip — what "Load unpacked" and the store both want
npm run release-bump <major|minor|patch|X.Y.Z>   # both version fields at once
```

**Releasing.** `docs/chrome-web-store-listing.md` is the listing of record — every dashboard
field, and the permissions justification that is the hard part of submitting this particular
extension. `npm run release-bump` writes the version to `package.json`, its lockfile and
`manifest.json` together, because the store rejects an upload whose version is not higher than
the last, and finding that out at upload time is a long way to travel. `npm run package` builds
with `--release` (no sourcemaps) into a **cleared** `dist/`, which is also why an ordinary build
clears it: esbuild overwrites what it emits and leaves behind anything it has stopped emitting.

**`npm run icons:sheet` is how an icon change gets judged**, and judging one on the 128 alone
is how every icon bug in this project has gotten in. It renders all four declared sizes,
magnified with hard pixel edges, on both a light and a dark toolbar grey — with no arguments
for what currently ships, or `-- a.svg b.svg` to put candidates side by side. The magnified
images are real rasterizer output, never the vector redrawn larger, because that distinction
is the entire point. Like the benches it prints and asserts nothing: "does this read as a
gull" is not a predicate, so it stays out of the gate. `scripts/icon-sheet.mjs` lists the
four failures that were invisible at 128 and obvious at 16, and `scripts/rasterize.mjs` says
why the sheet and the shipping icons must rasterize through the same code.

**`npm run bench` prints, it doesn't assert** — add `--reporter=verbose` for the tables. Three
benches over a generated 220-paragraph article, each isolating a different cost: `reading` what
a store change costs on the page, `pane` what the journal costs to draw at up to 5,000
clippings, `journal` what it costs to persist. They exist to answer design questions with
numbers rather than intuition, and have overturned two confident guesses so far. Each bench file
opens with what it measures and why that number is the interesting one; `vitest.bench.config.ts`
says why they're kept out of the gate and why the command is `vitest run` rather than
`vitest bench`.

## How a change lands
Every change goes through a branch or worktree and a pull request; nothing is committed or
pushed while standing on main. The two hooks in `.githooks` enforce that locally — `npm install`
wires them through `core.hooksPath`, so there is no step to remember — and main's branch
protection enforces it at the remote, where both CI jobs have to be green and the branch has to
be up to date first. A separate linear-history ruleset means a pull request lands as a **squash
or a rebase**; a merge commit is refused at the remote whatever the local hooks allow.
`--no-verify` exists on both hooks for genuine exceptions, of which the commit introducing the
hooks was one.

**A branch stays linear too, which makes updating one a rebase.** `git merge main` is refused by
the pre-push hook, so a stale branch catches up with `git fetch origin && git rebase origin/main`
and then needs `git push --force-with-lease` — never a bare `--force`, which will happily discard
a commit someone else pushed while you were rebasing. `npm install` also sets `pull.rebase`, so a
plain `git pull` on a branch rebases rather than quietly writing the merge the hook would then
reject. The cost is real and worth stating: rewriting a pushed branch is only safe because
branches here are short-lived and single-author.

**Three suites, split by what each needs.** `npm test` runs all of them; `vitest.config.ts` is
where each one's requirement is argued.

| Suite | Runs | Needs |
|---|---|---|
| `unit` | `src/**/*.test.ts` | jsdom — enough DOM for `DOMParser`, `textContent` and `Range` |
| `geometry` | `src/**/*.browser.test.ts` | real Chrome, because it measures *layout*; jsdom reports every rect as zero |
| `e2e` | `e2e/*.test.ts` | the actually-loaded extension — the only suite reaching the manifest, the worker and `chrome.storage`. Loads `dist-test/`, not `dist/`: see below |

The e2e suite rebuilds `dist/` first and tests the shipped **bundle** — but under a substituted
**manifest**. Piko ships with `optional_host_permissions`, and no automation can perform a host
grant (three routes measured and dead; `e2e/harness.ts` lists them), so `dist-test/` is `dist/`
with the content script declared statically. `e2e/testManifest.ts` is the whole of the
difference and `e2e/manifest.test.ts` fails the build if it grows beyond three injection keys.
What that leaves on eyes is the grant flow itself, in `e2e/MANUAL.md`.

The suite **replaces the manual reload-and-drag loop** — the most expensive step in developing this project. Its two
non-obvious launch requirements are documented where they are enforced, in `e2e/harness.ts`.

## Verifying a change in Chrome
What the suites cannot do is judge how something *looks*, and two effects leave the browser
entirely (see *What only a human can guard* below). **`e2e/MANUAL.md` is the procedure for all
of it** — the reload cycle, the traps that bite when an agent drives Chrome, the pass that finds
bugs fastest, and the two things a fresh journal can never show you. Read it before driving a
real browser; every trap in it has already cost an hour.

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
| how host access is asked for, or what the install opens | `public/onboarding.html` + `src/onboarding/index.ts` |
| when the content script is registered | `background/contentScriptRegistration.ts` |
| sentence boundaries or highlight geometry | `content/extraction/sentences.ts` |
| the clippings journal or its projections | `content/state/clippings.ts` |
| what an exported file says, or how it leaves | `content/panel/exportMarkdown.ts`, then `download.ts` |
| how a clipping reads once shown — footnote markers and the like | `content/extraction/sentences.ts` (`withoutCitations`) |
| how a source is named on screen — its title or its address | `content/panel/formatUrl.ts` |
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
| Relative URLs are resolved explicitly, never by a `<base>` element the host page's CSP can veto | ✅ | `content/extraction/extract.ts` (`absolutiseUrls`) | `extract.test.ts`, `e2e/extension.test.ts` (`hostile base-uri`) |
| Host access is optional and requested at runtime — neither `host_permissions` nor `content_scripts` is declared | ✅ | `manifest.json`, `background/contentScriptRegistration.ts` | `e2e/manifest.test.ts` |
| The e2e manifest differs from the shipped one in injection keys only, never in a permission | ✅ | `e2e/testManifest.ts` | `e2e/manifest.test.ts` |
| Registration is gated on `permissions.contains`, never inferred from the call succeeding | ✅ | `background/contentScriptRegistration.ts` | `contentScriptRegistration.test.ts` |
| Nothing is added to a page until a gesture asks for it — the panel mounts lazily | ✅ | `content/index.ts` (`livePanel`) | `e2e/extension.test.ts` (`puts nothing in the page`) |
| A preview starts from a trusted event only — a synthesised drag is not evidence a reader wanted anything | ✅ | `content/dragTracking.ts` | `dragTracking.test.ts` |
| The worker refuses to reach a network tier the dragging page couldn't — public page, private address | ✅ | `background/fetchPolicy.ts` (`fetchRefusal`) | `fetchPolicy.test.ts` |
| The fetch carries no cookie — `credentials: 'omit'` is explicit, because the default sends one | ✅ | `background/frameability.ts` | `e2e/extension.test.ts` (`what the background fetch carries`) |
| Sensitive hosts are one list asked by both the manifest and the worker, and the manifest is asserted against it | ✅ | `shared/sensitiveHosts.ts` | `sensitiveHosts.test.ts` |
| Article text is never mutated to highlight it — paint an overlay, don't wrap in `<span>`s | 👁 | `content/extraction/sentences.ts`, `content/panel/highlight.ts` | — |
| Bands come from the block's measured lines, never a line-height grid and never the drawn sentence's own rects | ✅ | `content/extraction/sentences.ts` (`lineBandsFor`) | `sentences.browser.test.ts` |
| Client rects are merged by visual line before painting, never used raw | ✅ | `content/extraction/sentences.ts` (`lineRectsForSentence`) | `sentences.browser.test.ts` |
| Hit-testing goes through the shadow root's `elementFromPoint`, then rect containment — never a caret lookup | 👁 | `content/extraction/sentences.ts` (`sentenceAtPoint`) | — |
| Segmentation is `Intl.Segmenter` plus two corrections, never a regex split on `.` | ✅ | `content/extraction/sentences.ts` (`sentencesIn`, `pastCitation`, `endsSentence`) | `sentences.test.ts` |
| Footnote markers are stripped where a clipping is *shown*, never where it is stored or matched | ✅ | `content/extraction/sentences.ts` (`withoutCitations`) | `sentences.test.ts`, `exportMarkdown.test.ts`, `e2e/extension.test.ts` |
| The site's tag is dropped where a source is *shown*, on the same terms — search and export still see the whole title | ✅ | `content/panel/formatUrl.ts` (`withoutSiteTag`) | `formatUrl.test.ts` |
| A block's text is its prose nodes, never `textContent` — and one filter feeds both the text and the Range | ✅ | `content/extraction/sentences.ts` (`textNodesIn`, `NOT_PROSE`) | `sentences.test.ts` |
| A clipboard write is synchronous inside a real click handler, in the content script | 👁 | `content/panel/clipboard.ts` | — |
| `clipboardWrite` stays out of the manifest — it buys nothing and costs an install warning | 👁 | `content/panel/clipboard.ts` | — |
| A file leaves through an anchor, never `chrome.downloads` — the permission costs an install warning | 👁 | `content/panel/download.ts` | — |
| The export writes every field of a `Clipping`, because the document is also the archive | ✅ | `content/panel/exportMarkdown.ts` | `exportMarkdown.test.ts` |
| An export is of the whole journal, never the narrowed view, and its label says which | ✅ | `clippingsPane.tsx`, `content/panel/exportMarkdown.ts` | `clippingsPane.test.ts`, `e2e/extension.test.ts` |
| Emptying the journal takes a labelled second click on a different control, and reaches storage | ✅ | `clippingsPane.tsx` (`ClearRow`), `content/state/clippings.ts` (`clear`) | `clippingsPane.test.ts`, `e2e/extension.test.ts` |
| The export is one of the delete's two answers, and a refused export empties nothing | ✅ | `clippingsPane.tsx` (`ClearRow`), `content/panel/download.ts` | `clippingsPane.test.ts` |
| A control added to a header bar must leave the leading group room — only the lead shrinks | ✅ | `content/panel/styles.ts` (`.piko-bar-lead`) | `clippingsPane.browser.test.ts` |
| The same rule wherever a name meets a number: a chip's label yields to its count, a source line's title yields to its site, and a title is never wider than the row holding it | ✅ | `content/panel/styles.ts` (`.piko-chip`, `.piko-chip-label`, `.piko-clip-source`) | `clippingsPane.browser.test.ts` |
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
| The chip row is the pane's foot and draws nothing when there is nothing to narrow; rows that open from a header control stay under it | ✅ | `clippingsPane.tsx` (`ChipRow`), `content/panel/styles.ts` (`.piko-clips-filters`) | `clippingsPane.test.ts` |
| A span label is one short word, because vertical text's length is its height | ✅ | `content/state/clippings.ts` (`AgeBand.label`) | `clippingsPane.browser.test.ts` |
| Spans subdivide past a month, and their order only ever moves further back | ✅ | `content/state/clippings.ts` (`ageBandOf`) | `clippings.test.ts`, `clippingsPane.test.ts` |
| The store hands out snapshots — the array is replaced on every change, never mutated | ✅ | `content/state/clippings.ts` (`createClippingsStore`) | `clippings.test.ts`, `npm run typecheck` |
| A write that doesn't land is always said out loud — a full quota rejects, it doesn't throw | ✅ | `content/state/clippings.ts` (`persist`, `storageError`) | `clippings.test.ts`, `clippingsPane.test.ts` |
| A row refuses an update it doesn't need, so `ClipEntry`'s props stay reference-stable | ✅ | `clippingsPane.tsx` (`ClipEntry`, `remove`) | `clippingsPane.test.ts` |
| `keyOf` mirrors `isSame`, and one pane instance is re-parented rather than rendered twice | ✅ | `clippingsPane.tsx` (`keyOf`), `content/panel/mountPanel.ts` (`dockPaneIn`) | `clippingsPane.test.ts`, `e2e/extension.test.ts` |

### What only a human can guard
Two effects leave the page entirely, and no suite here can follow them. Re-confirm both by hand
after touching either path; the traps that make them unreachable from automation are in
`e2e/MANUAL.md`.

- **A clipboard write landing.** Reading it back to check raises a permission prompt that
  freezes the renderer, so confirmation is a human pasting somewhere. `copyText` has no test at
  all — both its branches end in a browser API whose effect is invisible from script.
- **A `#:~:text=` link activating.** The directive needs a browser- or user-initiated
  navigation; driven through CDP the page loads at the top with nothing highlighted, even for
  text that is verbatim on the page. The URL it needs *is* tested — `textFragment.test.ts` pins
  the construction — so only the browser's half is on eyes.

**A third effect leaves the page and is guarded anyway**, and the contrast is worth keeping: the
export's download was expected to land in this list beside the clipboard and does not. A download
ends in a *file*, Playwright hands that file back, and `e2e/extension.test.ts` reads what was
actually written rather than trusting that the click did anything. What decides which list an
effect belongs on is not how far it travels but whether it ends in a value something can read.

## Pointers
- `README.md` — architecture diagram, layering, install, permissions.
- `docs/chrome-web-store-listing.md` — the store listing OF RECORD: description, single-purpose
  statement, the `storage` and all-sites justifications, reviewer instructions. The dashboard is
  not version-controlled, and re-deriving this under review pressure is how a listing ends up
  claiming something the extension doesn't do.
- `PRIVACY.md` — the policy the listing's privacy-policy URL points at. It has to stay true:
  anything that starts transmitting data, `chrome.storage.sync` included, changes both files.
- `e2e/MANUAL.md` — verifying by hand: the reload cycle, the browser-automation traps, the
  manual pass, and what a fresh journal can't show you. The complement to the e2e suite it
  sits beside.
- **Before starting, check `.claude/handoffs/TODO.md`** — the living handoff carrying
  current status, next step, and the decisions-and-rejected-alternatives log (why there's
  no LLM, why the name, what's been measured and shelved). It is local and gitignored, so
  a fresh clone won't have it; don't rely on it existing.
- Chrome MV3 docs are the authority on permission warnings and clipboard rules — check a
  permission's user-facing install warning before adopting it. That check is what ruled
  out `clipboardWrite`.
