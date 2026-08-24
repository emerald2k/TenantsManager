import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import { renderWithProviders } from './renderWithProviders'
import { useAuth } from '@/features/auth/useAuth'
import { useMyTenancy } from '@/features/tenantApp/hooks'
import { useTheme } from '@/features/theme/useTheme'
import { TenantLayout } from '@/routes/TenantLayout'
import { TenantContractPage } from '@/features/tenantApp/pages/TenantContractPage'

// M5 sub-stage 9 plan
// (docs/superpowers/plans/2026-08-04-m5-substage9-ended-contract-banner.md,
// §9.1). First dedicated layout-level test in this project (no
// guards.jsx/AdminLayout.jsx test exists either) — justified because the
// banner has real conditional logic (status, endedAt presence, per-language
// date formatting) worth covering directly.
//
// `endedAt` uses the REAL `Timestamp.fromDate` from `firebase/firestore`
// (not a hand-rolled `{ toDate: () => ... }` stub) — same convention
// tenantApp.hooks.test.jsx already established.

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/features/tenantApp/hooks', () => ({
  useMyTenancy: vi.fn(),
}))
// TenantLayout now also mounts <ThemeToggle> (M8 stage 8, NFR-UX-04), which
// needs a <ThemeProvider> ancestor — mocked here, same convention as
// useAuth: this file is not about the theme toggle's own behavior.
vi.mock('@/features/theme/useTheme', () => ({ useTheme: vi.fn() }))

function tenancyFixture(overrides = {}) {
  return {
    id: 'tenancy-1',
    status: 'active',
    property: { name: 'Apartament Test' },
    ...overrides,
  }
}

function query(overrides = {}) {
  return { isPending: false, isError: false, data: undefined, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user: { uid: 'tenant-1' }, logout: vi.fn() })
  useTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
})

describe('TenantLayout — ended-contract banner (FR-TAPP-06)', () => {
  it('L1 — ended tenancy with endedAt shows the persistent banner', async () => {
    useMyTenancy.mockReturnValue(
      query({
        data: tenancyFixture({
          status: 'ended',
          endedAt: Timestamp.fromDate(new Date('2026-01-31')),
        }),
      }),
    )

    await renderWithProviders(<TenantLayout />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent(/Contract încheiat pe/)
  })

  it('L2 — active tenancy shows NO banner', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))

    await renderWithProviders(<TenantLayout />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('L3 — no tenancy at all shows NO banner, no crash', async () => {
    useMyTenancy.mockReturnValue(query({ data: null }))

    await renderWithProviders(<TenantLayout />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('L4 — ended tenancy with endedAt ABSENT shows NO banner, no crash', async () => {
    const fixture = tenancyFixture({ status: 'ended' })
    delete fixture.endedAt
    useMyTenancy.mockReturnValue(query({ data: fixture }))

    await renderWithProviders(<TenantLayout />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('L5 — the date renders with the LONG month name, not numeric', async () => {
    useMyTenancy.mockReturnValue(
      query({
        data: tenancyFixture({
          status: 'ended',
          endedAt: Timestamp.fromDate(new Date('2026-01-31')),
        }),
      }),
    )

    await renderWithProviders(<TenantLayout />)

    expect(
      screen.getByText('Contract încheiat pe 31 ianuarie 2026'),
    ).toBeVisible()
  })

  it('L6 — the locale is READ from i18n, not hardcoded (English renders "January")', async () => {
    useMyTenancy.mockReturnValue(
      query({
        data: tenancyFixture({
          status: 'ended',
          endedAt: Timestamp.fromDate(new Date('2026-01-31')),
        }),
      }),
    )

    await renderWithProviders(<TenantLayout />, { language: 'en' })

    expect(screen.getByText('Contract ended on January 31, 2026')).toBeVisible()
  })

  it("L-CONTRACT — supersedes CT10 (tenantApp.contractPage.test.jsx, sub-stage 7): the banner reaches /app/contract, mounted via TenantLayout wrapping TenantContractPage. CT10's original premise — that an ended tenancy viewing /app/contract sees no banner — is FALSE once the layout is in the tree; TenantContractPage on its own (CT10's own render, without TenantLayout) legitimately still shows none, which is why CT10 itself was not deleted, only its docstring corrected.", async () => {
    useMyTenancy.mockReturnValue(
      query({
        data: tenancyFixture({
          status: 'ended',
          endedAt: Timestamp.fromDate(new Date('2026-01-31')),
          property: {
            name: 'Apartament Zorilor',
            address: {
              street: 'Str. Zorilor',
              number: '12',
              city: 'Cluj-Napoca',
            },
          },
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          monthlyRent: 2500,
          securityDeposit: 1800,
          dueDay: 10,
          attachedDocuments: [],
        }),
      }),
    )

    await renderWithProviders(
      <Routes>
        <Route element={<TenantLayout />}>
          <Route index element={<TenantContractPage />} />
        </Route>
      </Routes>,
    )

    expect(
      screen.getByText('Contract încheiat pe 31 ianuarie 2026'),
    ).toBeVisible()
    expect(screen.getByText('Apartament Zorilor')).toBeVisible()
  })
})
