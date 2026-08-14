import imageCompression from 'browser-image-compression'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { storage } from '@/lib/firebase'

/**
 * Shared Storage-upload primitives (FR-DOC-01…05). Extracted at M4 sub-stage 3
 * from what had been THREE near-identical local copies (ContractUpload,
 * onboarding's PhotoCapture, tenants' PhotoGallery) — this is the one new
 * consumer (the report attachments) that tips it over into "reuse, don't
 * duplicate a 4th time". `ContractUpload` is refactored onto this in the same
 * change; `PhotoCapture`/`PhotoGallery` are image-only and left as-is (a
 * bigger refactor, not needed here).
 */

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024 // FR-DOC-05

export const IMAGE_COMPRESSION_OPTIONS = {
  maxWidthOrHeight: 2000,
  initialQuality: 0.8,
  useWebWorker: true,
}

/** FR-DOC-01/03: an attachment is image, PDF, or "document" (doc/docx and
 * anything else not covered by the first two) — the same `type` enum used on
 * every attachment shape in SRS §6 (report cost lines, contract, ID photos). */
export function classifyFileType(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf') return 'pdf'
  return 'doc'
}

/**
 * Uploads one file to `path` and returns the persisted reference shape
 * (`{ path, name, type }`, SRS §6 — debt #5: a bucket-relative Storage path,
 * never a download URL). Compression is CONDITIONAL — only when the file
 * classifies as `'image'` (FR-DOC-05); a PDF/doc uploads byte-for-byte, since
 * running it through `imageCompression` would corrupt it.
 *
 * Does NOT check `MAX_UPLOAD_SIZE_BYTES` — that is a pre-upload, UI-level
 * decision (reject before ever touching Storage), left to the caller.
 */
export async function uploadAttachment(path, file) {
  const type = classifyFileType(file)
  const payload =
    type === 'image'
      ? await imageCompression(file, IMAGE_COMPRESSION_OPTIONS)
      : file

  const objectRef = ref(storage, path)
  await uploadBytes(objectRef, payload)

  return { path: objectRef.fullPath, name: file.name, type }
}

/**
 * Best-effort delete of a Storage object identified by its bucket-relative
 * path (SRS §6, debt #5 — never a download URL; every call site in this
 * codebase passes `.path`, the same shape `uploadAttachment` returns above).
 * `ref(storage, path)` resolves it to the underlying object — the same call
 * already proven in ContractUpload/PhotoGallery/PhotoCapture's own delete
 * handlers, reused here as-is. (Firebase's own `ref()` also accepts a full
 * `https://` download URL or `gs://` URI — just never exercised that way
 * anywhere in this codebase.)
 *
 * Swallows failures deliberately: the caller (a removed/orphaned reference)
 * must proceed regardless of whether the underlying object could be deleted —
 * same convention as every other Storage delete in this codebase.
 */
export async function deleteAttachmentBestEffort(path) {
  try {
    await deleteObject(ref(storage, path))
  } catch {
    // Best-effort — see doc comment above.
  }
}
