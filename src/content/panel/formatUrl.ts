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
