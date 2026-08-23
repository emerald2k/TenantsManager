import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { TenancyTab } from '@/features/tenants/components/TenancyTab'

// Fast band — the tenancy hooks + ContractUpload are mocked, no emulator.
// EditableSection/Section/Field (ProfileTab.jsx, exported M3-C) run FOR REAL —
// they are simple, already covered by tenants.profileTab.test.jsx, and using
// them for real here proves the Extend flow's Zod validation actually wires up.

vi.mock('@/features/tenants/hooks', () => ({
  useUserTenancies: vi.fn(),
  useUpdateTenancy: vi.fn(),
  useEndTenancy: vi.fn(),
}))
vi.mock('@/features/tenants/components/ContractUpload', () => ({
  ContractUpload: ({ tenancyId, documents }) => (
    <div data-testid="contract-upload">
      {tenancyId}:{documents.length}
    </div>
  ),
}))

import {
  useEndTenancy,
  useUpdateTenancy,
  useUserTenancies,
} from '@/features/tenants/hooks'

const updateTenancyMutateAsync = vi.fn()
const endTenancyMutateAsync = vi.fn()

function activeTenancy(overrides) {
  return {
    id: 't-active',
    userId: 'u1',
    propertyId: 'p1',
    property: { name: 'Apartament Centru' },
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    monthlyRent: 2000,
    securityDeposit: 2500,
    dueDay: 5,
    reportReminderDaysBefore: 3,
    status: 'active',
    attachedDocuments: [],
    ...overrides,
  }
}

function endedTenancy(overrides) {
  return {
    id: 't-ended-1',
    userId: 'u1',
    propertyId: 'p2',
    property: { name: 'Garsonieră Mărăști' },
    startDate: '2024-01-01',
    endDate: '2025-01-01',
    monthlyRent: 1500,
    dueDay: 1,
    status: 'ended',
    attachedDocuments: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useUpdateTenancy.mockReturnValue({
    mutateAsync: updateTenancyMutateAsync,
    isPending: false,
  })
  useEndTenancy.mockReturnValue({
    mutateAsync: endTenancyMutateAsync,
    isPending: false,
  })
  updateTenancyMutateAsync.mockResolvedValue(undefined)
  endTenancyMutateAsync.mockResolvedValue({ data: { tenancyId: 't-active' } })
})

describe('TenancyTab — rendering (SRS §5.3)', () => {
  it('shows a loading state while the tenancy history loads', async () => {
    useUserTenancies.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    await renderWithProviders(<TenancyTab userId="u1" />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  it('shows a Retry button on the error state that re-runs the tenancies query', async () => {
    const refetch = vi.fn()
    useUserTenancies.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch,
    })
    const user = userEvent.setup()
    await renderWithProviders(<TenancyTab userId="u1" />)

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows a message when the tenant has no tenancy at all', async () => {
    useUserTenancies.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    })
    await renderWithProviders(<TenancyTab userId="u1" />)

    expect(
      screen.getByText('Acest chiriaș nu are încă nicio tenanță.'),
    ).toBeVisible()
  })

  it('shows the active tenancy’s contract details, End Contract button, and document upload', async () => {
    useUserTenancies.mockReturnValue({
      data: [activeTenancy()],
      isPending: false,
      isError: false,
    })
    await renderWithProviders(<TenancyTab userId="u1" />)

    expect(screen.getByText('Apartament Centru')).toBeVisible()
    expect(screen.getByText('2026-01-01')).toBeVisible()
    expect(screen.getByText('2027-01-01')).toBeVisible()
    expect(screen.getByText('2000')).toBeVisible()
    expect(screen.getByText('2500')).toBeVisible()
    // FR-CON-01 (audit fix, D#1): reportReminderDaysBefore is part of the
    // contract fields but was missing from this summary.
    expect(
      screen.getByText('Reminder raport (zile înainte de scadență)'),
    ).toBeVisible()
    expect(screen.getByText('3')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Termină contractul' }),
    ).toBeVisible()
    expect(screen.getByTestId('contract-upload')).toHaveTextContent(
      't-active:0',
    )
    expect(
      screen.queryByText('Această tenanță s-a încheiat deja.'),
    ).not.toBeInTheDocument()
  })

  it('shows the last ended tenancy when there is no active one, with the end action disabled', async () => {
    useUserTenancies.mockReturnValue({
      data: [
        endedTenancy({ id: 't-ended-1', endDate: '2025-01-01' }),
        endedTenancy({ id: 't-ended-2', endDate: '2026-06-01' }),
      ],
      isPending: false,
      isError: false,
    })
    await renderWithProviders(<TenancyTab userId="u1" />)

    // The MOST RECENT ended tenancy (by endDate) is the "last contract".
    expect(screen.getByTestId('contract-upload')).toHaveTextContent(
      't-ended-2:0',
    )
    expect(
      screen.queryByRole('button', { name: 'Termină contractul' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Această tenanță s-a încheiat deja.')).toBeVisible()
  })

  it('lists ended tenancies as history, excluding the one already shown as the last contract', async () => {
    useUserTenancies.mockReturnValue({
      data: [activeTenancy(), endedTenancy()],
      isPending: false,
      isError: false,
    })
    await renderWithProviders(<TenancyTab userId="u1" />)

    expect(screen.getByText('Istoric tenanțe')).toBeVisible()
    expect(screen.getByText(/Garsonieră Mărăști/)).toBeVisible()
  })
})

describe('TenancyTab — Extend (FR-CON-06)', () => {
  it('saves only endDate through useUpdateTenancy', async () => {
    const user = userEvent.setup()
    useUserTenancies.mockReturnValue({
      data: [activeTenancy()],
      isPending: false,
      isError: false,
    })
    await renderWithProviders(<TenancyTab userId="u1" />)

    await user.click(screen.getByRole('button', { name: 'Editează' }))
    const endDateInput = screen.getByLabelText('Dată sfârșit')
    await user.clear(endDateInput)
    await user.type(endDateInput, '2028-01-01')
    await user.click(screen.getByRole('button', { name: 'Salvează' }))

    await waitFor(() =>
      expect(updateTenancyMutateAsync).toHaveBeenCalledWith({
        id: 't-active',
        userId: 'u1',
        values: { endDate: '2028-01-01' },
      }),
    )
  })
})

describe('TenancyTab — End Contract (FR-CON-03/05)', () => {
  async function openConfirmDialog(user, overrides) {
    useUserTenancies.mockReturnValue({
      data: [activeTenancy(overrides)],
      isPending: false,
      isError: false,
    })
    await renderWithProviders(<TenancyTab userId="u1" />)
    await user.click(screen.getByRole('button', { name: 'Termină contractul' }))
  }

  it('asks for confirmation before calling endTenancy', async () => {
    const user = userEvent.setup()
    await openConfirmDialog(user)

    expect(screen.getByText('Termini acest contract?')).toBeVisible()
    expect(endTenancyMutateAsync).not.toHaveBeenCalled()
  })

  it('disables the confirm button until the closing balance is acknowledged', async () => {
    const user = userEvent.setup()
    await openConfirmDialog(user)

    const dialogButtons = screen.getAllByRole('button', {
      name: 'Termină contractul',
    })
    const confirmButton = dialogButtons[dialogButtons.length - 1]
    expect(confirmButton).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(confirmButton).not.toBeDisabled()
  })

  it('calls endTenancy with the tenancy/user/property ids once acknowledged', async () => {
    const user = userEvent.setup()
    await openConfirmDialog(user)

    await user.click(screen.getByRole('checkbox'))
    const dialogButtons = screen.getAllByRole('button', {
      name: 'Termină contractul',
    })
    await user.click(dialogButtons[dialogButtons.length - 1])

    await waitFor(() =>
      expect(endTenancyMutateAsync).toHaveBeenCalledWith({
        tenancyId: 't-active',
        userId: 'u1',
        propertyId: 'p1',
      }),
    )
  })

  it('states arrears plainly (FR-CON-04, reversed at M8) — termination is no longer blocked', async () => {
    const user = userEvent.setup()
    await openConfirmDialog(user, { currentBalance: 150 })

    expect(screen.getByText(/mai are de plătit 150,00 lei/)).toBeVisible()
  })

  it('states a tenant credit plainly when currentBalance is negative (FR-CON-04/FR-DASH-14)', async () => {
    const user = userEvent.setup()
    await openConfirmDialog(user, { currentBalance: -50 })

    expect(screen.getByText(/are un credit de 50,00 lei/)).toBeVisible()
  })

  it('states the balance is settled when currentBalance is zero', async () => {
    const user = userEvent.setup()
    await openConfirmDialog(user, { currentBalance: 0 })

    expect(screen.getByText('Soldul este achitat integral.')).toBeVisible()
  })

  it('shows a generic error message on an unexpected failure', async () => {
    endTenancyMutateAsync.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    await openConfirmDialog(user)

    await user.click(screen.getByRole('checkbox'))
    const dialogButtons = screen.getAllByRole('button', {
      name: 'Termină contractul',
    })
    await user.click(dialogButtons[dialogButtons.length - 1])

    expect(
      await screen.findByText(
        'Contractul nu a putut fi terminat. Încearcă din nou.',
      ),
    ).toBeVisible()
  })
})
