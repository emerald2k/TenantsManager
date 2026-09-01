import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { useAuth } from '@/features/auth/useAuth'
import { useAdminEmailConfigured } from '@/features/system/hooks'
import { useTheme } from '@/features/theme/useTheme'
import { AdminLayout } from '@/routes/AdminLayout'

// First dedicated AdminLayout test (same justification TenantLayout's own
// first test gave: the banner has real conditional logic — FR-SYS-07 —
// worth covering directly, not just trusting the wiring by inspection).

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/features/system/hooks', () => ({
  useAdminEmailConfigured: vi.fn(),
}))
// AdminLayout now also mounts <ThemeToggle> (M8 stage 8, NFR-UX-04), which
// needs a <ThemeProvider> ancestor — mocked here, same convention as
// useAuth: this file is not about the theme toggle's own behavior
// (ThemeToggle has its own dedicated test).
vi.mock('@/features/theme/useTheme', () => ({ useTheme: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ logout: vi.fn() })
  useTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() })
})

describe('AdminLayout — configuration banner (FR-SYS-07)', () => {
  it('shows the banner above the sidebar/content when ADMIN_EMAIL is not configured', async () => {
    useAdminEmailConfigured.mockReturnValue({ data: false })

    await renderWithProviders(<AdminLayout />)

    expect(screen.getByRole('alert')).toBeVisible()
  })

  it('shows no banner when ADMIN_EMAIL is configured', async () => {
    useAdminEmailConfigured.mockReturnValue({ data: true })

    await renderWithProviders(<AdminLayout />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('still renders the nav/sidebar regardless of the banner state', async () => {
    useAdminEmailConfigured.mockReturnValue({ data: false })

    await renderWithProviders(<AdminLayout />)

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  })

  // audit #6 — the rail is viewport-height + sticky + its OWN scroll area, so
  // its footer (sign-out / language / theme) stays put on a long page. jsdom
  // has no layout, so this only guards the class contract against a
  // regression to `min-h-svh` (which let the rail stretch to page height and
  // dropped the footer below the fold); the visual check is a browser step.
  it('the side rail is h-svh + sticky + overflow-y-auto, never min-h-svh', async () => {
    useAdminEmailConfigured.mockReturnValue({ data: true })

    await renderWithProviders(<AdminLayout />)

    const aside = screen.getByRole('complementary')
    expect(aside.className).toContain('h-svh')
    expect(aside.className).toContain('sticky')
    expect(aside.className).toContain('overflow-y-auto')
    expect(aside.className).not.toContain('min-h-svh')
  })
})
