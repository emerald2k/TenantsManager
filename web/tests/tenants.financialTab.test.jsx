import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { FinancialTab } from '@/features/tenants/components/FinancialTab'

// monthlyReports is M4 (not built yet) — this is a pure empty state, no
// collection, no hook, no fetch. If FinancialTab ever imports a data hook,
// this file has nothing mocking it and would fail loudly instead of silently
// passing.

describe('FinancialTab — empty state (M4 not built yet)', () => {
  it('renders the empty-state message', async () => {
    await renderWithProviders(<FinancialTab />)

    expect(screen.getByText('Niciun raport încă.')).toBeVisible()
  })
})
