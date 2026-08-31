import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { SendPaymentConfirmationControl } from '@/features/reports/components/SendPaymentConfirmationControl'
import { useSendPaymentConfirmation } from '@/features/reports/hooks'

vi.mock('@/features/reports/hooks', () => ({
  useSendPaymentConfirmation: vi.fn(),
}))

const sendMutateAsync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  sendMutateAsync.mockResolvedValue({})
  useSendPaymentConfirmation.mockReturnValue({
    mutateAsync: sendMutateAsync,
    isPending: false,
  })
})

describe('SendPaymentConfirmationControl (A10, FR-PAY-01)', () => {
  it('does not send until the confirm dialog is confirmed (affects the tenant — SRS §5.5)', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SendPaymentConfirmationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite confirmarea plății'))
    expect(sendMutateAsync).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByText('Trimite emailul'))

    expect(sendMutateAsync).toHaveBeenCalledWith({ id: 'r1' })
    expect(
      await screen.findByText('Confirmarea plății a fost trimisă chiriașului.'),
    ).toBeVisible()
  })

  it('cancelling the dialog sends nothing', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SendPaymentConfirmationControl report={{ id: 'r1' }} />,
    )
    await user.click(screen.getByText('Trimite confirmarea plății'))
    await user.click(screen.getByText('Anulează'))
    expect(sendMutateAsync).not.toHaveBeenCalled()
  })

  it('shows an error message when the send fails', async () => {
    sendMutateAsync.mockRejectedValue(new Error('internal'))
    const user = userEvent.setup()
    await renderWithProviders(
      <SendPaymentConfirmationControl report={{ id: 'r1' }} />,
    )
    await user.click(screen.getByText('Trimite confirmarea plății'))
    await user.click(
      within(screen.getByRole('dialog')).getByText('Trimite emailul'),
    )
    expect(
      await screen.findByText(
        'Confirmarea nu a putut fi trimisă. Încearcă din nou.',
      ),
    ).toBeVisible()
  })
})
