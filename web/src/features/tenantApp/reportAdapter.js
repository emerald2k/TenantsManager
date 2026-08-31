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
 *
 * `t` is the i18n translator (`useTranslation().t`), passed by the calling
 * page. It is used ONLY to resolve a catalog service's display name into the
 * reading language (2026-08-31 UI/UX audit, finding #4): `serviceId` is
 * consumed HERE and never enters the output, so the adapter keeps emitting
 * exactly the display fields `ReportSummaryView` reads — no internal keys.
 */

import { serviceLabel } from '@/features/properties/serviceCatalog'

function mapAttachments(attachments) {
  return (attachments ?? []).map((att) => ({
    name: att.name,
    type: att.type,
    path: att.path,
  }))
}

export function adaptTenantReportSummary(report, t) {
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
      // Catalog services re-translate; a custom service keeps its stored
      // name. `serviceId` is read here, not forwarded.
      name: serviceLabel(line, t),
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
    roundingSurplus: report.roundingSurplus ?? 0,
    calculatedTotal: report.calculatedTotal,
    finalTotal: report.finalTotal,
    dueDate: report.dueDate,
    paymentStatus: report.paymentStatus ?? null,
    amountPaid: report.amountPaid ?? null,
  }
}
