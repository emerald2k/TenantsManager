import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { SendReportNotificationControl } from '@/features/reports/components/SendReportNotificationControl'
import { useSendReportNotification } from '@/features/reports/hooks'

vi.mock('@/features/reports/hooks', () => ({
  useSendReportNotification: vi.fn(),
}))

const sendMutateAsync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  sendMutateAsync.mockResolvedValue({})
  useSendReportNotification.mockReturnValue({
    mutateAsync: sendMutateAsync,
    isPending: false,
  })
})

describe('SendReportNotificationControl', () => {
  it('opens the dialog on click, offering both template choices', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SendReportNotificationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite pe email'))

    expect(screen.getByText('Raport nou')).toBeVisible()
    expect(screen.getByText('Raport actualizat')).toBeVisible()
  })

  it('sends template "new" and shows a success message', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SendReportNotificationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite pe email'))
    await user.click(screen.getByText('Raport nou'))

    expect(sendMutateAsync).toHaveBeenCalledWith({ id: 'r1', template: 'new' })
    expect(await screen.findByText('Emailul a fost trimis.')).toBeVisible()
  })

  it('sends template "updated" when that choice is picked', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SendReportNotificationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite pe email'))
    await user.click(screen.getByText('Raport actualizat'))

    expect(sendMutateAsync).toHaveBeenCalledWith({
      id: 'r1',
      template: 'updated',
    })
  })

  it('shows an error message INSIDE the still-open dialog if sending fails', async () => {
    const user = userEvent.setup()
    sendMutateAsync.mockRejectedValue(new Error('internal'))
    await renderWithProviders(
      <SendReportNotificationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite pe email'))
    await user.click(screen.getByText('Raport nou'))

    // Scoped through the dialog's role: getByRole DOES respect aria-hidden,
    // unlike findByText/toBeVisible — this is what would have caught the
    // error message being painted in the (now aria-hidden) outer wrapper
    // instead of inside DialogContent.
    const dialog = screen.getByRole('dialog')
    expect(
      await within(dialog).findByText(
        'Emailul nu a putut fi trimis. Încearcă din nou.',
      ),
    ).toBeVisible()
    // The dialog is still open and usable — both choices are still there.
    expect(within(dialog).getByText('Raport nou')).toBeVisible()
    expect(within(dialog).getByText('Raport actualizat')).toBeVisible()
  })

  it('closes the dialog via the Cancel button without sending anything', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SendReportNotificationControl report={{ id: 'r1' }} />,
    )

    await user.click(screen.getByText('Trimite pe email'))
    await user.click(screen.getByText('Anulează'))

    expect(sendMutateAsync).not.toHaveBeenCalled()
  })
})
