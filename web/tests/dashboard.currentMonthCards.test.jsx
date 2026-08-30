import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { CurrentMonthCards } from '@/features/dashboard/components/CurrentMonthCards'
import { CurrentMonthList } from '@/features/dashboard/components/CurrentMonthList'

// M8 stage 15b — the phone/tablet card layout for the current-month list
// (NFR-UX-03, owner decision 2026-08-30: cards from ~1100 px, not 700 px).
// The five row states are the mockup's; jsdom cannot see the responsive
// swap's widths, so the swap is exercised by stubbing `matchMedia`.

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The five mockup rows, in the shape `buildCurrentMonthRows` emits. */
const ROWS = [
  {
    propertyId: 'p1',
    tenancyId: 't1',
    propertyName: 'Aviatorilor 12',
    tenantName: 'Andrei Munteanu',
    reportState: 'signed',
    totalDue: 2450,
    totalDueMuted: false,
    remaining: 0,
    remainingShown: false,
    isOverdue: false,
    dueDate: '2026-08-15',
    dueConsequence: 'on-time',
    dueDayCount: 0,
    payment: { kind: 'paid', tone: 'ok' },
  },
  {
    propertyId: 'p2',
    tenancyId: 't2',
    propertyName: 'Dorobanți 44',
    tenantName: 'Elena Ionescu',
    reportState: 'signed',
    totalDue: 2450,
    totalDueMuted: false,
    remaining: 1560,
    remainingShown: true,
    isOverdue: true,
    dueDate: '2026-08-15',
    dueConsequence: 'late',
    dueDayCount: 6,
    payment: { kind: 'partial', tone: 'destructive' },
  },
  {
    propertyId: 'p3',
    tenancyId: 't3',
    propertyName: 'Titulescu 8',
    tenantName: 'Radu Pavel',
    reportState: 'signed',
    totalDue: 2340,
    totalDueMuted: false,
    remaining: 2340,
    remainingShown: true,
    isOverdue: false,
    dueDate: '2026-08-25',
    dueConsequence: 'upcoming',
    dueDayCount: 4,
    payment: { kind: 'unpaid', tone: 'muted' },
  },
  {
    propertyId: 'p4',
    tenancyId: 't4',
    propertyName: 'Unirii 3',
    tenantName: 'Maria Dobre',
    reportState: 'draft',
    totalDue: 1980,
    totalDueMuted: true,
    remaining: 0,
    remainingShown: false,
    isOverdue: false,
    dueDate: '2026-08-20',
    dueConsequence: 'after-signing',
    dueDayCount: 0,
    payment: { kind: 'cannot-record', tone: 'muted' },
  },
  {
    propertyId: 'p5',
    tenancyId: 't5',
    propertyName: 'Berceni 21',
    tenantName: 'Cristian Neagu',
    reportState: 'not-entered',
    totalDue: null,
    totalDueMuted: true,
    remaining: 890,
    remainingShown: true,
    isOverdue: true,
    dueDate: '2026-07-15',
    dueConsequence: 'late',
    dueDayCount: 37,
    payment: {
      kind: 'arrears',
      tone: 'destructive',
      arrearsMonth: { month: 7, year: 2026 },
    },
  },
]

function cardFor(name) {
  return screen.getByText(name).closest('button')
}

describe('CurrentMonthCards — the five row states (FR-DASH-02b/02c)', () => {
  it('paid in full: signed badge, "achitat integral", Remaining "—", on-time line', async () => {
    await renderWithProviders(<CurrentMonthCards rows={ROWS} />)
    const card = cardFor('Aviatorilor 12')
    expect(within(card).getByText('Andrei Munteanu')).toBeInTheDocument()
    expect(within(card).getByText('Semnat')).toBeInTheDocument()
    expect(within(card).getByText('Achitat integral')).toBeInTheDocument()
    expect(within(card).getByText('—')).toBeInTheDocument()
    expect(within(card).getByText('achitat la timp')).toBeInTheDocument()
  })

  it('partial + overdue: "plătit parțial", the amount, "întârziat cu 6 zile"', async () => {
    await renderWithProviders(<CurrentMonthCards rows={ROWS} />)
    const card = cardFor('Dorobanți 44')
    expect(within(card).getByText('Plătit parțial')).toBeInTheDocument()
    expect(within(card).getByText('1.560,00 lei')).toBeInTheDocument()
    expect(within(card).getByText('întârziat cu 6 zile')).toBeInTheDocument()
  })

  it('no report but arrears from July: "Neîntocmit", "Restanță din iulie", 890, older due date', async () => {
    await renderWithProviders(<CurrentMonthCards rows={ROWS} />)
    const card = cardFor('Berceni 21')
    expect(within(card).getByText('Neîntocmit')).toBeInTheDocument()
    expect(within(card).getByText('Restanță din iulie')).toBeInTheDocument()
    expect(within(card).getByText('890,00 lei')).toBeInTheDocument()
    expect(within(card).getByText('întârziat cu 37 zile')).toBeInTheDocument()
  })

  it('draft: "Nu se poate încă", Remaining "—", "după semnare"', async () => {
    await renderWithProviders(<CurrentMonthCards rows={ROWS} />)
    const card = cardFor('Unirii 3')
    expect(within(card).getByText('Ciornă, nesemnat')).toBeInTheDocument()
    expect(within(card).getByText('Nu se poate încă')).toBeInTheDocument()
    expect(within(card).getByText('după semnare')).toBeInTheDocument()
  })

  it('drops the Total-due column entirely (NFR-UX-03) — no "Total de plată" label anywhere', async () => {
    await renderWithProviders(<CurrentMonthCards rows={ROWS} />)
    expect(screen.queryByText('Total de plată')).not.toBeInTheDocument()
    // 2.450,00 lei is row 1's totalDue — it must not surface on the card.
    expect(screen.queryByText('2.450,00 lei')).not.toBeInTheDocument()
  })

  it('the whole card is one tap target — a click calls onRowClick with the row', async () => {
    const onRowClick = vi.fn()
    const user = userEvent.setup()
    await renderWithProviders(
      <CurrentMonthCards rows={ROWS} onRowClick={onRowClick} />,
    )
    await user.click(cardFor('Titulescu 8'))
    expect(onRowClick).toHaveBeenCalledWith(ROWS[2])
  })
})

describe('CurrentMonthList — width picks table vs cards', () => {
  it('renders the seven-column TABLE when matchMedia is absent (desktop default)', async () => {
    await renderWithProviders(<CurrentMonthList rows={ROWS} />)
    expect(screen.getAllByRole('columnheader').length).toBe(7)
  })

  it('renders CARDS (no columnheaders) when (max-width: 1100px) matches', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q) => ({
        matches: q === '(max-width: 1100px)',
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    )
    await renderWithProviders(<CurrentMonthList rows={ROWS} />)
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0)
    expect(screen.getByText('Aviatorilor 12')).toBeInTheDocument()
  })
})
