/**
 * URLs are displayed for recognition, never for copying — every copy path uses the full
 * string. The scheme and a leading `www.` carry nothing a reader needs to recognise a page,
 * and in a narrow header or a clipping's source line they are exactly what pushes the
 * meaningful tail of the path out of view.
 */
export function displayUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

/**
 * Just the host, for places too narrow to hold a path. Falls back to the trimmed string
 * rather than throwing — a clipping's stored URL is only ever as well-formed as the page it
 * came from, and a malformed one should still render something.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return displayUrl(url)
  }
}
