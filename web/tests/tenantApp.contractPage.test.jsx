import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { useAuth } from '@/features/auth/useAuth'
import { useMyTenancy } from '@/features/tenantApp/hooks'
import { TenantContractPage } from '@/features/tenantApp/pages/TenantContractPage'

// M5 sub-stage 7 plan
// (docs/superpowers/plans/2026-08-03-m5-substage7-tenant-contract.md).
// Fast band — `useAuth`, `useMyTenancy` mocked at the module boundary, same
// convention as every other tenant-app page test. No router mocking needed:
// this page uses no `useParams`/`useNavigate`.

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/features/tenantApp/hooks', () => ({ useMyTenancy: vi.fn() }))

// `monthlyRent` (2500) and `securityDeposit` (1800) are DELIBERATELY
// different values here. Every seeded tenancy has them equal, which would
// let a field-swap bug hide behind a page-wide text search — the RD6/H3
// lesson. Assertions below query each field's own label, then its own
// value cell, never a page-wide `getByText`.
function tenancyFixture(overrides = {}) {
  return {
    id: 'tenancy-1',
    property: {
      name: 'Apartament Zorilor',
      address: { street: 'Str. Zorilor', number: '12', city: 'Cluj-Napoca' },
    },
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    monthlyRent: 2500,
    securityDeposit: 1800,
    dueDay: 10,
    attachedDocuments: [],
    ...overrides,
  }
}

function query(overrides = {}) {
  return { isPending: false, isError: false, data: undefined, ...overrides }
}

/** Queries a field's own value cell via its label's next sibling — never a
 * page-wide `getByText`, so a value that happens to equal another field's
 * value (or a stray fragment of markup) cannot be mistaken for the right one. */
function valueFor(labelText) {
  return screen.getByText(labelText).nextSibling
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user: { uid: 'tenant-1' } })
})

describe('TenantContractPage', () => {
  it('CT1 — pending shows loading, nothing else', async () => {
    useMyTenancy.mockReturnValue(query({ isPending: true }))

    await renderWithProviders(<TenantContractPage />)

    expect(screen.getByText('Se încarcă...')).toBeVisible()
    expect(screen.queryByText('Documente')).not.toBeInTheDocument()
  })

  it('CT2 — error shows the error message only', async () => {
    useMyTenancy.mockReturnValue(query({ isError: true }))

    await renderWithProviders(<TenantContractPage />)

    expect(
      screen.getByText('Nu am putut încărca contractul. Încearcă din nou.'),
    ).toBeVisible()
  })

  it('CT3 — no tenancy shows the noTenancy message only', async () => {
    useMyTenancy.mockReturnValue(query({ data: null }))

    await renderWithProviders(<TenantContractPage />)

    expect(
      screen.getByText('Nu ai nicio locuință atribuită momentan.'),
    ).toBeVisible()
  })

  it('CT4 — attachedDocuments empty array shows contract fields + "not yet uploaded", no links', async () => {
    useMyTenancy.mockReturnValue(
      query({ data: tenancyFixture({ attachedDocuments: [] }) }),
    )

    await renderWithProviders(<TenantContractPage />)

    expect(
      screen.getByText('Contractul nu a fost încă încărcat.'),
    ).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('CT5 — attachedDocuments key ABSENT entirely behaves the same as an empty array (no crash)', async () => {
    const fixture = tenancyFixture()
    delete fixture.attachedDocuments

    useMyTenancy.mockReturnValue(query({ data: fixture }))

    await renderWithProviders(<TenantContractPage />)

    expect(
      screen.getByText('Contractul nu a fost încă încărcat.'),
    ).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it("CT6 — two documents render as two links, each href = that document's own url", async () => {
    useMyTenancy.mockReturnValue(
      query({
        data: tenancyFixture({
          attachedDocuments: [
            {
              url: 'https://storage.example/contract.pdf',
              name: 'contract.pdf',
              type: 'pdf',
            },
            {
              url: 'https://storage.example/addendum.pdf',
              name: 'addendum.pdf',
              type: 'pdf',
            },
          ],
        }),
      }),
    )

    await renderWithProviders(<TenantContractPage />)

    expect(screen.getByRole('link', { name: /contract\.pdf/ })).toHaveAttribute(
      'href',
      'https://storage.example/contract.pdf',
    )
    expect(screen.getByRole('link', { name: /addendum\.pdf/ })).toHaveAttribute(
      'href',
      'https://storage.example/addendum.pdf',
    )
  })

  it('CT7 — securityDeposit key absent renders "—" under its own label, NOT "0,00 lei"', async () => {
    const fixture = tenancyFixture()
    delete fixture.securityDeposit

    useMyTenancy.mockReturnValue(query({ data: fixture }))

    await renderWithProviders(<TenantContractPage />)

    expect(valueFor('Garanție')).toHaveTextContent('—')
  })

  it('CT8 — monthlyRent and securityDeposit each render formatted under their OWN label, not swapped', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))

    await renderWithProviders(<TenantContractPage />)

    expect(valueFor('Chirie lunară')).toHaveTextContent('2.500,00 lei')
    expect(valueFor('Garanție')).toHaveTextContent('1.800,00 lei')
  })

  it('CT9 — property address renders the full formatted string, not just the property name', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))

    await renderWithProviders(<TenantContractPage />)

    expect(screen.getByText('Str. Zorilor 12, Cluj-Napoca')).toBeVisible()
  })

  it("CT10 — no ended-tenancy banner renders, regardless of fixture (TEMPORARY: sub-stage 9, FR-TAPP-06, will deliberately add exactly this banner and supersede this test — a planned supersedure, not a future regression, exactly as sub-stage 6 superseded sub-stage 5's own HP7)", async () => {
    useMyTenancy.mockReturnValue(
      query({ data: tenancyFixture({ status: 'ended' }) }),
    )

    await renderWithProviders(<TenantContractPage />)

    expect(screen.queryByText(/contract.*încheiat/i)).not.toBeInTheDocument()
  })
})
