import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { adaptTenantReportSummary } from '@/features/tenantApp/reportAdapter'
import { ReportSummaryView } from '@/components/shared/ReportSummaryView'

// The adapter takes the i18n `t` (audit #4 — catalog service names
// re-translate at adapt time). Stubs, one per language, mapping only the
// catalog keys this fixture uses; anything else is echoed back.
const RO = {
  'properties.services.electricity': 'Electricitate',
  'properties.services.gas': 'Gaz',
}
const EN = {
  'properties.services.electricity': 'Electricity',
  'properties.services.gas': 'Gas',
}
const t = (key) => RO[key] ?? key
const tEn = (key) => EN[key] ?? key

// Fixture shaped like functions/scripts/seed.js's signedReport() — hand-copied,
// NOT imported: functions/ and web/ are separate packages with no shared
// import path in this monorepo (same boundary CLAUDE.md §7 documents for the
// duplicated KYC schema). This copy CAN diverge from the real seed.js over
// time — A5 below and the browser-validation step (M5 sub-stage 2 plan) are
// what actually catch real divergence, not this file alone.
function seedShapedReport(overrides = {}) {
  return {
    ownerId: 'admin-uid',
    propertyId: 'prop-1',
    tenancyId: 'tenancy-1',
    userId: 'tenant-1',
    month: 7,
    year: 2026,
    rent: { amount: 2500, notes: '', attachments: [] },
    maintenance: { amount: 0, notes: '', attachments: [] },
    serviceCosts: [
      {
        serviceId: 'electricity',
        name: 'Electricitate',
        amount: 150,
        notes: '',
        attachments: [],
      },
      {
        serviceId: 'gas',
        name: 'Gaz',
        amount: 80,
        notes: '',
        attachments: [],
      },
    ],
    otherExpenses: [],
    previousMonthArrears: 0,
    previousMonthCredit: 0,
    calculatedTotal: 2730,
    finalTotal: 2730,
    dueDate: '2026-07-10',
    status: 'signed',
    shareToken: 'tok-abc',
    shareTokenRevoked: false,
    ...overrides,
  }
}

describe('adaptTenantReportSummary', () => {
  it('A1 — maps a seed-shaped document to exactly the fields ReportSummaryView reads', () => {
    const report = seedShapedReport({
      rent: {
        amount: 2500,
        notes: 'nota chirie',
        attachments: [
          {
            name: 'rent.pdf',
            type: 'pdf',
            path: 'reports/prop-1_2026-07/invoices/rent.pdf',
          },
        ],
      },
    })

    expect(adaptTenantReportSummary(report, t)).toEqual({
      month: 7,
      year: 2026,
      rent: {
        amount: 2500,
        notes: 'nota chirie',
        attachments: [
          {
            name: 'rent.pdf',
            type: 'pdf',
            path: 'reports/prop-1_2026-07/invoices/rent.pdf',
          },
        ],
      },
      maintenance: { amount: 0, notes: '', attachments: [] },
      serviceCosts: [
        { name: 'Electricitate', amount: 150, notes: '', attachments: [] },
        { name: 'Gaz', amount: 80, notes: '', attachments: [] },
      ],
      otherExpenses: [],
      previousMonthArrears: 0,
      previousMonthCredit: 0,
      roundingSurplus: 0,
      calculatedTotal: 2730,
      finalTotal: 2730,
      dueDate: '2026-07-10',
      paymentStatus: null,
      amountPaid: null,
    })
  })

  it('A2 — never leaks internal/ownership fields, even under a spread-bug', () => {
    const output = adaptTenantReportSummary(seedShapedReport(), t)
    const keys = Object.keys(output)
    for (const forbidden of [
      'ownerId',
      'propertyId',
      'tenancyId',
      'userId',
      'status',
      'shareToken',
      'shareTokenRevoked',
      'propertyName',
    ]) {
      expect(keys).not.toContain(forbidden)
    }
    expect(output.serviceCosts.every((line) => !('serviceId' in line))).toBe(
      true,
    )
  })

  it('A3 — attachment path passes through unmodified (string equality, debt #5 — never a download url)', () => {
    const report = seedShapedReport({
      rent: {
        amount: 2500,
        notes: '',
        attachments: [
          {
            name: 'invoice.pdf',
            type: 'pdf',
            path: 'reports/prop-1_2026-07/invoices/invoice.pdf',
          },
        ],
      },
    })
    const output = adaptTenantReportSummary(report, t)
    expect(output.rent.attachments[0].path).toBe(
      'reports/prop-1_2026-07/invoices/invoice.pdf',
    )
    expect(output.rent.attachments[0]).not.toHaveProperty('url')
  })

  it('A4 — graceful defaults when optional fields are absent (deliberately-unpaid fixture)', () => {
    const report = seedShapedReport()
    delete report.paymentStatus
    delete report.amountPaid
    const output = adaptTenantReportSummary(report, t)
    expect(output.paymentStatus).toBeNull()
    expect(output.amountPaid).toBeNull()
    expect(output.previousMonthArrears).toBe(0)
    expect(output.otherExpenses).toEqual([])
  })

  it('A5 — integration: adapter output actually renders through ReportSummaryView', async () => {
    const report = seedShapedReport({
      rent: {
        amount: 2500,
        notes: '',
        attachments: [
          {
            name: 'rent-invoice.pdf',
            type: 'pdf',
            path: 'reports/prop-1_2026-07/invoices/rent-invoice.pdf',
          },
        ],
      },
    })

    await renderWithProviders(
      <ReportSummaryView
        data={adaptTenantReportSummary(report, t)}
        propertyName="Apartament Test"
      />,
    )

    expect(screen.getByText('Apartament Test')).toBeVisible()
    expect(screen.getByText('2.500,00 lei')).toBeVisible() // rent
    expect(screen.getByText('150,00 lei')).toBeVisible() // electricity
    expect(screen.getByText('80,00 lei')).toBeVisible() // gas
    expect(screen.getByText('2.730,00 lei')).toBeVisible() // finalTotal
    expect(screen.getByText('Electricitate')).toBeVisible()
    expect(screen.getByText('Gaz')).toBeVisible()
    expect(screen.getByText('rent-invoice.pdf (pdf)')).toBeVisible()
  })

  it('A6 — a catalog service re-translates to the reading language; a custom one keeps its stored name (audit #4)', () => {
    const report = seedShapedReport({
      serviceCosts: [
        {
          serviceId: 'electricity',
          name: 'Electricitate',
          amount: 150,
          notes: '',
          attachments: [],
        },
        {
          serviceId: 'a8b85d43-8569-4c0e-9b1e-000000000000',
          name: 'Salubritate',
          amount: 40,
          notes: '',
          attachments: [],
        },
      ],
    })

    const en = adaptTenantReportSummary(report, tEn)
    expect(en.serviceCosts.map((l) => l.name)).toEqual([
      'Electricity',
      'Salubritate',
    ])
    // serviceId is consumed, never forwarded (A2's invariant, restated for
    // the translated path).
    expect(en.serviceCosts.every((l) => !('serviceId' in l))).toBe(true)
  })
})
