/**
 * Client-side Blob helpers (M4 sub-stage 8) — shared by the public
 * SharedReportPage (attachment bytes, via getSharedReportAttachment's
 * base64 response) and ExportReportControls (the PNG export, via
 * html2canvas's canvas). Neither feature owns this — both need it.
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
