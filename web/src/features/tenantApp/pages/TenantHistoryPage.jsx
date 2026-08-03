import { useTranslation } from 'react-i18next'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { useAuth } from '@/features/auth/useAuth'
import { useMyTenancy, useMySignedReports } from '@/features/tenantApp/hooks'
import { groupReportsByYear } from '@/features/tenantApp/groupReportsByYear'
import { ReportHistoryRow } from '@/features/tenantApp/components/ReportHistoryRow'

/**
 * `/app/history` — the tenant's report history (FR-TAPP-02, SRS §5.4, M5
 * sub-stage 5 plan). An accordion grouped by year, all years closed on
 * first render (Radix's own default: `type="multiple"`, no `defaultValue`).
 * Each year holds one `ReportHistoryRow` per signed report, in the hook's
 * own order — no re-sort here.
 *
 * `useMyTenancy` is called for ONE reason only: telling "no tenancy at all"
 * apart from "tenancy exists, zero signed reports" — no tenancy field is
 * otherwise displayed on this page (same reasoning as the dashboard,
 * sub-stage 3).
 *
 * Rows are deliberately non-interactive this sub-stage — the click-through
 * to `/app/reports/:reportId` is sub-stage 6, which does not exist yet.
 */
export function TenantHistoryPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const tenancyQuery = useMyTenancy(user.uid)
  const reportsQuery = useMySignedReports(user.uid)

  if (tenancyQuery.isPending || reportsQuery.isPending) {
    return (
      <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (tenancyQuery.isError || reportsQuery.isError) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('tenantApp.history.error')}
      </p>
    )
  }

  const tenancy = tenancyQuery.data
  if (!tenancy) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('tenantApp.history.noTenancy')}
      </p>
    )
  }

  const groups = groupReportsByYear(reportsQuery.data)
  if (groups.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('tenantApp.history.empty')}
      </p>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Accordion type="multiple">
        {groups.map((group) => (
          <AccordionItem key={group.year} value={String(group.year)}>
            <AccordionTrigger>{group.year}</AccordionTrigger>
            <AccordionContent>
              <table className="w-full text-left text-sm">
                <tbody>
                  {group.reports.map((report) => (
                    <ReportHistoryRow key={report.id} report={report} />
                  ))}
                </tbody>
              </table>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
