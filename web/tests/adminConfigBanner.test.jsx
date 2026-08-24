import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { AdminConfigBanner } from '@/components/shared/AdminConfigBanner'
import { useAdminEmailConfigured } from '@/features/system/hooks'

vi.mock('@/features/system/hooks', () => ({
  useAdminEmailConfigured: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AdminConfigBanner (FR-SYS-07)', () => {
  it('renders nothing while the check is pending', async () => {
    useAdminEmailConfigured.mockReturnValue({ data: undefined })

    await renderWithProviders(<AdminConfigBanner />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders nothing when ADMIN_EMAIL is confirmed configured', async () => {
    useAdminEmailConfigured.mockReturnValue({ data: true })

    await renderWithProviders(<AdminConfigBanner />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the persistent warning when ADMIN_EMAIL is confirmed NOT configured', async () => {
    useAdminEmailConfigured.mockReturnValue({ data: false })

    await renderWithProviders(<AdminConfigBanner />)

    expect(screen.getByRole('alert')).toHaveTextContent('ADMIN_EMAIL')
  })

  it('has no dismiss control — the banner is persistent by design', async () => {
    useAdminEmailConfigured.mockReturnValue({ data: false })

    await renderWithProviders(<AdminConfigBanner />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
