import { Input } from '@/components/ui/input'
import { LineAttachments } from '@/features/reports/components/LineAttachments'

/**
 * One cost line — rent, maintenance, or a service (SRS §5.3: "name | amount |
 * notes" + an attachments zone, FR-DOC-01…05). `prefix` is the RHF field path
 * ("rent", "maintenance", "serviceCosts.0"...) so the same row markup serves
 * all three without knowing which one it is.
 */
export function CostLineRow({
  label,
  prefix,
  register,
  control,
  error,
  t,
  disabled = false,
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-0">
      <div className="grid grid-cols-[1fr_140px_1fr] items-start gap-3">
        <span className="pt-2 text-sm font-medium text-foreground">
          {label}
        </span>
        <div className="flex flex-col gap-1">
          <Input
            type="number"
            step="any"
            aria-label={label}
            disabled={disabled}
            {...register(`${prefix}.amount`, { valueAsNumber: true })}
          />
          {error && (
            <p className="text-xs text-destructive">{t(error.message)}</p>
          )}
        </div>
        <Input
          placeholder={t('reports.fields.notes')}
          disabled={disabled}
          {...register(`${prefix}.notes`)}
        />
      </div>
      <LineAttachments
        control={control}
        prefix={prefix}
        t={t}
        disabled={disabled}
      />
    </div>
  )
}
