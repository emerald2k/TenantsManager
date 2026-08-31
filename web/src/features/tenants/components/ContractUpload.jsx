import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useUpdateTenancy } from '@/features/tenants/hooks'
import {
  MAX_UPLOAD_SIZE_BYTES,
  deleteAttachmentBestEffort,
  uploadAttachment,
} from '@/lib/fileUpload'
import { useAttachmentUrl } from '@/lib/useAttachmentUrl'
import { ImageWithFallback } from '@/components/shared/ImageWithFallback'

/**
 * The signed-contract uploader for the Tenancy tab (FR-CON-07, M3-C).
 *
 * Deliberately NOT `PhotoGallery`/`PhotoCapture` reused directly: both of
 * those unconditionally run every upload through `imageCompression`, which
 * would corrupt a PDF or .doc/.docx file. Here compression is CONDITIONAL,
 * via `uploadAttachment` (`@/lib/fileUpload`, extracted at M4 sub-stage 3,
 * shared with the report cost-line attachments) — only when the file
 * classifies as `'image'` (FR-DOC-05: "images compressed automatically on the
 * client"); a PDF/doc uploads byte-for-byte as-is.
 *
 * Writes to `tenancies/{tenancyId}.attachedDocuments[]` via `useUpdateTenancy`
 * (a plain array replace, like PhotoGallery's `persist` — `mutate`, not
 * awaited, matching that component's fire-and-forget convention).
 *
 * @param tenancyId  the tenancy document id (Storage path + useUpdateTenancy target)
 * @param userId     mutate-time context only, for useUpdateTenancy's cache invalidation
 * @param documents  the current `attachedDocuments` array, as loaded on the tenancy
 */

/**
 * One contract document, resolved from its stored `path` (debt #5) to a real
 * download URL via `useAttachmentUrl` at render time. A sub-component per
 * element: the hook cannot be called from inside the parent's `.map()`.
 */
function DocumentRow({ item, onDelete, t }) {
  const { url, isLoading } = useAttachmentUrl(item.path)

  return (
    <li className="flex items-center gap-3">
      {url && item.type === 'image' ? (
        <ImageWithFallback
          src={url}
          alt={item.name}
          className="h-12 w-12 rounded border border-border object-cover"
        />
      ) : item.type !== 'image' ? (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-border text-xs font-medium text-muted-foreground">
          {item.type.toUpperCase()}
        </span>
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-border bg-muted" />
      )}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-foreground underline"
        >
          {item.name}
        </a>
      ) : (
        <span className="text-sm text-muted-foreground">
          {item.name} {!isLoading && `(${t('common.attachmentUnavailable')})`}
        </span>
      )}
      <Button type="button" variant="destructive" size="xs" onClick={onDelete}>
        {t('tenants.detail.tenancy.contract.delete')}
      </Button>
    </li>
  )
}

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

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setError(t('tenants.detail.tenancy.contract.tooLarge'))
      return
    }

    const path = `tenancies/${tenancyId}/contract/${crypto.randomUUID()}-${file.name}`
    const attachment = await uploadAttachment(path, file)

    persist([...documents, attachment])
  }

  async function handleDelete(index) {
    const target = documents[index]
    await deleteAttachmentBestEffort(target.path)
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
            <DocumentRow
              key={item.path}
              item={item}
              onDelete={() => handleDelete(index)}
              t={t}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
