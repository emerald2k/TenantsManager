import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LineAttachments } from '@/features/reports/components/LineAttachments'

/** The "Other expenses" dynamic list (FR-REP-01a: description + amount, free
 * list, add/remove) — each row also has its own attachments zone
 * (FR-DOC-01…05). Backed by the parent's `useFieldArray` — this component
 * only renders the rows and forwards add/remove. */
export function OtherExpensesList({
  fields,
  register,
  control,
  errors,
  onAdd,
  onRemove,
  t,
  disabled = false,
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {t('reports.sections.otherExpenses')}
        </h2>
        <Button type="button" size="sm" onClick={onAdd} disabled={disabled}>
          {t('reports.otherExpenses.add')}
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('reports.otherExpenses.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {fields.map((field, index) => (
            <div key={field.id} className="flex flex-col gap-2">
              <div className="grid grid-cols-[1fr_140px_1fr_auto] items-start gap-3">
                <div className="flex flex-col gap-1">
                  <Input
                    placeholder={t('reports.fields.description')}
                    disabled={disabled}
                    {...register(`otherExpenses.${index}.description`)}
                  />
                  {errors?.[index]?.description && (
                    <p className="text-xs text-destructive">
                      {t(errors[index].description.message)}
                    </p>
                  )}
                </div>
                <Input
                  type="number"
                  step="any"
                  aria-label={t('reports.fields.amount')}
                  disabled={disabled}
                  {...register(`otherExpenses.${index}.amount`, {
                    valueAsNumber: true,
                  })}
                />
                <Input
                  placeholder={t('reports.fields.notes')}
                  disabled={disabled}
                  {...register(`otherExpenses.${index}.notes`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(index)}
                  disabled={disabled}
                >
                  {t('reports.otherExpenses.remove')}
                </Button>
              </div>
              <LineAttachments
                control={control}
                prefix={`otherExpenses.${index}`}
                t={t}
                disabled={disabled}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
