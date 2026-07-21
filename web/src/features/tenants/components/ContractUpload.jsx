import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import imageCompression from 'browser-image-compression'
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { useUpdateTenancy } from '@/features/tenants/hooks'

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // FR-DOC-05

const COMPRESSION_OPTIONS = {
  maxWidthOrHeight: 2000,
  initialQuality: 0.8,
  useWebWorker: true,
}

/** FR-DOC-01/03: a contract attachment is image, PDF, or "document" (doc/docx
 * and anything else not covered by the first two). Matches the `type` enum
 * already used for report cost-line attachments (SRS §6). */
function classifyFileType(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf') return 'pdf'
  return 'doc'
}

/**
 * The signed-contract uploader for the Tenancy tab (FR-CON-07, M3-C).
 *
 * Deliberately NOT `PhotoGallery`/`PhotoCapture` reused directly: both of
 * those unconditionally run every upload through `imageCompression`, which
 * would corrupt a PDF or .doc/.docx file. Here compression is CONDITIONAL —
 * only when the file classifies as `'image'` (FR-DOC-05: "images compressed
 * automatically on the client"); a PDF/doc uploads byte-for-byte as-is. Same
 * upload mechanics otherwise (uploadBytes/getDownloadURL, `crypto.randomUUID()-
 * {file.name}` naming, best-effort delete) — only the compression step and the
 * accepted file types differ.
 *
 * Writes to `tenancies/{tenancyId}.attachedDocuments[]` via `useUpdateTenancy`
 * (a plain array replace, like PhotoGallery's `persist` — `mutate`, not
 * awaited, matching that component's fire-and-forget convention).
 *
 * @param tenancyId  the tenancy document id (Storage path + useUpdateTenancy target)
 * @param userId     mutate-time context only, for useUpdateTenancy's cache invalidation
 * @param documents  the current `attachedDocuments` array, as loaded on the tenancy
 */
export function ContractUpload({ tenancyId, userId, documents }) {
  const { t } = useTranslation()
  const updateTenancy = useUpdateTenancy()
  const inputRef = useRef(null)
  const [error, setError] = useState(null)

  function persist(nextDocuments) {
    updateTenancy.mutate({
      id: tenancyId,
      userId,
      values: { attachedDocuments: nextDocuments },
    })
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)

    if (file.size > MAX_SIZE_BYTES) {
      setError(t('tenants.detail.tenancy.contract.tooLarge'))
      return
    }

    const type = classifyFileType(file)
    const payload =
      type === 'image'
        ? await imageCompression(file, COMPRESSION_OPTIONS)
        : file

    const path = `tenancies/${tenancyId}/contract/${crypto.randomUUID()}-${file.name}`
    const objectRef = ref(storage, path)
    await uploadBytes(objectRef, payload)
    const url = await getDownloadURL(objectRef)

    persist([...documents, { url, name: file.name, type }])
  }

  async function handleDelete(index) {
    const target = documents[index]
    try {
      await deleteObject(ref(storage, target.url))
    } catch {
      // Best-effort, same convention as PhotoGallery/PhotoCapture: the
      // reference must be removable regardless of whether the Storage object
      // could be deleted.
    }
    persist(documents.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.doc,.docx"
        className="hidden"
        onChange={handleFileChange}
      />
      <div>
        <Button type="button" onClick={() => inputRef.current?.click()}>
          {t('tenants.detail.tenancy.contract.upload')}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {documents.length > 0 && (
        <ul className="flex flex-col gap-2">
          {documents.map((item, index) => (
            <li key={item.url} className="flex items-center gap-3">
              {item.type === 'image' ? (
                <img
                  src={item.url}
                  alt={item.name}
                  className="h-12 w-12 rounded border border-border object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-border text-xs font-medium text-muted-foreground">
                  {item.type.toUpperCase()}
                </span>
              )}
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-foreground underline"
              >
                {item.name}
              </a>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={() => handleDelete(index)}
              >
                {t('tenants.detail.tenancy.contract.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
