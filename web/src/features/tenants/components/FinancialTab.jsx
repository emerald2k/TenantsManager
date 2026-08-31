import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { RetryButton } from '@/components/shared/RetryButton'
import { formatMonthYearLabel } from '@/features/dashboard/calculations'
import { formatCurrency } from '@/lib/formatCurrency'
import { useReportsForUser } from '@/features/reports/hooks'

/**
 * The Financial history tab (SRS §5.3: "all reports, status + link"). Lists
 * every monthly report for this tenant ACCOUNT — every status, across every
 * tenancy the account has held (FR-TEN-15) — newest first, each row linking to
 * that month's report at `/admin/reports/:tenancyId?month=&year=`.
 *
 * Built in M3-D (`eae6ac3`) as a hardcoded empty state, with the note "real
 * content lands with M4". The follow-up never happened: M4/M5 built
 * `monthlyReports` and the tenant-facing `/app/history`, but this admin tab
 * kept showing "no reports yet" against accounts with a full signed history
 * (UI/UX audit 2026-08-31, finding #1). Wired to real data here. NOT an
 * FR-REP-14 re-keying regression — the tab never queried anything at all.
 */
function ReportRow({ report }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  function open() {
    navigate(
      `/admin/reports/${report.tenancyId}?month=${report.month}&year=${report.year}`,
    )
  }

  return (
    <tr
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      tabIndex={0}
      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
    >
      <td className="px-4 py-2 align-middle font-medium text-foreground">
        {formatMonthYearLabel(report.month, report.year, i18n.language)}
      </td>
      <td className="px-4 py-2 text-right align-middle tabular-nums">
        {formatCurrency(report.finalTotal)}
      </td>
      <td className="px-4 py-2 align-middle text-muted-foreground">
        {t(
          report.status === 'signed'
            ? 'tenants.detail.financial.statusSigned'
            : 'tenants.detail.financial.statusDraft',
        )}
      </td>
      {/* NFR-UX-06 rule 3 — a permanent static mark so a touch user sees the
          row is actionable before pressing it. */}
      <td className="w-6 px-2 py-2 text-right align-middle">
        <ChevronRight
          className="inline size-4 text-muted-foreground"
          aria-hidden="true"
        />
      </td>
    </tr>
  )
}

export function FinancialTab({ userId }) {
  const { t } = useTranslation()
  const {
    data: reports,
    isPending,
    isError,
    isFetching,
    refetch,
  } = useReportsForUser(userId)

  if (isPending) {
    return (
      <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">
          {t('tenants.detail.financial.error')}
        </p>
        <RetryButton onRetry={refetch} disabled={isFetching} />
      </div>
    )
  }

  if (reports.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('tenants.detail.financial.empty')}
      </p>
    )
  }

  return (
    <table className="w-full text-left text-sm">
      <tbody>
        {reports.map((report) => (
          <ReportRow key={report.id} report={report} />
        ))}
      </tbody>
    </table>
  )
}
