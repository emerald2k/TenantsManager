import { useRef, useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import imageCompression from 'browser-image-compression'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { storage } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { useUpdateDraft } from '@/features/onboarding/hooks'
import { useAttachmentUrl } from '@/lib/useAttachmentUrl'

const MAX_SIZE_BYTES = 10 * 1024 * 1024

const COMPRESSION_OPTIONS = {
  maxWidthOrHeight: 2000,
  initialQuality: 0.8,
  useWebWorker: true,
}

/** Reads a (possibly nested) field's validation error via its dot path, e.g.
 * `idDocumentPhotos` or `guarantor.idDocumentPhotos`. `useFormContext`'s `errors`
 * object nests exactly like the schema — a plain reduce walks it. */
function getNestedError(errors, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], errors)
}

/**
 * One captured photo, resolved from its stored `path` (debt #5) to a real
 * download URL via `useAttachmentUrl` at render time — never a persisted URL.
 * A sub-component per element: `useAttachmentUrl` is a hook, so it cannot be
 * called from inside the parent's `.map()`.
 */
function PhotoThumbnail({ photo, onDelete, t }) {
  const { url, isLoading } = useAttachmentUrl(photo.path)

  return (
    <div className="relative">
      {url ? (
        <img
          src={url}
          alt={photo.name}
          className="aspect-square w-full rounded-md border border-border object-cover"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-md border border-border bg-muted text-center text-xs text-muted-foreground">
          {isLoading ? t('common.loading') : t('common.attachmentUnavailable')}
        </div>
      )}
      <Button
        type="button"
        variant="destructive"
        size="xs"
        className="absolute top-1 right-1"
        onClick={onDelete}
      >
        {t('onboarding.wizard.photoCapture.delete')}
      </Button>
    </div>
  )
}

/**
 * Step 2 (tenant ID photos, FR-TEN-03) and Step 3 (guarantor ID photos, FR-TEN-06)
 * share this component — the field it writes to is the only thing that differs
 * (`fieldPath`), passed in by the caller.
 *
 * Direct camera capture only (SRS §5.6): the file input's `capture` attribute
 * opens the native camera, no custom camera UI. Each invocation of the button
 * captures exactly ONE photo — repeatable, not a multi-select gallery picker.
 *
 * Photos upload to Storage IMMEDIATELY on capture, to a flat `/drafts/{draftId}/`
 * folder (SRS §6) — not staged in memory for a later batch save. The draft only
 * ever holds the Storage references (`{ path, name, type }`, `storageReferenceSchema`
 * in schema.js), so it autosaves via `useUpdateDraft` right after each add/delete,
 * independently of the wizard's Back/Continue autosave.
 *
 * Deleting a SINGLE captured photo here is best-effort on the Storage side: a
 * failed Storage delete must never block removing the reference from the draft.
 * Whole-draft deletion is a different operation — it goes through the
 * `deleteOnboardingDraft` Cloud Function, which DOES guarantee the
 * `drafts/{draftId}/` prefix is cleared (FR-TEN-25).
 */
export function PhotoCapture({ draftId, fieldPath, required }) {
  const { t } = useTranslation()
  const {
    watch,
    setValue,
    formState: { errors },
  } = useFormContext()
  const updateDraft = useUpdateDraft()
  const inputRef = useRef(null)
  const [error, setError] = useState(null)

  const photos = watch(fieldPath) ?? []
  const fieldError = getNestedError(errors, fieldPath)

  function persist(nextPhotos) {
    setValue(fieldPath, nextPhotos, { shouldDirty: true })
    updateDraft.mutate({ id: draftId, values: { [fieldPath]: nextPhotos } })
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
    const path = `drafts/${draftId}/${crypto.randomUUID()}-${file.name}`
    const objectRef = ref(storage, path)
    await uploadBytes(objectRef, compressed)

    persist([
      ...photos,
      { path: objectRef.fullPath, name: file.name, type: 'image' },
    ])
  }

  async function handleDelete(index) {
    const target = photos[index]
    try {
      await deleteObject(ref(storage, target.path))
    } catch {
      // Best-effort: the reference leaving the draft is what matters. A
      // leftover object is swept later — on finalize (kyc.js) or when the
      // whole draft is deleted (deleteOnboardingDraft, FR-TEN-25).
    }
    persist(photos.filter((_, i) => i !== index))
  }

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
      <Button type="button" onClick={() => inputRef.current?.click()}>
        {t('onboarding.wizard.photoCapture.button')}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {required && fieldError && (
        <p className="text-sm text-destructive">{t(fieldError.message)}</p>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {photos.map((photo, index) => (
            <PhotoThumbnail
              key={photo.path}
              photo={photo}
              onDelete={() => handleDelete(index)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}
