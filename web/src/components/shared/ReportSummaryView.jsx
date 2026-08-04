import { useTranslation } from 'react-i18next'
import { formatCurrency } from '@/lib/formatCurrency'

/**
 * Purely presentational, read-only summary of a signed report (M4 sub-stage
 * 8 plan). Consumes the SAME shape `getSharedReportCore`'s allowlist
 * returns (functions/src/sharedReport.js's `toPublicReport`) — used by:
 *  - SharedReportPage (/r/:shareToken) — fed directly by getSharedReport.
 *  - ExportReportControls — fed by `toReportSummaryData(existingReport,
 *    property)`, as the html2canvas capture target for PDF/PNG.
 *
 * Because both surfaces render the SAME component off the SAME shape, the
 * admin's exported PDF/PNG can never structurally show more than what the
 * public link already shows.
 *
 * Attachments render as inert name+type badges — NEVER images, NEVER a
 * click handler. This project has no Storage CORS configuration anywhere,
 * so rasterizing a cross-origin Storage image into a <canvas> (html2canvas)
 * would taint it (blank/broken output). Interactive attachment download,
 * where it's actually needed, is a separate concern the caller owns (see
 * SharedReportPage's own Attachments section, proxied through
 * getSharedReportAttachment).
 */

function AttachmentBadge({ name, type }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {name} ({type})
    </span>
  )
}

function SummaryLineRow({ label, amount, notes, attachments }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2 align-top font-medium text-foreground">
        {label}
      </td>
      <td className="px-4 py-2 text-right align-top tabular-nums">
        {formatCurrency(amount)}
      </td>
      <td className="px-4 py-2 align-top text-muted-foreground">
        {notes}
        {attachments?.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {attachments.map((att, index) => (
              <AttachmentBadge key={index} name={att.name} type={att.type} />
            ))}
          </div>
        )}
      </td>
    </tr>
  )
}

// Reuses the SAME keys PaymentSection already shows the admin (reports.payment.*)
// — no new vocabulary for the same three states. Exported (M5 sub-stage 3)
// so PaymentStatusBadge can extend it with a fourth key instead of
// hand-copying these three.
export const PAYMENT_STATUS_KEY = {
  paid: 'reports.payment.statusPaid',
  partial: 'reports.payment.statusPartial',
  unpaid: 'reports.payment.statusUnpaid',
}

/**
 * @param data the allowlist shape: { propertyName, month, year, rent,
 *   maintenance, serviceCosts[], otherExpenses[], previousMonthArrears,
 *   previousMonthCredit, calculatedTotal, finalTotal, dueDate,
 *   paymentStatus, amountPaid }. Each cost line's `attachments[]` needs
 *   only `{ name, type }` — extra keys (e.g. `reference`, `url`) are
 *   ignored.
 * @param propertyName defaults to `data.propertyName` — every existing
 *   caller (SharedReportPage, ExportReportControls' toReportSummaryData)
 *   already embeds it inside `data`, so neither needs to change. A tenant
 *   caller (M5 sub-stage 2), whose adapter output has no `propertyName` key,
 *   passes this prop explicitly instead.
 * @param showCalculatedTotal defaults to `false` — reproduces the current
 *   output exactly (calculatedTotal has never been rendered here).
 * @param showPaymentStatus defaults to `true` — when `false`, the footer's
 *   payment-status row is not rendered at all (M5 sub-stage 3: the tenant
 *   dashboard owns its own four-state badge instead).
 * @param showHeader defaults to `true` — when `false`, the property-name/
 *   month header block is not rendered at all (M5 sub-stage 3: the tenant
 *   dashboard owns its own header instead).
 */
export function ReportSummaryView({
  data,
  propertyName = data.propertyName,
  showCalculatedTotal = false,
  showPaymentStatus = true,
  showHeader = true,
}) {
  const { t } = useTranslation()
  const paymentStatusKey = PAYMENT_STATUS_KEY[data.paymentStatus ?? 'unpaid']

  return (
    <div className="flex flex-col gap-4 bg-background p-6 text-sm">
      {showHeader && (
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {propertyName}
          </h2>
          <p className="text-muted-foreground">
            {data.month}/{data.year}
          </p>
        </div>
      )}

      <table className="w-full text-left">
        <tbody>
          <SummaryLineRow
            label={t('reports.sections.rent')}
            amount={data.rent.amount}
            notes={data.rent.notes}
            attachments={data.rent.attachments}
          />
          <SummaryLineRow
            label={t('reports.sections.maintenance')}
            amount={data.maintenance.amount}
            notes={data.maintenance.notes}
            attachments={data.maintenance.attachments}
          />
          {data.serviceCosts.map((line, index) => (
            <SummaryLineRow
              key={index}
              label={line.name}
              amount={line.amount}
              notes={line.notes}
              attachments={line.attachments}
            />
          ))}
          {data.otherExpenses.map((line, index) => (
            <SummaryLineRow
              key={index}
              label={line.description}
              amount={line.amount}
              notes={line.notes}
              attachments={line.attachments}
            />
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-1 border-t border-border pt-3">
        {showCalculatedTotal && (
          <div className="flex items-center justify-between">
            <span>{t('reports.fields.calculatedTotal')}</span>
            <span className="tabular-nums">
              {formatCurrency(data.calculatedTotal)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span>{t('reports.fields.previousArrears')}</span>
          <span className="tabular-nums">
            {formatCurrency(data.previousMonthArrears)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t('reports.fields.previousCredit')}</span>
          <span className="tabular-nums">
            {formatCurrency(data.previousMonthCredit)}
          </span>
        </div>
        <div className="flex items-center justify-between text-base font-semibold text-foreground">
          <span>{t('reports.fields.finalTotal')}</span>
          <span className="tabular-nums">
            {formatCurrency(data.finalTotal)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t('reports.fields.dueDate')}</span>
          <span>{data.dueDate}</span>
        </div>
        {showPaymentStatus && (
          <div className="flex items-center justify-between">
            <span>{t('reports.payment.title')}</span>
            <span>{t(paymentStatusKey)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
