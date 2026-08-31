import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { AccountTab } from '@/features/tenants/components/AccountTab'

// Fast band — the tenancy/account hooks are mocked, no emulator.

vi.mock('@/features/tenants/hooks', () => ({
  useUserTenancies: vi.fn(),
  useResetTenantPassword: vi.fn(),
  useSetTenantAccountStatus: vi.fn(),
  useExportTenantData: vi.fn(),
}))

import {
  useExportTenantData,
  useResetTenantPassword,
  useSetTenantAccountStatus,
  useUserTenancies,
} from '@/features/tenants/hooks'

const resetMutateAsync = vi.fn()
const statusMutateAsync = vi.fn()
const exportMutateAsync = vi.fn()

function activeTenancy(overrides) {
  return { id: 't1', userId: 'u1', status: 'active', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  useUserTenancies.mockReturnValue({ data: [], isPending: false })
  useResetTenantPassword.mockReturnValue({
    mutateAsync: resetMutateAsync,
    isPending: false,
  })
  useSetTenantAccountStatus.mockReturnValue({
    mutateAsync: statusMutateAsync,
    isPending: false,
  })
  useExportTenantData.mockReturnValue({
    mutateAsync: exportMutateAsync,
    isPending: false,
  })
  resetMutateAsync.mockResolvedValue({ data: { password: 'AbCdEfGh2345' } })
  statusMutateAsync.mockResolvedValue({ data: { status: 'disabled' } })
  exportMutateAsync.mockResolvedValue({
    data: {
      subjectUserId: 'u1',
      profile: { id: 'u1', name: 'Maria' },
      thirdParties: {
        description: 'data about people other than the subject',
        guarantor: { name: 'Vasile Garant' },
        emergencyContact: null,
        previousReference: null,
        documentManifest: [],
      },
      counts: { thirdPartyDocuments: 0 },
    },
  })
})

describe('AccountTab — Reset password', () => {
  it('opens a dialog with the generated password after reset', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<AccountTab userId="u1" status="active" />)

    await user.click(screen.getByRole('button', { name: 'Resetează parola' }))

    await waitFor(() =>
      expect(resetMutateAsync).toHaveBeenCalledWith({ userId: 'u1' }),
    )
    expect(await screen.findByText('AbCdEfGh2345')).toBeVisible()
  })
})

describe('AccountTab — Disable / Re-enable', () => {
  it('shows "Dezactivează" for an active account and calls setTenantAccountStatus with action=disable', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<AccountTab userId="u1" status="active" />)

    await user.click(screen.getByRole('button', { name: 'Dezactivează' }))
    const dialogButtons = screen.getAllByRole('button', {
      name: 'Dezactivează',
    })
    await user.click(dialogButtons[dialogButtons.length - 1])

    await waitFor(() =>
      expect(statusMutateAsync).toHaveBeenCalledWith({
        userId: 'u1',
        action: 'disable',
      }),
    )
  })

  it('shows "Re-activează" for a disabled account and calls setTenantAccountStatus with action=enable', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<AccountTab userId="u1" status="disabled" />)

    await user.click(screen.getByRole('button', { name: 'Re-activează' }))
    const dialogButtons = screen.getAllByRole('button', {
      name: 'Re-activează',
    })
    await user.click(dialogButtons[dialogButtons.length - 1])

    await waitFor(() =>
      expect(statusMutateAsync).toHaveBeenCalledWith({
        userId: 'u1',
        action: 'enable',
      }),
    )
  })

  it('shows an error message instead of crashing when the callable fails', async () => {
    statusMutateAsync.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    await renderWithProviders(<AccountTab userId="u1" status="active" />)

    await user.click(screen.getByRole('button', { name: 'Dezactivează' }))
    const dialogButtons = screen.getAllByRole('button', {
      name: 'Dezactivează',
    })
    await user.click(dialogButtons[dialogButtons.length - 1])

    expect(
      await screen.findByText(
        'Acțiunea nu a putut fi efectuată. Încearcă din nou.',
      ),
    ).toBeVisible()
  })
})

describe('AccountTab — Archive guard (Bogdan’s state machine, M3-D)', () => {
  // Anti-vacuity: without the guard, this fails — the button would be enabled.
  it('blocks archiving when the account has an active tenancy', async () => {
    useUserTenancies.mockReturnValue({
      data: [activeTenancy()],
      isPending: false,
    })
    await renderWithProviders(<AccountTab userId="u1" status="active" />)

    expect(screen.getByRole('button', { name: 'Arhivează' })).toBeDisabled()
    expect(screen.getByText('Termină contractul întâi.')).toBeVisible()
  })

  it('blocks archiving when the account is disabled', async () => {
    await renderWithProviders(<AccountTab userId="u1" status="disabled" />)

    expect(screen.getByRole('button', { name: 'Arhivează' })).toBeDisabled()
    expect(screen.getByText('Re-activează contul întâi.')).toBeVisible()
  })

  it('permits archiving an inactive-readonly account with no active tenancy — calls the CF with action=archive', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <AccountTab userId="u1" status="inactive-readonly" />,
    )

    expect(screen.getByRole('button', { name: 'Arhivează' })).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Arhivează' }))
    const dialogButtons = screen.getAllByRole('button', { name: 'Arhivează' })
    await user.click(dialogButtons[dialogButtons.length - 1])

    // D#3 audit fix: archive is no longer a direct Firestore write — it goes
    // through the SAME callable as disable/enable, so archiving also reaches
    // Auth (disabled:true + revokeRefreshTokens, server-side) instead of
    // leaving a native Firebase login fully working for an "archived" account.
    await waitFor(() =>
      expect(statusMutateAsync).toHaveBeenCalledWith({
        userId: 'u1',
        action: 'archive',
      }),
    )
  })

  it('shows an error message instead of crashing when the archive callable fails', async () => {
    statusMutateAsync.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    await renderWithProviders(
      <AccountTab userId="u1" status="inactive-readonly" />,
    )

    await user.click(screen.getByRole('button', { name: 'Arhivează' }))
    const dialogButtons = screen.getAllByRole('button', { name: 'Arhivează' })
    await user.click(dialogButtons[dialogButtons.length - 1])

    expect(
      await screen.findByText(
        'Acțiunea nu a putut fi efectuată. Încearcă din nou.',
      ),
    ).toBeVisible()
  })
})

describe('AccountTab — archived account is read-only', () => {
  it('shows no status actions, only a notice — but the data export stays available', async () => {
    await renderWithProviders(<AccountTab userId="u1" status="archived" />)

    expect(
      screen.queryByRole('button', { name: 'Resetează parola' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /dezactivează|re-activează/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Arhivează' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Acest cont este arhivat.')).toBeVisible()
    // FR-TEN-26: a subject-access request does not stop because the account
    // was retired.
    expect(
      screen.getByRole('button', { name: 'Construiește fișierul de date' }),
    ).toBeVisible()
  })
})

describe('AccountTab — Personal data export (FR-TEN-26)', () => {
  it('the control names what it produces, not just "Export"', async () => {
    await renderWithProviders(<AccountTab userId="u1" status="active" />)

    expect(
      screen.getByRole('button', { name: 'Construiește fișierul de date' }),
    ).toBeVisible()
    expect(screen.getByText(/profilul și răspunsurile KYC/)).toBeVisible()
    expect(
      screen.getByText(
        /grupate într-o secțiune marcată ca fiind despre alte persoane/,
      ),
    ).toBeVisible()
  })

  it('builds the bundle and opens a review dialog before anything leaves', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<AccountTab userId="u1" status="active" />)

    await user.click(
      screen.getByRole('button', { name: 'Construiește fișierul de date' }),
    )

    await waitFor(() =>
      expect(exportMutateAsync).toHaveBeenCalledWith({ userId: 'u1' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(
        'Fișier de date personale — verifică înainte de trimitere',
      ),
    ).toBeVisible()
    expect(within(dialog).getByText(/„thirdParties”/)).toBeVisible()
    expect(within(dialog).getByText(/"subjectUserId": "u1"/)).toBeVisible()
    expect(
      within(dialog).getByRole('button', { name: 'Descarcă .json' }),
    ).toBeVisible()
  })

  it('shows an error and lets the admin retry when the build fails', async () => {
    exportMutateAsync.mockRejectedValueOnce(new Error('functions/internal'))
    const user = userEvent.setup()
    await renderWithProviders(<AccountTab userId="u1" status="active" />)

    await user.click(
      screen.getByRole('button', { name: 'Construiește fișierul de date' }),
    )

    expect(
      await screen.findByText(
        'Fișierul nu a putut fi construit. Încearcă din nou.',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Construiește fișierul de date' }),
    ).toBeEnabled()
  })
})
