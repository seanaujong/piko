/**
 * What the panel may do with a response, read from what the response says it is.
 *
 * Three answers, and the distance between them is the reader's disk. Reader mode needs the
 * **body**, so anything Readability can be handed is `extract`. The frame needs nothing but the
 * **URL**, so a type Chrome renders inline is `frame`. Everything else is `refuse`, and that
 * answer is why this file exists: *a navigation to something Chrome cannot display inline is a
 * download.* The panel's iframe is an ordinary, unsandboxed frame, so pointing it at a `.docx`
 * does not fail politely — Chrome saves the file to the reader's Downloads folder, with no
 * dialog, no undo and nothing on screen to say it happened. Dragging a link is a reading
 * gesture. It must never be a way to put a file on someone's machine.
 *
 * The case that found this is ordinary: a course page whose week-by-week readings are `.docx`
 * handouts, or a release page whose assets are `.zip`. Every one of those links looks exactly
 * like an article link to the drag.
 *
 * **Why an allow-list rather than a list of what to refuse.** The two ways of being wrong do not
 * cost the same. A type wrongly refused shows a sentence the reader can act on, and the link is
 * still on the page. A type wrongly framed writes a file to their disk. So the unknown type has
 * to land on the refusing side, which only an allow-list does — a deny-list is wrong about
 * every format invented after it was written.
 */

export type ContentHandling = 'extract' | 'frame' | 'refuse'

/**
 * What Readability can be given.
 *
 * `application/xhtml+xml` is here because leaving it out was a silent bug, not a decision: the
 * check used to ask whether the type contained `text/html`, and a W3C specification — served as
 * XHTML, and prose from top to bottom — came back as something to frame. The reader lost
 * highlighting, clipping, and the reader-mode toggle itself, since the toggle is offered only
 * when there is a body to extract from. Nothing said why, because from the outside it looked
 * like a page that simply preferred the frame.
 */
const EXTRACTABLE: readonly string[] = ['text/html', 'application/xhtml+xml']

/**
 * What Chrome renders inline, rather than saving.
 *
 * Spelled out one type at a time on purpose. `image/*` looks like the tidier rule and is the
 * wrong shape — Chrome renders the image formats it has a decoder for and downloads the rest,
 * so a wildcard quietly re-opens the hole this list closes. Media is deliberately absent for
 * the same reason and more sharply: Chrome plays an `.mp4` and saves an `.mkv`, and both arrive
 * as `video/…`.
 */
const FRAMEABLE: readonly string[] = [
  'application/pdf',
  'text/plain',
  'text/xml',
  'application/xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'image/x-icon',
]

/**
 * A `Content-Type` header carries parameters — `text/html; charset=utf-8` — and only the type
 * itself decides this. Matching on the whole header string is how `charset=utf-8` ends up
 * participating in a comparison it has no business in.
 */
function essence(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase()
}

/**
 * A response that names no type at all is refused rather than guessed at.
 *
 * Chrome sniffs a missing `Content-Type`, and sniffing can land on "download" as easily as on
 * "render" — so a guess here would be a guess about the very outcome being guarded. The reader
 * is told the type is unknown, which is the truth and is actionable.
 */
export function handlingFor(contentType: string): ContentHandling {
  const type = essence(contentType)
  if (EXTRACTABLE.includes(type)) return 'extract'
  if (FRAMEABLE.includes(type)) return 'frame'
  return 'refuse'
}

/**
 * Whether the server said "save this" rather than "show this".
 *
 * This bars **framing and only framing**, which is exactly as far as the header's meaning
 * reaches. Chrome honours `attachment` on a PDF exactly as it does on a zip, so a frameable
 * type carrying it is still a download. Extraction is untouched because extraction never
 * navigates: it reads a body the worker already holds, so an HTML report served as an
 * attachment opens in reader mode and no file lands anywhere.
 */
export function isAttachment(contentDisposition: string): boolean {
  return /^\s*attachment\b/i.test(contentDisposition)
}
