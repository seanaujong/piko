# Verifying Piko by hand

**At a glance.** `extension.test.ts` beside this file drives the actually-loaded extension
against local fixture pages, and it replaces the reload-and-drag loop for anything that can be
asserted — the manifest, the background worker, the message round-trip, `chrome.storage`. What
it cannot do is judge how something *looks*, and it cannot follow two effects that leave the
browser entirely. This file is that remainder: the reload cycle, the traps that bite when an
agent drives Chrome, and the pass that finds bugs fastest.

Reach for the suite first (`npm test`). Come here when the question is visual, or when you are
driving a real browser through Claude-in-Chrome or a similar tool. Every trap below has already
cost an hour at least once.

## The reload cycle

`npm run build` → click reload on Piko's card at `chrome://extensions` → **refresh the test
tab.**

Skipping that last step is the mistake worth naming, because the failure looks like something
else. An already-open tab keeps running the content script from *before* the reload, and that
script's `chrome.runtime` connection is dead — retrying the gesture won't revive it, only a real
refresh will. Piko fails loudly here rather than hanging, so the message "Piko was updated —
refresh this page" means exactly this and nothing more sinister.

## Driving Chrome from an agent

**Dispatch the drag events; don't use `left_click_drag`.** Mouse-drag automation is unreliable
at firing `dragend` — three consecutive failures on one run. `startDragTracking` never checks
`isTrusted`, so a synthetic pair drives the real flow every time, and does so deterministically:

```js
a.dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
a.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
```

This is the harness to reach for first, not a fallback. (`extension.test.ts`'s `dragLink` does
the same thing for the same reason.)

**Never call `navigator.clipboard.readText()` to check a copy landed.** It raises a permission
prompt that freezes the renderer — one CDP call timed out at 45 seconds this way. `copyText` is
fire-and-forget by design, so a clipboard write can only be confirmed by a human pasting it
somewhere.

**A scroll-to-text fragment (`#:~:text=`) cannot be activated from automation.** Navigating to
one through CDP
does not run the directive: the page loads at the top with nothing highlighted, even for text
that is verbatim on the page, because the directive needs a browser- or user-initiated
navigation. Clicking an injected anchor doesn't navigate at all. Verify the URL *construction*
instead — `textFragment.test.ts` pins it — and leave activation to a human click.

**A synthetic scroll wheel over the panel scrolls the host page, not the preview.** Wheel events
don't route into the shadow tree. This looks exactly like a broken scroll container and is not
one: `.piko-content` is the real scroll owner. Drive it with `content.scrollTop = …` or
`el.scrollIntoView()` from inside the shadow root. Do not conclude from this that human
scrolling is broken — that has never been shown.

**A blank-looking reader pane is usually a large lead image still loading**, not failed
extraction. Check `.piko-article`'s `textContent.length` before believing a screenshot.

**Everything lives in one open shadow root** on a `<div>` appended to `document.documentElement`.
Reach it with:

```js
[...document.documentElement.children].find(e => e.shadowRoot).shadowRoot
```

**Never trigger `alert` or `confirm`.** A modal dialog freezes the automation channel outright,
and nothing you send afterwards arrives.

## The pass that finds bugs fastest

In this order:

1. Drag a link → reader mode renders.
2. Hover a sentence → bands tile the lines, with no double-painting over links.
3. Click it → the mark persists and the pane's count increments.
4. Clip from a second page → the source filter chips appear, which they only do at two or more
   sources.
5. Open the search field and type → the list and the chip counts both narrow. Escape closes the
   search, *not* the preview.
6. Press a span marker → the row keeps only that span.
7. On a page you have clipped from → the pin scope appears, and its chips are outlined.
8. Toggle Live page and back → marks re-paint from a text match.
9. Scroll → marks travel with the text.
10. Reload the tab → `chrome.storage.local` restores the journal.

## What a fresh journal cannot show you

Two things need a journal older than the sitting you are in, so a normal pass never reaches
them.

**Session dividers** want two clippings more than 45 minutes apart. Lower `SESSION_GAP_MS` in
`clippings.ts` temporarily rather than faking a stored timestamp.

**The chip row's span markers** want clippings in different spans of time. A fresh journal is
all one span and renders a single `Today`. There is no equivalent dial to turn here, so trust
`clippings.test.ts` for the logic and use your eyes only for the look.
