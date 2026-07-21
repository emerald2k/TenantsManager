import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { TenantDetailPage } from '@/features/tenants/pages/TenantDetailPage'
import { useUserById } from '@/features/onboarding/hooks'

// Fast band — the read hook is mocked; ProfileTab's own behavior is fully
// covered by tenants.profileTab.test.jsx, so it is mocked here too. This file
// only checks the SHELL: header, tab navigation, and which content each tab
// renders.
vi.mock('@/features/onboarding/hooks', () => ({
  useUserById: vi.fn(),
}))
vi.mock('@/features/tenants/components/ProfileTab', () => ({
  ProfileTab: ({ userId }) => <div data-testid="profile-tab">{userId}</div>,
}))
vi.mock('@/features/tenants/components/TenancyTab', () => ({
  TenancyTab: ({ userId }) => <div data-testid="tenancy-tab">{userId}</div>,
}))
vi.mock('@/features/tenants/components/AccountTab', () => ({
  AccountTab: ({ userId, status }) => (
    <div data-testid="account-tab">
      {userId}:{status}
    </div>
  ),
}))
vi.mock('@/features/tenants/components/FinancialTab', () => ({
  FinancialTab: () => <div data-testid="financial-tab" />,
}))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useParams: () => ({ id: 'u1' }),
}))

function mockUser(overrides) {
  useUserById.mockReturnValue({
    data: { id: 'u1', name: 'Ana Pop', status: 'active', ...overrides },
    isPending: false,
    isError: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TenantDetailPage — shell', () => {
  it('renders the header with the tenant name and status badge', async () => {
    mockUser()
    await renderWithProviders(<TenantDetailPage />)

    expect(screen.getByText('Ana Pop')).toBeVisible()
    expect(screen.getByText('Activ')).toBeVisible()
  })

  it('renders 4 tabs, defaulting to Profile', async () => {
    mockUser()
    await renderWithProviders(<TenantDetailPage />)

    expect(screen.getByRole('tab', { name: 'Profil' })).toBeVisible()
    expect(
      screen.getByRole('tab', { name: 'Tenanță și contract' }),
    ).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Istoric financiar' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Cont' })).toBeVisible()
    expect(screen.getByTestId('profile-tab')).toBeVisible()
  })

  it('switches between tabs, rendering each one’s content', async () => {
    const user = userEvent.setup()
    mockUser()
    await renderWithProviders(<TenantDetailPage />)

    await user.click(screen.getByRole('tab', { name: 'Tenanță și contract' }))

    expect(screen.queryByTestId('profile-tab')).toBeNull()
    expect(screen.getByTestId('tenancy-tab')).toBeVisible()

    await user.click(screen.getByRole('tab', { name: 'Cont' }))
    expect(screen.getByTestId('account-tab')).toHaveTextContent('u1:active')

    await user.click(screen.getByRole('tab', { name: 'Istoric financiar' }))
    expect(screen.getByTestId('financial-tab')).toBeVisible()

    await user.click(screen.getByRole('tab', { name: 'Profil' }))
    expect(screen.getByTestId('profile-tab')).toBeVisible()
  })

  it('shows the loading state while pending', async () => {
    useUserById.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    await renderWithProviders(<TenantDetailPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
  })

  it('shows a not-found state on error', async () => {
    useUserById.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })
    await renderWithProviders(<TenantDetailPage />)

    expect(screen.getByText('Acest chiriaș nu există.')).toBeVisible()
  })
})
