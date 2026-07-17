import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from './renderWithProviders'
import { PropertyDetailPage } from '@/features/properties/pages/PropertyDetailPage'
import { useProperty } from '@/features/properties/hooks'

// Fast band — the boundary (the hook) is mocked, no emulator.
//
// SCOPE, deliberately narrow: `PropertyDetailPage` is a throwaway placeholder that
// sub-stage D rewrites, so the "renders the name" branch stays uncovered here (the
// browser run and D's own tests cover it). The not-found branch is the exception:
// it SURVIVES into D, so it gets a test (CLAUDE.md §7).
vi.mock('@/features/properties/hooks', () => ({
  useProperty: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PropertyDetailPage', () => {
  it('shows the not-found message when the property does not exist', async () => {
    // The shape `useProperty` really produces for a missing id: B's hook throws
    // when the snapshot does not exist, so react-query lands on isError with no
    // data — it does not resolve to undefined.
    useProperty.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })

    await renderWithProviders(
      <Routes>
        <Route path="/admin/properties/:id" element={<PropertyDetailPage />} />
      </Routes>,
      { route: '/admin/properties/does-not-exist' },
    )

    expect(screen.getByText('Această proprietate nu există.')).toBeVisible()
    // No crash, and no property rendered: the name would come through as the
    // page's only heading.
    expect(screen.queryByRole('heading')).toBeNull()
  })
})
