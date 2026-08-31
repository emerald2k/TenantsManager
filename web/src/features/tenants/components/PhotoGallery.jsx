import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import imageCompression from 'browser-image-compression'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useUpdateUser } from '@/features/tenants/hooks'
import { useAttachmentUrl } from '@/lib/useAttachmentUrl'
import { ImageWithFallback } from '@/components/shared/ImageWithFallback'

/**
 * The tenant Profile tab's ID-photo gallery (M3-B, FR-TEN-09/11): view with
 * lightbox, re-upload, and delete — for a FINALIZED user, not a draft.
 *
 * Deliberately NOT `PhotoCapture` (onboarding/components/PhotoCapture.jsx)
 * reused directly: that component is wired to React Hook Form (`useFormContext`)
 * and the draft update hook, hard-coded to `/drafts/{draftId}/`. This gallery
 * has no form context — `photos` arrives as a prop from the user document, not
 * from form state — and writes to `/users/{userId}/{storageFolder}/`
 * (storage.rules, M3-B) via `useUpdateUser`. Same compression settings and the
 * same best-effort delete pattern, reimplemented against a different data path
 * rather than bent to fit two unrelated call sites.
 *
 * @param userId         the user document id (Storage path + useUpdateUser target)
 * @param photos         the current photo array — `idDocumentPhotos` or
 *                        `guarantor.idDocumentPhotos`, as loaded on the user
 * @param fieldPath      the Firestore field to write back — a literal DOT PATH
 *                        for the nested guarantor case (`'guarantor.idDocumentPhotos'`),
 *                        so `useUpdateUser`'s pass-through only ever touches this
 *                        one array, never the guarantor's text fields
 * @param storageFolder  'documents' (tenant, FR-TEN-03) or 'guarantor' (FR-TEN-04) —
 *                        the Storage subfolder under /users/{userId}/
 * @param minCount        the fewest photos allowed after a delete (1 for the
 *                        tenant's own ID photos, 0 for the optional guarantor ones)
 */

/**
 * One photo, resolved from its stored `path` (debt #5) to a real download URL
 * via `useAttachmentUrl` at render time. A sub-component per element: the
 * hook cannot be called from inside the parent's `.map()`.
 */
function PhotoThumbnail({ photo, canDelete, onDelete, onClick, t }) {
  const { url, isLoading } = useAttachmentUrl(photo.path)

  return (
    <div className="relative">
      {url ? (
        <ImageWithFallback
          src={url}
          alt={photo.name}
          className="aspect-square w-full cursor-pointer rounded-md border border-border object-cover"
          onClick={onClick}
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-md border border-border bg-muted text-center text-xs text-muted-foreground">
          {isLoading ? t('common.loading') : t('common.attachmentUnavailable')}
        </div>
      )}
      {canDelete && (
        <Button
          type="button"
          variant="destructive"
          size="xs"
          className="absolute top-1 right-1"
          onClick={onDelete}
        >
          {t('tenants.detail.photos.delete')}
        </Button>
      )}
    </div>
  )
}

/** The lightbox's own resolved image — `lightboxPhoto` is `null` while the
 * dialog is closed, so `path` is `undefined` and `useAttachmentUrl` simply
 * stays disabled (hooks must run unconditionally; the early `return null`
 * happens AFTER the hook call, not instead of it). */
function LightboxImage({ photo, t }) {
  const { url, isLoading } = useAttachmentUrl(photo?.path)

  if (!photo) return null

  if (!url) {
    return (
      <p className="text-sm text-muted-foreground">
        {isLoading ? t('common.loading') : t('common.attachmentUnavailable')}
      </p>
    )
  }

  return (
    <ImageWithFallback
      src={url}
      alt={photo.name}
      className="max-h-[80vh] w-full object-contain"
    />
  )
}

export function PhotoGallery({
  userId,
  photos,
  fieldPath,
  storageFolder,
  minCount,
}) {
  const { t } = useTranslation()
  const updateUser = useUpdateUser()
  const inputRef = useRef(null)
  const [error, setError] = useState(null)
  const [lightboxPhoto, setLightboxPhoto] = useState(null)

  const MAX_SIZE_BYTES = 10 * 1024 * 1024
  const COMPRESSION_OPTIONS = {
    maxWidthOrHeight: 2000,
    initialQuality: 0.8,
    useWebWorker: true,
  }

  function persist(nextPhotos) {
    updateUser.mutate({ id: userId, values: { [fieldPath]: nextPhotos } })
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)

    if (file.size > MAX_SIZE_BYTES) {
      setError(t('onboarding.wizard.photoCapture.tooLarge'))
      return
    }

    const compressed = await imageCompression(file, COMPRESSION_OPTIONS)
    const path = `users/${userId}/${storageFolder}/${crypto.randomUUID()}-${file.name}`
    const objectRef = ref(storage, path)
    await uploadBytes(objectRef, compressed)

    persist([
      ...photos,
      { path: objectRef.fullPath, name: file.name, type: 'image' },
    ])
  }

  async function handleDelete(index) {
    if (photos.length <= minCount) return
    const target = photos[index]
    try {
      await deleteObject(ref(storage, target.path))
    } catch {
      // Best-effort, same as PhotoCapture: the reference must be removable
      // regardless of whether the Storage object could be deleted.
    }
    persist(photos.filter((_, i) => i !== index))
  }

  const canDelete = photos.length > minCount

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <div>
        <Button type="button" onClick={() => inputRef.current?.click()}>
          {t('tenants.detail.photos.upload')}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!canDelete && photos.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('tenants.detail.photos.deleteBlockedTenant')}
        </p>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <PhotoThumbnail
              key={photo.path}
              photo={photo}
              canDelete={canDelete}
              onDelete={() => handleDelete(index)}
              onClick={() => setLightboxPhoto(photo)}
              t={t}
            />
          ))}
        </div>
      )}

      <Dialog
        open={lightboxPhoto !== null}
        onOpenChange={(open) => !open && setLightboxPhoto(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogTitle className="sr-only">{lightboxPhoto?.name}</DialogTitle>
          <LightboxImage photo={lightboxPhoto} t={t} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
