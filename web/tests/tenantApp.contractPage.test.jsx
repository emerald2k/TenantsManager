import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
// `AttachmentLink` (debt #5) resolves `path` -> url via `useAttachmentUrl` —
// mocked at this boundary (not `firebase/storage`) since this page otherwise
// has no Storage dependency of its own; same convention as reports.page.test.jsx.
vi.mock('@/lib/useAttachmentUrl', () => ({ useAttachmentUrl: vi.fn() }))

import { useAttachmentUrl } from '@/lib/useAttachmentUrl'

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
  // Echoes the path back as a resolved url — lets each test predict the
  // rendered href from the fixture's own `path`.
  useAttachmentUrl.mockImplementation((path) => ({
    url: path ? `https://storage.example/resolved/${path}` : undefined,
    isLoading: false,
    isError: false,
  }))
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

  it('CT12 — clicking Retry on the error state re-runs the tenancy query', async () => {
    const refetch = vi.fn()
    useMyTenancy.mockReturnValue(
      query({ isError: true, isFetching: false, refetch }),
    )
    const user = userEvent.setup()
    await renderWithProviders(<TenantContractPage />)

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

    expect(refetch).toHaveBeenCalledTimes(1)
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

  it("CT6 — two documents render as two links, each href resolved from that document's own path", async () => {
    useMyTenancy.mockReturnValue(
      query({
        data: tenancyFixture({
          attachedDocuments: [
            {
              path: 'tenancies/tenancy-1/contract/contract.pdf',
              name: 'contract.pdf',
              type: 'pdf',
            },
            {
              path: 'tenancies/tenancy-1/contract/addendum.pdf',
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
      'https://storage.example/resolved/tenancies/tenancy-1/contract/contract.pdf',
    )
    expect(screen.getByRole('link', { name: /addendum\.pdf/ })).toHaveAttribute(
      'href',
      'https://storage.example/resolved/tenancies/tenancy-1/contract/addendum.pdf',
    )
  })

  it('CT11 — a document whose URL fails to resolve (Storage rule denial) renders inert "unavailable" text, never a clickable dead link', async () => {
    useAttachmentUrl.mockReturnValue({
      url: undefined,
      isLoading: false,
      isError: true,
    })
    useMyTenancy.mockReturnValue(
      query({
        data: tenancyFixture({
          attachedDocuments: [
            {
              path: 'tenancies/tenancy-1/contract/contract.pdf',
              name: 'contract.pdf',
              type: 'pdf',
            },
          ],
        }),
      }),
    )

    await renderWithProviders(<TenantContractPage />)

    expect(screen.getByText(/Indisponibil/)).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /contract\.pdf/ }),
    ).not.toBeInTheDocument()
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

  it('CT13 — startDate and endDate render as long-form dates, not raw ISO', async () => {
    useMyTenancy.mockReturnValue(
      query({
        data: tenancyFixture({
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      }),
    )

    await renderWithProviders(<TenantContractPage />)

    expect(valueFor('Dată început')).toHaveTextContent('1 ianuarie 2026')
    expect(valueFor('Dată sfârșit')).toHaveTextContent('31 decembrie 2026')
  })

  it('CT14 — startDate and endDate follow the interface language, not a hardcoded locale', async () => {
    useMyTenancy.mockReturnValue(
      query({
        data: tenancyFixture({
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      }),
    )

    await renderWithProviders(<TenantContractPage />, { language: 'en' })

    expect(valueFor('Start date')).toHaveTextContent('January 1, 2026')
    expect(valueFor('End date')).toHaveTextContent('December 31, 2026')
  })

  it('CT9 — property address renders the full formatted string, not just the property name', async () => {
    useMyTenancy.mockReturnValue(query({ data: tenancyFixture() }))

    await renderWithProviders(<TenantContractPage />)

    expect(screen.getByText('Str. Zorilor 12, Cluj-Napoca')).toBeVisible()
  })

  it("CT10 — PERMANENT architectural-boundary test (corrected at sub-stage 9; originally written at sub-stage 7 expecting a TEMPORARY same-file supersedure, mirroring HP7 — that premise was wrong): TenantContractPage rendered ALONE, with no TenantLayout, still shows no ended-tenancy banner, regardless of fixture. This page never owned that responsibility — FR-TAPP-06's persistent banner is mounted once in TenantLayout (M5 sub-stage 9 plan), not per page, so this component legitimately renders none on its own. The banner's actual behavior — including that it DOES reach /app/contract once TenantLayout wraps this page — is proven by web/tests/tenantLayout.test.jsx's own L-CONTRACT test, which explicitly supersedes CT10's ORIGINAL claim (that an ended tenancy viewing /app/contract sees no banner at all)", async () => {
    useMyTenancy.mockReturnValue(
      query({ data: tenancyFixture({ status: 'ended' }) }),
    )

    await renderWithProviders(<TenantContractPage />)

    expect(screen.queryByText(/contract.*încheiat/i)).not.toBeInTheDocument()
  })
})
