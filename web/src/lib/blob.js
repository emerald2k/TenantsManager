/**
 * Client-side Blob helpers (M4 sub-stage 8) — used by the public
 * SharedReportPage to turn getSharedReportAttachment's base64 response into
 * a downloadable file. ExportReportControls' PDF/PNG export does NOT use
 * this: it builds its downloads directly from html2canvas's canvas
 * (`canvas.toDataURL()`), never through a base64 string, so it never goes
 * through `base64ToBlob`.
 */

/** Converts a base64 string into a downloadable Blob. */
export function base64ToBlob(base64, contentType) {
  const byteChars = atob(base64)
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) {
    bytes[i] = byteChars.charCodeAt(i)
  }
  return new Blob([bytes], { type: contentType || 'application/octet-stream' })
}

/** Triggers a browser download of `blob` as `filename` — a throwaway <a>,
 * the standard client-side download idiom (no Storage URL, no navigation). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
