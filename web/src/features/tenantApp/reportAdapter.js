/**
 * Pure adapter: a raw, owner-read `monthlyReports` document (the shape a
 * tenant is allowed to read under the own+signed Firestore rule) into
 * exactly the shape `ReportSummaryView` renders (M5 sub-stage 2 plan,
 * docs/superpowers/plans/2026-08-02-m5-substage2-hooks-report-adapter.md).
 * No I/O, no tenancy lookup, no `propertyName` (the caller passes that as
 * ReportSummaryView's own prop, sourced from `tenancies.property.name`).
 *
 * Unlike `functions/src/sharedReport.js`'s `toPublicReport` (built for an
 * ANONYMOUS audience, which proxies attachment bytes behind an opaque
 * `reference`), this adapter serves an authenticated tenant reading their
 * OWN signed document — attachment `path`s (bucket-relative Storage paths,
 * debt #5, never a download URL) pass through unmodified; the caller resolves
 * each one to a real URL at render time via `useAttachmentUrl`.
 */

function mapAttachments(attachments) {
  return (attachments ?? []).map((att) => ({
    name: att.name,
    type: att.type,
    path: att.path,
  }))
}

export function adaptTenantReportSummary(report) {
  return {
    month: report.month,
    year: report.year,
    rent: {
      amount: report.rent.amount,
      notes: report.rent.notes ?? null,
      attachments: mapAttachments(report.rent.attachments),
    },
    maintenance: {
      amount: report.maintenance.amount,
      notes: report.maintenance.notes ?? null,
      attachments: mapAttachments(report.maintenance.attachments),
    },
    serviceCosts: (report.serviceCosts ?? []).map((line) => ({
      name: line.name,
      amount: line.amount,
      notes: line.notes ?? null,
      attachments: mapAttachments(line.attachments),
    })),
    otherExpenses: (report.otherExpenses ?? []).map((line) => ({
      description: line.description,
      amount: line.amount,
      notes: line.notes ?? null,
      attachments: mapAttachments(line.attachments),
    })),
    previousMonthArrears: report.previousMonthArrears ?? 0,
    previousMonthCredit: report.previousMonthCredit ?? 0,
    calculatedTotal: report.calculatedTotal,
    finalTotal: report.finalTotal,
    dueDate: report.dueDate,
    paymentStatus: report.paymentStatus ?? null,
    amountPaid: report.amountPaid ?? null,
  }
}
