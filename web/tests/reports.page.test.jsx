import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { MonthlyReportPage } from '@/features/reports/pages/MonthlyReportPage'
import {
  useActiveTenancyForProperty,
  useProperty,
} from '@/features/properties/hooks'
import {
  useCancelPayment,
  useMarkPayment,
  useMonthlyReport,
  useRevokeShareLink,
  useSaveReportDraft,
  useSendReportNotification,
  useShareReport,
  useSignReport,
  useUnlockReport,
} from '@/features/reports/hooks'

// Fast band — the data hooks are mocked; hooks.js/schema.js's own behavior is
// covered by reports.hooks.test.jsx / reports.schema.test.js. This file only
// checks the SHELL: what renders, the live total, pre-fill vs. reopen, and
// (M4 sub-stage 4) the locked-when-signed state. `useSignReport`/
// `useUnlockReport` are mocked here too because `MonthlyReportPage` renders
// `SignReportControl`, which calls them directly — their own behavior is
// covered by `reports.hooks.test.jsx` / `reports.signReportControl.test.jsx`.

vi.mock('@/features/properties/hooks', () => ({
  useProperty: vi.fn(),
  useActiveTenancyForProperty: vi.fn(),
}))
vi.mock('@/features/reports/hooks', () => ({
  useMonthlyReport: vi.fn(),
  useSaveReportDraft: vi.fn(),
  useSignReport: vi.fn(),
  useUnlockReport: vi.fn(),
  useMarkPayment: vi.fn(),
  useCancelPayment: vi.fn(),
  useSendReportNotification: vi.fn(),
  useShareReport: vi.fn(),
  useRevokeShareLink: vi.fn(),
}))
// ExportReportControls' PDF/PNG buttons pull in real jsPDF/html2canvas —
// mocked here too (M4 sub-stage 8) so this unrelated wiring test never
// exercises the real canvas-capture/PDF-generation code.
vi.mock('jspdf', () => ({ jsPDF: vi.fn(function jsPDFMock() {}) }))
vi.mock('html2canvas', () => ({ default: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useParams: () => ({ propertyId: 'p1' }),
  useSearchParams: () => [
    new URLSearchParams({ month: '7', year: '2026' }),
    vi.fn(),
  ],
}))
// `LineAttachments` (via `CostLineRow`/`OtherExpensesList`) and
// `@/features/reports/attachments` both import `@/lib/fileUpload`, which
// imports the REAL `@/lib/firebase` — mocked here with the real (pure)
// classification logic so this file never touches Firebase, same as every
// other page test.
vi.mock('@/lib/fileUpload', () => ({
  MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
  classifyFileType: (file) => {
    if (file.type.startsWith('image/')) return 'image'
    if (file.type === 'application/pdf') return 'pdf'
    return 'doc'
  },
  uploadAttachment: vi.fn(),
  deleteAttachmentBestEffort: vi.fn(),
}))

const PROPERTY = {
  id: 'p1',
  ownerId: 'admin-uid',
  name: 'Downtown Apartment',
  services: [
    { serviceId: 'gas', name: 'Gas', source: 'catalog' },
    { serviceId: 'electricity', name: 'Electricity', source: 'catalog' },
  ],
}
const TENANCY = {
  id: 't1',
  userId: 'u1',
  tenantName: 'Ana Pop',
  monthlyRent: 1500,
  dueDay: 5,
}

function mockData({ report = null } = {}) {
  useProperty.mockReturnValue({
    data: PROPERTY,
    isPending: false,
    isError: false,
  })
  useActiveTenancyForProperty.mockReturnValue({
    data: TENANCY,
    isPending: false,
  })
  useMonthlyReport.mockReturnValue({ data: report, isPending: false })
}

const mutateAsync = vi.fn()
const signMutateAsync = vi.fn()
const unlockMutateAsync = vi.fn()
const markPaymentMutateAsync = vi.fn()
const cancelPaymentMutateAsync = vi.fn()
const sendNotificationMutateAsync = vi.fn()
const shareMutateAsync = vi.fn()
const revokeMutateAsync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue('p1_2026-07')
  useSaveReportDraft.mockReturnValue({ mutateAsync, isPending: false })
  signMutateAsync.mockResolvedValue({})
  unlockMutateAsync.mockResolvedValue({})
  useSignReport.mockReturnValue({
    mutateAsync: signMutateAsync,
    isPending: false,
  })
  useUnlockReport.mockReturnValue({
    mutateAsync: unlockMutateAsync,
    isPending: false,
  })
  // PaymentSection renders whenever isLocked is true (SIGNED_REPORT fixtures
  // below) — mocked here so those pre-existing sub-stage 4 tests don't crash
  // now that they render it as a side effect.
  markPaymentMutateAsync.mockResolvedValue({})
  cancelPaymentMutateAsync.mockResolvedValue({})
  useMarkPayment.mockReturnValue({
    mutateAsync: markPaymentMutateAsync,
    isPending: false,
  })
  useCancelPayment.mockReturnValue({
    mutateAsync: cancelPaymentMutateAsync,
    isPending: false,
  })
  // SendReportNotificationControl renders whenever isLocked is true, same
  // reasoning as useMarkPayment/useCancelPayment above — mocked up front
  // this time (M4 sub-stage 6), not rediscovered at test-run time.
  sendNotificationMutateAsync.mockResolvedValue({})
  useSendReportNotification.mockReturnValue({
    mutateAsync: sendNotificationMutateAsync,
    isPending: false,
  })
  // ExportReportControls renders whenever isLocked is true, same reasoning
  // as useSendReportNotification above (M4 sub-stage 8).
  shareMutateAsync.mockResolvedValue({ token: 'tok', wrote: false })
  revokeMutateAsync.mockResolvedValue({})
  useShareReport.mockReturnValue({
    mutateAsync: shareMutateAsync,
    isPending: false,
  })
  useRevokeShareLink.mockReturnValue({
    mutateAsync: revokeMutateAsync,
    isPending: false,
  })
})

describe('MonthlyReportPage — draft (M4 sub-stage 1)', () => {
  it('shows every active service, including one saved with amount 0 (FR-REP-03)', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Gas')).toBeVisible()
    expect(screen.getByText('Electricity')).toBeVisible()
  })

  it('pre-fills rent from the tenancy and the due date from dueDay (FR-REP-02/05)', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    // Scoped by aria-label, not display value: finalTotal ALSO mirrors 1500
    // (sub-stage 2), so a bare display-value query would now match both.
    expect(await screen.findByLabelText('Chirie')).toHaveValue(1500)
    expect(screen.getByDisplayValue('2026-07-05')).toBeVisible()
  })

  it('recomputes the total live as an amount is edited (FR-REP-04)', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '100')

    expect(await screen.findByText('1.600,00 lei')).toBeVisible()
  })

  it('opens an existing draft with its SAVED values, not blank ones (FR-REP-14)', async () => {
    mockData({
      report: {
        id: 'p1_2026-07',
        rent: { amount: 1600, notes: '' },
        maintenance: { amount: 50, notes: '' },
        serviceCosts: [
          { serviceId: 'gas', name: 'Gas', amount: 80, notes: '' },
          {
            serviceId: 'electricity',
            name: 'Electricity',
            amount: 0,
            notes: '',
          },
        ],
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
        dueDate: '2026-07-10',
      },
    })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByDisplayValue('1600')).toBeVisible()
    expect(screen.getByDisplayValue('80')).toBeVisible()
    expect(screen.getByDisplayValue('2026-07-10')).toBeVisible()
  })

  it('shows an empty state instead of the form when the property has no active tenancy', async () => {
    useProperty.mockReturnValue({
      data: PROPERTY,
      isPending: false,
      isError: false,
    })
    useActiveTenancyForProperty.mockReturnValue({
      data: null,
      isPending: false,
    })
    useMonthlyReport.mockReturnValue({ data: null, isPending: false })

    await renderWithProviders(<MonthlyReportPage />)

    expect(
      await screen.findByText(
        'Această proprietate nu are o tenanță activă — nu se poate crea un raport.',
      ),
    ).toBeVisible()
  })

  it('adds and removes an "other expense" line', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    await user.click(screen.getByText('Adaugă cheltuială'))

    expect(screen.getByPlaceholderText('Descriere')).toBeVisible()

    await user.click(screen.getByText('Șterge'))
    expect(screen.queryByPlaceholderText('Descriere')).toBeNull()
  })
})

describe('MonthlyReportPage — finalTotal (M4 sub-stage 2, FR-REP-04a/04b)', () => {
  it('initializes finalTotal to the exact calculated total on a fresh report', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    // rent 1500 + maintenance 0 + gas 0 + electricity 0.
    expect(screen.getByLabelText('Total final')).toHaveValue(1500)
  })

  it('mirrors the total live while untouched — editing a line moves finalTotal too', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '100')

    expect(await screen.findByText('1.600,00 lei')).toBeVisible()
    expect(screen.getByLabelText('Total final')).toHaveValue(1600)
  })

  it('freezes once the admin edits finalTotal manually — further line edits do not move it', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    const finalTotalInput = screen.getByLabelText('Total final')
    await user.clear(finalTotalInput)
    await user.type(finalTotalInput, '1450')
    expect(finalTotalInput).toHaveValue(1450)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '100')

    // The reference total keeps moving...
    expect(await screen.findByText('1.600,00 lei')).toBeVisible()
    // ...but finalTotal, once hand-edited, no longer follows it.
    expect(finalTotalInput).toHaveValue(1450)
  })

  it('reopen with finalTotal == calculatedTotal (it was mirroring): editing a line still updates it', async () => {
    const user = userEvent.setup()
    mockData({
      report: {
        id: 'p1_2026-07',
        rent: { amount: 1500, notes: '' },
        maintenance: { amount: 0, notes: '' },
        serviceCosts: [
          { serviceId: 'gas', name: 'Gas', amount: 0, notes: '' },
          {
            serviceId: 'electricity',
            name: 'Electricity',
            amount: 0,
            notes: '',
          },
        ],
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
        calculatedTotal: 1500,
        finalTotal: 1500, // mirroring when it was last saved
        dueDate: '2026-07-05',
      },
    })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByLabelText('Total final')).toHaveValue(1500)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '75')

    expect(await screen.findByLabelText('Total final')).toHaveValue(1575)
  })

  it('reopen with finalTotal != calculatedTotal (manually diverged): frozen, editing a line does NOT move it', async () => {
    const user = userEvent.setup()
    mockData({
      report: {
        id: 'p1_2026-07',
        rent: { amount: 1500, notes: '' },
        maintenance: { amount: 0, notes: '' },
        serviceCosts: [
          { serviceId: 'gas', name: 'Gas', amount: 0, notes: '' },
          {
            serviceId: 'electricity',
            name: 'Electricity',
            amount: 0,
            notes: '',
          },
        ],
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
        calculatedTotal: 1500,
        finalTotal: 1450, // manually rounded down at an earlier save
        dueDate: '2026-07-05',
      },
    })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByLabelText('Total final')).toHaveValue(1450)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '75')

    expect(await screen.findByText('1.575,00 lei')).toBeVisible()
    expect(screen.getByLabelText('Total final')).toHaveValue(1450)
  })

  it('reopen an M4 sub-stage 1 draft with no finalTotal saved: mirrors (not frozen)', async () => {
    const user = userEvent.setup()
    mockData({
      report: {
        id: 'p1_2026-07',
        rent: { amount: 1500, notes: '' },
        maintenance: { amount: 0, notes: '' },
        serviceCosts: [
          { serviceId: 'gas', name: 'Gas', amount: 0, notes: '' },
          {
            serviceId: 'electricity',
            name: 'Electricity',
            amount: 0,
            notes: '',
          },
        ],
        otherExpenses: [],
        previousMonthArrears: 0,
        previousMonthCredit: 0,
        calculatedTotal: 1500,
        // no finalTotal key — pre-dates sub-stage 2
        dueDate: '2026-07-05',
      },
    })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByLabelText('Total final')).toHaveValue(1500)

    const maintenanceInput = (await screen.findAllByRole('spinbutton'))[1]
    await user.clear(maintenanceInput)
    await user.type(maintenanceInput, '75')

    expect(await screen.findByLabelText('Total final')).toHaveValue(1575)
  })

  it('submits finalTotal == calculatedTotal while still mirroring', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    await user.click(screen.getByText('Salvează draftul'))

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    const saved = mutateAsync.mock.calls[0][0].values
    expect(saved.finalTotal).toBe(1500)
    expect(saved.calculatedTotal).toBe(1500)
  })

  it('submits the hand-typed finalTotal once frozen, distinct from calculatedTotal', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    const finalTotalInput = screen.getByLabelText('Total final')
    await user.clear(finalTotalInput)
    await user.type(finalTotalInput, '1450')

    await user.click(screen.getByText('Salvează draftul'))

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    const saved = mutateAsync.mock.calls[0][0].values
    expect(saved.finalTotal).toBe(1450)
    expect(saved.calculatedTotal).toBe(1500)
  })
})

function makeFile({
  name = 'invoice.pdf',
  size = 1024,
  type = 'application/pdf',
} = {}) {
  return new File(['x'.repeat(size)], name, { type })
}

const REPORT_WITH_RENT_ATTACHMENT = {
  id: 'p1_2026-07',
  rent: {
    amount: 1500,
    notes: '',
    attachments: [
      {
        url: 'https://storage.example/lease.pdf',
        name: 'lease.pdf',
        type: 'pdf',
      },
    ],
  },
  maintenance: { amount: 0, notes: '', attachments: [] },
  serviceCosts: [
    { serviceId: 'gas', name: 'Gas', amount: 0, notes: '', attachments: [] },
    {
      serviceId: 'electricity',
      name: 'Electricity',
      amount: 0,
      notes: '',
      attachments: [],
    },
  ],
  otherExpenses: [],
  previousMonthArrears: 0,
  previousMonthCredit: 0,
  calculatedTotal: 1500,
  finalTotal: 1500,
  dueDate: '2026-07-05',
}

describe('MonthlyReportPage — attachments per line (M4 sub-stage 3, FR-DOC-01…05)', () => {
  it('reopen shows the existing attachment, and adding a new one does not lose it', async () => {
    const user = userEvent.setup()
    mockData({ report: REPORT_WITH_RENT_ATTACHMENT })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByRole('link', { name: 'lease.pdf' })).toBeVisible()

    const rentFileInput = document.querySelectorAll('input[type="file"]')[0]
    await user.upload(rentFileInput, makeFile({ name: 'extra.pdf' }))

    // The existing one is still there...
    expect(screen.getByRole('link', { name: 'lease.pdf' })).toBeVisible()
    // ...and the new pending one shows up alongside it, not instead of it.
    expect(screen.getByText(/extra\.pdf/)).toBeVisible()
  })

  it('rejects a file over 10MB — not added, clear error shown', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    const rentFileInput = document.querySelectorAll('input[type="file"]')[0]
    await user.upload(rentFileInput, makeFile({ size: 11 * 1024 * 1024 }))

    expect(await screen.findByText(/10 MB/)).toBeVisible()
    // The oversized file was rejected, not appended as a pending attachment —
    // its name appears ONLY inside the error message, never as a list item.
    expect(screen.queryByText(/în așteptare/)).toBeNull()
  })

  it('submits previousAttachmentUrls collected from the existing report', async () => {
    const user = userEvent.setup()
    mockData({ report: REPORT_WITH_RENT_ATTACHMENT })
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByRole('link', { name: 'lease.pdf' })
    await user.click(screen.getByText('Salvează draftul'))

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync.mock.calls[0][0].previousAttachmentUrls).toEqual([
      'https://storage.example/lease.pdf',
    ])
  })

  it('a brand new report submits an empty previousAttachmentUrls (anti-vacuity: not just "truthy")', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    await user.click(screen.getByText('Salvează draftul'))

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync.mock.calls[0][0].previousAttachmentUrls).toEqual([])
  })
})

describe('MonthlyReportPage — isNew propagation (M4 sub-stage 4, create/re-save split)', () => {
  it('a brand new report saves with isNew: true', async () => {
    const user = userEvent.setup()
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    await user.click(screen.getByText('Salvează draftul'))

    expect(mutateAsync.mock.calls[0][0].isNew).toBe(true)
  })

  it('reopening an existing draft saves with isNew: false', async () => {
    const user = userEvent.setup()
    mockData({ report: REPORT_WITH_RENT_ATTACHMENT })
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByRole('link', { name: 'lease.pdf' })
    await user.click(screen.getByText('Salvează draftul'))

    expect(mutateAsync.mock.calls[0][0].isNew).toBe(false)
  })
})

const SIGNED_REPORT = {
  id: 'p1_2026-07',
  status: 'signed',
  signedAt: '2026-07-01T10:00:00Z',
  rent: { amount: 1500, notes: '', attachments: [] },
  maintenance: { amount: 0, notes: '', attachments: [] },
  serviceCosts: [
    { serviceId: 'gas', name: 'Gas', amount: 0, notes: '', attachments: [] },
    {
      serviceId: 'electricity',
      name: 'Electricity',
      amount: 0,
      notes: '',
      attachments: [],
    },
  ],
  otherExpenses: [],
  previousMonthArrears: 0,
  previousMonthCredit: 0,
  calculatedTotal: 1500,
  finalTotal: 1500,
  dueDate: '2026-07-05',
}

describe('MonthlyReportPage — locked when signed (M4 sub-stage 4, FR-REP-07)', () => {
  it('disables every editable cost-line input when the report is signed', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    // Rent, maintenance, and each service's amount field — all wired to
    // `disabled={isLocked}` via CostLineRow.
    expect(await screen.findByLabelText('Chirie')).toBeDisabled()
    expect(screen.getByLabelText('Mentenanță')).toBeDisabled()
    expect(screen.getByLabelText('Gas')).toBeDisabled()
    expect(screen.getByLabelText('Electricity')).toBeDisabled()
    expect(screen.getByLabelText('Total final')).toBeDisabled()
    expect(screen.getByLabelText('Data scadentă')).toBeDisabled()
    // previousMonthArrears/previousMonthCredit are ALWAYS readOnly — never
    // wired to `disabled` because they were never editable in the first
    // place, lock state or not. Confirms they stay in their normal state
    // rather than asserting something that was never true.
    const readOnlyFields = document.querySelectorAll('input[readonly]')
    expect(readOnlyFields.length).toBe(2)
  })

  it('does NOT disable inputs on a draft report', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByLabelText('Chirie')).not.toBeDisabled()
    expect(screen.getByLabelText('Total final')).not.toBeDisabled()
  })

  it('hides the Save button when the report is signed', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    expect(screen.queryByText('Salvează draftul')).toBeNull()
  })

  it('shows the Save button on a draft report', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Salvează draftul')).toBeVisible()
  })

  it('shows the Sign button (not Unlock) on an editable draft that already exists', async () => {
    mockData({ report: REPORT_WITH_RENT_ATTACHMENT })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Semnează lista')).toBeVisible()
    expect(screen.queryByText('Deblochează pentru corecție')).toBeNull()
  })

  it('shows the Unlock button (not Sign) on a signed report', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Deblochează pentru corecție')).toBeVisible()
    expect(screen.queryByText('Semnează lista')).toBeNull()
  })

  it('renders neither Sign nor Unlock on a brand new (never-saved) report', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    expect(screen.queryByText('Semnează lista')).toBeNull()
    expect(screen.queryByText('Deblochează pentru corecție')).toBeNull()
  })

  it('signing calls signReport with the report id, via a confirmation dialog', async () => {
    const user = userEvent.setup()
    mockData({ report: REPORT_WITH_RENT_ATTACHMENT })
    await renderWithProviders(<MonthlyReportPage />)

    await user.click(await screen.findByText('Semnează lista'))
    expect(
      screen.getByText('Lista devine finală și blocată pentru editare.'),
    ).toBeVisible()
    await user.click(screen.getByText('Semnează'))

    expect(signMutateAsync).toHaveBeenCalledWith({ id: 'p1_2026-07' })
  })

  it('unlocking calls unlockReport with the report id, via a confirmation dialog', async () => {
    const user = userEvent.setup()
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    await user.click(await screen.findByText('Deblochează pentru corecție'))
    await user.click(screen.getByText('Deblochează'))

    expect(unlockMutateAsync).toHaveBeenCalledWith({ id: 'p1_2026-07' })
  })

  it('does not resync serviceCosts against the live property once signed (FR-PROP-08 — page-level integration)', async () => {
    useProperty.mockReturnValue({
      data: {
        ...PROPERTY,
        services: [{ serviceId: 'water', name: 'Water', source: 'catalog' }],
      },
      isPending: false,
      isError: false,
    })
    useActiveTenancyForProperty.mockReturnValue({
      data: TENANCY,
      isPending: false,
    })
    useMonthlyReport.mockReturnValue({ data: SIGNED_REPORT, isPending: false })

    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Gas')).toBeVisible()
    expect(screen.queryByText('Water')).toBeNull()
  })
})

describe('MonthlyReportPage — PaymentSection wiring (M4 sub-stage 5)', () => {
  it('renders PaymentSection when the report is signed', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Plată')).toBeVisible()
  })

  it('does NOT render PaymentSection on a draft', async () => {
    mockData({ report: REPORT_WITH_RENT_ATTACHMENT })
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Semnează lista')
    expect(screen.queryByText('Plată')).toBeNull()
  })

  it('does NOT render PaymentSection on a brand new (never-saved) report', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    expect(screen.queryByText('Plată')).toBeNull()
  })
})

describe('MonthlyReportPage — SendReportNotificationControl wiring (M4 sub-stage 6)', () => {
  it('renders the "Send by email" button when the report is signed', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Trimite pe email')).toBeVisible()
  })

  it('does NOT render it on a draft', async () => {
    mockData({ report: REPORT_WITH_RENT_ATTACHMENT })
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Semnează lista')
    expect(screen.queryByText('Trimite pe email')).toBeNull()
  })

  it('does NOT render it on a brand new (never-saved) report', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    expect(screen.queryByText('Trimite pe email')).toBeNull()
  })
})

describe('MonthlyReportPage — ExportReportControls wiring (M4 sub-stage 8)', () => {
  it('renders the export zone (copy link / PDF / PNG) when the report is signed', async () => {
    mockData({ report: SIGNED_REPORT })
    await renderWithProviders(<MonthlyReportPage />)

    expect(await screen.findByText('Copiază link partajabil')).toBeVisible()
    expect(screen.getByText('Descarcă PDF')).toBeVisible()
    expect(screen.getByText('Descarcă PNG')).toBeVisible()
  })

  it('does NOT render it on a draft', async () => {
    mockData({ report: REPORT_WITH_RENT_ATTACHMENT })
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Semnează lista')
    expect(screen.queryByText('Copiază link partajabil')).toBeNull()
  })

  it('does NOT render it on a brand new (never-saved) report', async () => {
    mockData()
    await renderWithProviders(<MonthlyReportPage />)

    await screen.findByText('Gas')
    expect(screen.queryByText('Copiază link partajabil')).toBeNull()
  })
})
