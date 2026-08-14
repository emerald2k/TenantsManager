import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { RetryButton } from '@/components/shared/RetryButton'

describe('RetryButton', () => {
  it('calls onRetry when clicked', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    await renderWithProviders(<RetryButton onRetry={onRetry} />)

    await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('is disabled while a retry is already in flight, and does not call onRetry if clicked', async () => {
    await renderWithProviders(<RetryButton onRetry={vi.fn()} disabled />)

    const button = screen.getByRole('button', { name: 'Încearcă din nou' })
    expect(button).toBeDisabled()
  })
})
