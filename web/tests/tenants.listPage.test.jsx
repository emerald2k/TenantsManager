import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { TenantsListPage } from '@/features/tenants/pages/TenantsListPage'
import { useCreateDraft } from '@/features/onboarding/hooks'

// Fast band — the hook IS the boundary; we mock it, not firebase/firestore.
vi.mock('@/features/onboarding/hooks', () => ({
  useCreateDraft: vi.fn(),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const mutateAsync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mutateAsync.mockResolvedValue('draft-1')
  useCreateDraft.mockReturnValue({ mutateAsync, isPending: false })
})

describe('TenantsListPage', () => {
  it('renders only the onboarding entry point — no table, no search', async () => {
    await renderWithProviders(<TenantsListPage />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('creates a draft and navigates to the wizard on click', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<TenantsListPage />)

    await user.click(
      screen.getByRole('button', { name: 'Onboarding chiriaș nou' }),
    )

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith()
    })
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/admin/onboarding/draft-1')
    })
  })

  it('reports the failure and stays put when draft creation fails', async () => {
    const user = userEvent.setup()
    mutateAsync.mockRejectedValue(new Error('permission-denied'))
    await renderWithProviders(<TenantsListPage />)

    await user.click(
      screen.getByRole('button', { name: 'Onboarding chiriaș nou' }),
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Draftul nu a putut fi creat. Încearcă din nou.',
      )
    })
    expect(navigate).not.toHaveBeenCalled()
  })
})
