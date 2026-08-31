import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { useAuth } from '@/features/auth/useAuth'
import { useAdminEmailConfigured } from '@/features/system/hooks'
import { useTheme } from '@/features/theme/useTheme'
import { AdminPhoneShell } from '@/routes/AdminPhoneShell'

// M8 stage 15b — the < 700 px admin shell (NFR-UX-03). jsdom cannot measure
// tap targets or see the layout; these tests cover the structure the SRS
// fixes: a five-item bottom bar, an icon-only bell with NO count (owner
// decision 2026-08-30), and a "More" sheet holding the two off-bar routes
// plus Language / Theme / Sign-out.

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/features/system/hooks', () => ({
  useAdminEmailConfigured: vi.fn(),
}))
vi.mock('@/features/theme/useTheme', () => ({ useTheme: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ logout: vi.fn() })
  useAdminEmailConfigured.mockReturnValue({ data: true })
  useTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
})

describe('AdminPhoneShell — the bottom tab bar', () => {
  it('has exactly five items: Panou · Luna · Plăți · Chiriași · Mai multe', async () => {
    await renderWithProviders(<AdminPhoneShell />, { route: '/admin' })
    const bar = screen.getByRole('navigation')
    expect(within(bar).getByRole('link', { name: 'Panou' })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(within(bar).getByRole('link', { name: 'Luna' })).toHaveAttribute(
      'href',
      '/admin/current-month',
    )
    expect(within(bar).getByRole('link', { name: 'Plăți' })).toBeInTheDocument()
    expect(
      within(bar).getByRole('link', { name: 'Chiriași' }),
    ).toBeInTheDocument()
    expect(
      within(bar).getByRole('button', { name: 'Mai multe' }),
    ).toBeInTheDocument()
    // Five: four links + the More button. Nothing else.
    expect(within(bar).getAllByRole('link')).toHaveLength(4)
  })
})

describe('AdminPhoneShell — the title bar', () => {
  it('carries an icon-only bell to the notification log, with NO numeric badge', async () => {
    await renderWithProviders(<AdminPhoneShell />, { route: '/admin' })
    const header = screen.getByRole('banner')
    const bell = within(header).getByRole('link', { name: 'Notificări' })
    expect(bell).toHaveAttribute('href', '/admin/notifications')
    // Icon only — no text, and specifically no digit (unread count).
    expect(bell.textContent).toBe('')
  })

  it('carries an icon-only theme toggle', async () => {
    const toggleTheme = vi.fn()
    useTheme.mockReturnValue({ theme: 'light', toggleTheme })
    const user = userEvent.setup()
    await renderWithProviders(<AdminPhoneShell />, { route: '/admin' })
    const header = screen.getByRole('banner')
    await user.click(
      within(header).getByRole('button', { name: 'Comută tema' }),
    )
    expect(toggleTheme).toHaveBeenCalled()
  })

  it('shows the full section name for the current route', async () => {
    await renderWithProviders(<AdminPhoneShell />, {
      route: '/admin/current-month',
    })
    expect(
      screen.getByRole('heading', { name: 'Luna curentă' }),
    ).toBeInTheDocument()
  })
})

describe('AdminPhoneShell — the "More" sheet', () => {
  it('opens with the two off-bar routes plus Language, Theme and Sign-out', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<AdminPhoneShell />, { route: '/admin' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mai multe' }))

    const sheet = screen.getByRole('dialog')
    expect(
      within(sheet).getByRole('link', { name: 'Proprietăți' }),
    ).toHaveAttribute('href', '/admin/properties')
    expect(
      within(sheet).getByRole('link', { name: 'Notificări' }),
    ).toHaveAttribute('href', '/admin/notifications')
    // Language switcher (RO/EN chips) and the labelled theme state row.
    expect(
      within(sheet).getByRole('button', { name: 'RO' }),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByRole('button', { name: 'Temă · Deschisă' }),
    ).toBeInTheDocument()
    expect(
      within(sheet).getByRole('button', { name: 'Deconectare' }),
    ).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<AdminPhoneShell />, { route: '/admin' })
    await user.click(screen.getByRole('button', { name: 'Mai multe' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Sign-out from the sheet calls logout', async () => {
    const logout = vi.fn()
    useAuth.mockReturnValue({ logout })
    const user = userEvent.setup()
    await renderWithProviders(<AdminPhoneShell />, { route: '/admin' })
    await user.click(screen.getByRole('button', { name: 'Mai multe' }))
    await user.click(screen.getByRole('button', { name: 'Deconectare' }))
    expect(logout).toHaveBeenCalled()
  })
})
