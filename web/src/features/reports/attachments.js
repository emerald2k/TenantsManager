import { uploadAttachment } from '@/lib/fileUpload'

/**
 * The Storage-touching half of report attachments (FR-DOC-01…05, SRS §6).
 * Kept separate from `schema.js` deliberately: that file is pure
 * validation/initial-values logic; this one does real Storage I/O
 * (`uploadPendingAttachments`) alongside one pure helper
 * (`collectAttachmentPaths`) used on both sides of the upload.
 *
 * Each cost line's `attachments[]` entry, in FORM state, is uniform:
 * `{ path, name, type, file }` — exactly one of `path` (already persisted,
 * a bucket-relative Storage path — debt #5, never a download URL) or `file`
 * (a raw `File`, picked but not yet uploaded) is present. The PERSISTED shape
 * (what actually reaches Firestore) only ever has `{ path, name, type }` —
 * `uploadPendingAttachments` is what strips `file` out, by replacing every
 * `file`-bearing entry with its uploaded reference.
 */

const LINE_FIELDS = ['rent', 'maintenance']
const LINE_ARRAY_FIELDS = ['serviceCosts', 'otherExpenses']

/** Every `costLine`-shaped value on a report, in a fixed, predictable order —
 * shared by both functions below so they walk the exact same tree. */
function costLinesOf(report) {
  if (!report) return []
  const singles = LINE_FIELDS.map((field) => report[field]).filter(Boolean)
  const arrays = LINE_ARRAY_FIELDS.flatMap((field) => report[field] ?? [])
  return [...singles, ...arrays]
}

/**
 * Every attachment path currently present on a report — used both as the
 * "before" snapshot (on load, from `existingReport`) and the "after" snapshot
 * (post-save, from the just-written document); the difference is what the
 * admin removed (see `useSaveReportDraft`). `null`/`undefined` (a brand new
 * report — nothing was ever saved) returns `[]`, not an error: there is
 * nothing to diff against yet.
 */
export function collectAttachmentPaths(report) {
  return costLinesOf(report).flatMap((line) =>
    (line.attachments ?? [])
      .map((attachment) => attachment.path)
      .filter(Boolean),
  )
}

/** Uploads the `file`-bearing attachments on ONE cost line, leaving
 * already-persisted ones (`path`, no `file`) untouched. Returns the line with
 * a CLEAN `attachments[]` (only `{ path, name, type }`, zero `file` left) plus
 * the paths of whatever it just uploaded (for orphan cleanup on a later
 * failure). */
async function uploadLineAttachments(line, basePath) {
  const newPaths = []
  const attachments = await Promise.all(
    (line.attachments ?? []).map(async (attachment) => {
      if (!attachment.file) {
        return {
          path: attachment.path,
          name: attachment.name,
          type: attachment.type,
        }
      }
      const path = `${basePath}/${crypto.randomUUID()}-${attachment.file.name}`
      const uploaded = await uploadAttachment(path, attachment.file)
      newPaths.push(uploaded.path)
      return uploaded
    }),
  )
  return { line: { ...line, attachments }, newPaths }
}

/**
 * Uploads every PENDING (`file`-bearing) attachment across the whole report —
 * rent, maintenance, each service, each other-expense line — and returns a
 * version of `values` with CLEAN attachments everywhere (no `File` object
 * survives anywhere in the tree: Firestore throws on one), plus the flat list
 * of newly-uploaded paths (so a failed `setDoc` right after can clean up only
 * those orphans — see `useSaveReportDraft`).
 */
export async function uploadPendingAttachments(values, basePath) {
  const newPaths = []

  async function process(line) {
    // Tolerates a missing rent/maintenance (e.g. a minimal test fixture, or a
    // future caller that only sends part of the form) — nothing to upload,
    // nothing to clean, pass it through exactly as received.
    if (!line) return line
    const result = await uploadLineAttachments(line, basePath)
    newPaths.push(...result.newPaths)
    return result.line
  }

  const rent = await process(values.rent)
  const maintenance = await process(values.maintenance)
  const serviceCosts = await Promise.all(
    (values.serviceCosts ?? []).map(process),
  )
  const otherExpenses = await Promise.all(
    (values.otherExpenses ?? []).map(process),
  )

  return {
    values: { ...values, rent, maintenance, serviceCosts, otherExpenses },
    newPaths,
  }
}
