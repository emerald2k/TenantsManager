import { useTranslation } from 'react-i18next'
import { AttachmentLink } from '@/components/shared/AttachmentLink'
import { DepositSettlementView } from '@/components/shared/DepositSettlementView'
import { RetryButton } from '@/components/shared/RetryButton'
import { useAuth } from '@/features/auth/useAuth'
import { useMyTenancy } from '@/features/tenantApp/hooks'
import { formatCurrency } from '@/lib/formatCurrency'
import { formatFullDate } from '@/lib/formatDate'

/**
 * `/app/contract` — property/contract data + signed-contract download
 * (FR-TAPP-03, SRS §5.4, M5 sub-stage 7 plan). All data comes from the
 * tenancy document only (`property`, dates, rent, deposit, dueDay) — never
 * `properties` directly (FR-TEN-09). `useMyTenancy` already resolves to the
 * active tenancy, or else the most-recently-ended one, or `null`; reused
 * as-is, unmodified from sub-stage 2.
 *
 * The documents section is its OWN, flat list straight off
 * `tenancy.attachedDocuments[]` — deliberately NOT the report-detail page's
 * attachments component, which groups by cost line (irrelevant here).
 *
 * The deposit settlement (FR-TAPP-07, FR-CON-12, M8 stage 6) is the one
 * thing this page DOES read `tenancy.status` for: it only ever appears once
 * the tenancy has ended AND the administrator has actually completed a
 * settlement — `DepositSettlementView` is the exact same component the
 * admin's Tenancy tab shows, so the tenant sees precisely what was recorded.
 * Rent arrears are deliberately not part of it (FR-CON-11) — an unpaid
 * balance stays visible elsewhere in the portal, unaffected by this section.
 */

function formatAddress(address) {
  if (!address) return '—'
  return `${address.street} ${address.number}, ${address.city}`
}

function ContractField({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  )
}

export function TenantContractPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const tenancyQuery = useMyTenancy(user.uid)

  if (tenancyQuery.isPending) {
    return (
      <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (tenancyQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-2 p-6">
        <p className="text-sm text-muted-foreground">
          {t('tenantApp.contract.error')}
        </p>
        <RetryButton
          onRetry={tenancyQuery.refetch}
          disabled={tenancyQuery.isFetching}
        />
      </div>
    )
  }

  const tenancy = tenancyQuery.data
  if (!tenancy) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('tenantApp.contract.noTenancy')}
      </p>
    )
  }

  const documents = tenancy.attachedDocuments ?? []

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {tenancy.property?.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatAddress(tenancy.property?.address)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ContractField
            label={t('tenantApp.contract.fields.startDate')}
            value={formatFullDate(tenancy.startDate, i18n.language)}
          />
          <ContractField
            label={t('tenantApp.contract.fields.endDate')}
            value={formatFullDate(tenancy.endDate, i18n.language)}
          />
          <ContractField
            label={t('tenantApp.contract.fields.monthlyRent')}
            value={formatCurrency(tenancy.monthlyRent)}
          />
          <ContractField
            label={t('tenantApp.contract.fields.securityDeposit')}
            value={
              tenancy.securityDeposit != null
                ? formatCurrency(tenancy.securityDeposit)
                : '—'
            }
          />
          <ContractField
            label={t('tenantApp.contract.fields.dueDay')}
            value={tenancy.dueDay}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t('tenantApp.contract.documents.title')}
        </h3>
        {documents.length > 0 ? (
          documents.map((doc, index) => (
            <AttachmentLink
              key={index}
              attachment={doc}
              downloadLabel={t('tenantApp.contract.documents.download')}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('tenantApp.contract.documents.empty')}
          </p>
        )}
      </div>

      {tenancy.status === 'ended' && tenancy.depositSettlement && (
        <DepositSettlementView
          securityDeposit={tenancy.securityDeposit}
          depositSettlement={tenancy.depositSettlement}
        />
      )}
    </div>
  )
}
