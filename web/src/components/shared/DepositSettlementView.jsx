import { useTranslation } from 'react-i18next'
import { AttachmentLink } from '@/components/shared/AttachmentLink'
import { formatCurrency } from '@/lib/formatCurrency'
import { formatFullDate } from '@/lib/formatDate'

/**
 * The read-only deposit settlement (FR-CON-10/11/12, M8 stage 6) — shared,
 * unmodified, by the admin's Tenancy tab AND the tenant portal's
 * `/app/contract` (FR-TAPP-07): one component, one set of i18n keys under
 * `tenants.detail.tenancy.settlement.*`, the same reuse-across-surfaces convention
 * `ReportSummaryView` already established for `reports.fields.*`.
 *
 * `ownerBears` and `toReturn` are mutually exclusive by construction
 * (`computeDepositSettlement`, depositSettlementSchema.js) — never both
 * shown. `ownerBears` renders in the destructive color deliberately: it is a
 * cost with nowhere else in the product to land (no owner-cost ledger yet,
 * FR-CON-10), so it should read as attention-worthy, not as a routine total.
 */
export function DepositSettlementView({ securityDeposit, depositSettlement }) {
  const { t, i18n } = useTranslation()
  const items = depositSettlement.items ?? []

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">
        {t('tenants.detail.tenancy.settlement.title')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t('tenants.detail.tenancy.settlement.depositHeld', {
          value: formatCurrency(securityDeposit ?? 0),
        })}
      </p>

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li key={index} className="flex flex-col gap-1 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-foreground">{item.description}</span>
                <span className="shrink-0 font-medium text-foreground">
                  {formatCurrency(item.amount)}
                </span>
              </div>
              {(item.attachments ?? []).length > 0 && (
                <div className="flex flex-col gap-1 pl-2">
                  {item.attachments.map((attachment, attachmentIndex) => (
                    <AttachmentLink
                      key={attachmentIndex}
                      attachment={attachment}
                      downloadLabel={t(
                        'tenants.detail.tenancy.settlement.downloadLabel',
                      )}
                    />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {t('tenants.detail.tenancy.settlement.deducted')}
          </span>
          <span className="font-medium text-foreground">
            {formatCurrency(depositSettlement.deducted ?? 0)}
          </span>
        </div>
        {depositSettlement.ownerBears > 0 ? (
          <div className="flex justify-between">
            <span className="text-destructive">
              {t('tenants.detail.tenancy.settlement.ownerBears')}
            </span>
            <span className="font-medium text-destructive">
              {formatCurrency(depositSettlement.ownerBears)}
            </span>
          </div>
        ) : (
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t('tenants.detail.tenancy.settlement.toReturn')}
            </span>
            <span className="font-medium text-foreground">
              {formatCurrency(depositSettlement.toReturn ?? 0)}
            </span>
          </div>
        )}
      </div>

      {depositSettlement.settledAt && (
        <p className="text-xs text-muted-foreground">
          {t('tenants.detail.tenancy.settlement.settledAt', {
            date: formatFullDate(depositSettlement.settledAt, i18n.language),
          })}
        </p>
      )}
    </div>
  )
}
