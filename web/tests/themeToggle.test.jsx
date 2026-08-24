import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useTheme } from '@/features/theme/useTheme'

vi.mock('@/features/theme/useTheme', () => ({ useTheme: vi.fn() }))

const toggleTheme = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ThemeToggle (NFR-UX-04)', () => {
  it('labels itself with the CURRENT theme when currently light', async () => {
    useTheme.mockReturnValue({ theme: 'light', toggleTheme })

    await renderWithProviders(<ThemeToggle />)

    expect(
      screen.getByRole('button', { name: 'Temă · Deschisă' }),
    ).toBeVisible()
  })

  it('labels itself with the CURRENT theme when currently dark', async () => {
    useTheme.mockReturnValue({ theme: 'dark', toggleTheme })

    await renderWithProviders(<ThemeToggle />)

    expect(screen.getByRole('button', { name: 'Temă · Închisă' })).toBeVisible()
  })

  it('calls toggleTheme on click', async () => {
    useTheme.mockReturnValue({ theme: 'light', toggleTheme })
    const user = userEvent.setup()

    await renderWithProviders(<ThemeToggle />)

    await user.click(screen.getByRole('button'))

    expect(toggleTheme).toHaveBeenCalledTimes(1)
  })
})
