import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { SignReportControl } from '@/features/reports/components/SignReportControl'
import { useSignReport, useUnlockReport } from '@/features/reports/hooks'

vi.mock('@/features/reports/hooks', () => ({
  useSignReport: vi.fn(),
  useUnlockReport: vi.fn(),
}))

const signMutateAsync = vi.fn()
const unlockMutateAsync = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  signMutateAsync.mockResolvedValue({})
  unlockMutateAsync.mockResolvedValue({})
  useSignReport.mockReturnValue({
    mutateAsync: signMutateAsync,
    isPending: false,
  })
  useUnlockReport.mockReturnValue({
    mutateAsync: unlockMutateAsync,
    isPending: false,
  })
})

describe('SignReportControl — draft report', () => {
  it('shows the Sign button; confirming calls signReport with the report id', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SignReportControl report={{ id: 'r1', status: 'draft' }} />,
    )

    await user.click(screen.getByText('Semnează lista'))
    expect(
      screen.getByText('Lista devine finală și blocată pentru editare.'),
    ).toBeVisible()

    await user.click(screen.getByText('Semnează'))
    expect(signMutateAsync).toHaveBeenCalledWith({ id: 'r1' })
  })

  it('shows an error and keeps the dialog open if signing fails', async () => {
    const user = userEvent.setup()
    signMutateAsync.mockRejectedValue(new Error('failed-precondition'))
    await renderWithProviders(
      <SignReportControl report={{ id: 'r1', status: 'draft' }} />,
    )

    await user.click(screen.getByText('Semnează lista'))
    await user.click(screen.getByText('Semnează'))

    expect(
      await screen.findByText('Lista nu a putut fi semnată. Încearcă din nou.'),
    ).toBeVisible()
  })
})

describe('SignReportControl — signed report', () => {
  it('shows the Unlock button; confirming calls unlockReport with the report id', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SignReportControl report={{ id: 'r1', status: 'signed' }} />,
    )

    await user.click(screen.getByText('Deblochează pentru corecție'))
    await user.click(screen.getByText('Deblochează'))

    expect(unlockMutateAsync).toHaveBeenCalledWith({ id: 'r1' })
  })

  it('shows an error if unlocking fails', async () => {
    const user = userEvent.setup()
    unlockMutateAsync.mockRejectedValue(new Error('failed-precondition'))
    await renderWithProviders(
      <SignReportControl report={{ id: 'r1', status: 'signed' }} />,
    )

    await user.click(screen.getByText('Deblochează pentru corecție'))
    await user.click(screen.getByText('Deblochează'))

    expect(
      await screen.findByText(
        'Raportul nu a putut fi deblocat. Încearcă din nou.',
      ),
    ).toBeVisible()
  })
})
