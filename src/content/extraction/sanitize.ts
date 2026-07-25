import DOMPurify from 'dompurify'

// Registered once at module load — links inside a previewed page must never be able
// to tabnab the tab that's actually browsing (window.opener) or replace it (missing _blank).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function sanitizeArticleHtml(html: string): string {
  return DOMPurify.sanitize(html)
}
