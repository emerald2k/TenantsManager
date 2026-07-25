import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** The "Other expenses" dynamic list (FR-REP-01a: description + amount, free
 * list, add/remove). Backed by the parent's `useFieldArray` — this component
 * only renders the rows and forwards add/remove. */
export function OtherExpensesList({
  fields,
  register,
  errors,
  onAdd,
  onRemove,
  t,
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {t('reports.sections.otherExpenses')}
        </h2>
        <Button type="button" size="sm" onClick={onAdd}>
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
            <div
              key={field.id}
              className="grid grid-cols-[1fr_140px_1fr_auto] items-start gap-3"
            >
              <div className="flex flex-col gap-1">
                <Input
                  placeholder={t('reports.fields.description')}
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
                {...register(`otherExpenses.${index}.amount`, {
                  valueAsNumber: true,
                })}
              />
              <Input
                placeholder={t('reports.fields.notes')}
                {...register(`otherExpenses.${index}.notes`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRemove(index)}
              >
                {t('reports.otherExpenses.remove')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
