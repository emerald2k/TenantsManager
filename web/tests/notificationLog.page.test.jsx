import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { NotificationLogPage } from '@/features/notifications/pages/NotificationLogPage'
import { useNotificationLog } from '@/features/notifications/hooks'

// Fast band — the data hook is mocked (notifications/hooks reads Firestore;
// that boundary is not exercised here). This test checks what the PAGE does:
// the six columns, the JS sort + 12-month window, the two distinct empty
// states (FR-NLOG-08), the read-only-ness (FR-NLOG-06), and that a body is
// never shown (FR-NLOG-02).

vi.mock('@/features/notifications/hooks', () => ({
  useNotificationLog: vi.fn(),
}))

const ts = (iso) => ({ toDate: () => new Date(iso) })

function row(overrides = {}) {
  return {
    id: 'mail-1',
    mailId: 'mail-1',
    type: 'report-new',
    audience: 'tenant',
    subject: 'Raportul pentru mai 2026',
    to: ['ion@example.com'],
    deliveryState: 'SUCCESS',
    deliveryError: null,
    sentAt: ts('2026-05-02T08:30:00Z'),
    ...overrides,
  }
}

function mockLog(over = {}) {
  useNotificationLog.mockReturnValue({
    data: { rows: [], anyExist: false },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...over,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NotificationLogPage', () => {
  it('shows the 12-month window notice always (FR-NLOG-07)', async () => {
    mockLog()
    await renderWithProviders(<NotificationLogPage />)
    expect(
      screen.getByText(/ultimele 12 luni/i, { selector: 'p' }),
    ).toBeVisible()
  })

  it('loading state', async () => {
    mockLog({ isPending: true, data: undefined })
    await renderWithProviders(<NotificationLogPage />)
    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  it('error state offers Retry (SRS §5.5)', async () => {
    const refetch = vi.fn()
    mockLog({ isError: true, data: undefined, refetch })
    await renderWithProviders(<NotificationLogPage />)
    await userEvent.setup().click(screen.getByText('Încearcă din nou'))
    expect(refetch).toHaveBeenCalled()
  })

  it('empty log reads "starts empty", NOT "none in window" (FR-NLOG-08)', async () => {
    mockLog({ data: { rows: [], anyExist: false } })
    await renderWithProviders(<NotificationLogPage />)
    expect(screen.getByText(/Jurnalul este gol/i)).toBeVisible()
    expect(screen.queryByText(/ultimele 12 luni\.$/i)).toBeNull()
  })

  it('populated log with nothing in the window reads differently (FR-NLOG-08)', async () => {
    mockLog({ data: { rows: [], anyExist: true } })
    await renderWithProviders(<NotificationLogPage />)
    expect(
      screen.getByText('Niciun email trimis în ultimele 12 luni.'),
    ).toBeVisible()
  })

  it('renders the six columns, sorted most-recent-first, with the type localized', async () => {
    mockLog({
      data: {
        anyExist: true,
        rows: [
          row({
            id: 'older',
            subject: 'Mai vechi',
            sentAt: ts('2026-04-01T00:00:00Z'),
          }),
          row({
            id: 'newer',
            subject: 'Mai nou',
            sentAt: ts('2026-06-01T00:00:00Z'),
          }),
        ],
      },
    })
    await renderWithProviders(<NotificationLogPage />)

    const bodyRows = screen.getAllByRole('row').slice(1) // drop the header row
    expect(within(bodyRows[0]).getByText('Mai nou')).toBeInTheDocument()
    expect(within(bodyRows[1]).getByText('Mai vechi')).toBeInTheDocument()
    // type + audience + recipient + delivery badge all present
    expect(screen.getAllByText('Raport nou')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Chiriaș')[0]).toBeInTheDocument()
    expect(screen.getAllByText('ion@example.com')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Livrat')[0]).toBeInTheDocument()
  })

  it('drops rows older than 12 months (JS window, not a Firestore orderBy)', async () => {
    mockLog({
      data: {
        anyExist: true,
        rows: [
          row({
            id: 'kept',
            subject: 'În fereastră',
            sentAt: ts(new Date().toISOString()),
          }),
          row({
            id: 'gone',
            subject: 'Acum doi ani',
            sentAt: ts('2023-01-01T00:00:00Z'),
          }),
        ],
      },
    })
    await renderWithProviders(<NotificationLogPage />)
    expect(screen.getByText('În fereastră')).toBeInTheDocument()
    expect(screen.queryByText('Acum doi ani')).toBeNull()
  })

  it('is read-only — rows are not buttons/links and carry no click handler (FR-NLOG-06)', async () => {
    mockLog({ data: { anyExist: true, rows: [row()] } })
    await renderWithProviders(<NotificationLogPage />)
    const bodyRow = screen.getAllByRole('row')[1]
    expect(bodyRow).not.toHaveAttribute('tabindex')
    expect(within(bodyRow).queryByRole('button')).toBeNull()
    expect(within(bodyRow).queryByRole('link')).toBeNull()
  })

  it('shows an ERROR row with its deliveryError text, but never a message body (FR-NLOG-02)', async () => {
    mockLog({
      data: {
        anyExist: true,
        rows: [
          row({
            deliveryState: 'ERROR',
            deliveryError: 'SMTP 550 mailbox unavailable',
            subject: 'Subiect vizibil',
          }),
        ],
      },
    })
    await renderWithProviders(<NotificationLogPage />)
    expect(screen.getByText('Eșuat')).toBeVisible()
    expect(screen.getByText('SMTP 550 mailbox unavailable')).toBeVisible()
    expect(screen.getByText('Subiect vizibil')).toBeVisible()
    // no 'body'/'message'/'text' column anywhere
    expect(screen.queryByText(/message\.text|corp mesaj/i)).toBeNull()
  })
})
