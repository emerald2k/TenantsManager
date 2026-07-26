import { useRef, useState } from 'react'
import { useFieldArray } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { MAX_UPLOAD_SIZE_BYTES, classifyFileType } from '@/lib/fileUpload'

/**
 * The per-cost-line attachments zone (FR-DOC-01…05, M4 sub-stage 3). Shared
 * by `CostLineRow` (rent/maintenance/each service) and `OtherExpensesList`
 * (each row) — the add/remove/display logic is identical regardless of which
 * kind of line it's attached to.
 *
 * Owns its OWN `useFieldArray` on `${prefix}.attachments` — a nested field
 * array (an array inside one element of another array/object) needs its own
 * hook call scoped to that exact path; it cannot be driven from a single
 * top-level `useFieldArray` in the parent.
 *
 * Each entry is uniform: `{ url, name, type, file }` — exactly one of `url`
 * (already uploaded) or `file` (a raw `File`, picked but not yet uploaded) is
 * present. Removing EITHER kind is the same `remove(index)` call — nothing
 * here tracks "what got removed" for Storage cleanup; `useSaveReportDraft`
 * figures that out on its own, by diffing URL sets before/after save.
 *
 * No thumbnail for a pending (not-yet-uploaded) file — that would need
 * `URL.createObjectURL` + cleanup-on-unmount bookkeeping for no requested
 * benefit; a name + "pending" badge is enough until it's actually uploaded.
 */
export function LineAttachments({ control, prefix, t }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `${prefix}.attachments`,
  })
  const inputRef = useRef(null)
  const [error, setError] = useState(null)

  function handleFilesChosen(event) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    setError(null)

    for (const file of files) {
      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        setError(t('reports.attachments.tooLarge', { name: file.name }))
        continue
      }
      append({
        name: file.name,
        type: classifyFileType(file),
        file,
        url: undefined,
      })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,application/pdf,.doc,.docx"
        className="hidden"
        onChange={handleFilesChosen}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => inputRef.current?.click()}
        >
          {t('reports.attachments.add')}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {fields.length > 0 && (
        <ul className="flex flex-col gap-1">
          {fields.map((field, index) => (
            <li key={field.id} className="flex items-center gap-2 text-xs">
              {field.url ? (
                field.type === 'image' ? (
                  <img
                    src={field.url}
                    alt={field.name}
                    className="h-8 w-8 rounded border border-border object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border text-[0.6rem] font-medium text-muted-foreground">
                    {field.type.toUpperCase()}
                  </span>
                )
              ) : null}
              {field.url ? (
                <a
                  href={field.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-foreground underline"
                >
                  {field.name}
                </a>
              ) : (
                <span className="truncate text-muted-foreground">
                  {field.name} ({t('reports.attachments.pending')})
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => remove(index)}
              >
                {t('reports.attachments.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
