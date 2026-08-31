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

  it('shows the chronological-order error message when the server rejects an out-of-order sign (FR-REP-11)', async () => {
    const user = userEvent.setup()
    signMutateAsync.mockRejectedValue(
      Object.assign(new Error('failed-precondition'), {
        details: {
          reason: 'chronological-order',
          blockingMonth: 8,
          blockingYear: 2026,
        },
      }),
    )
    await renderWithProviders(
      <SignReportControl report={{ id: 'r1', status: 'draft' }} />,
    )

    await user.click(screen.getByText('Semnează lista'))
    await user.click(screen.getByText('Semnează'))

    expect(
      await screen.findByText(/deblochează toate rapoartele semnate/),
    ).toBeVisible()
  })
})

describe('SignReportControl — FR-REP-04e second confirmation on a material override', () => {
  function divergedReport(overrides) {
    return {
      id: 'r1',
      status: 'draft',
      calculatedTotal: 3000,
      finalTotal: 2500, // -500 diff, well past max(5, 1%*3000)=30
      roundingSurplus: 0,
      ...overrides,
    }
  }

  it('disables the confirm button until a reason is typed, then signs with it', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<SignReportControl report={divergedReport()} />)

    await user.click(screen.getByText('Semnează lista'))
    expect(
      screen.getByText(
        'Ajustezi totalul cu -500,00 lei față de totalul calculat.',
      ),
    ).toBeVisible()
    const confirmButton = screen.getByText('Semnează')
    expect(confirmButton).toBeDisabled()

    await user.type(
      screen.getByLabelText('Motivul ajustării'),
      'Reducere negociată cu chiriașul',
    )
    expect(confirmButton).not.toBeDisabled()

    await user.click(confirmButton)
    expect(signMutateAsync).toHaveBeenCalledWith({
      id: 'r1',
      overrideReason: 'Reducere negociată cu chiriașul',
    })
  })

  it('does NOT require a reason when the divergence is the rounding action (roundingSurplus > 0)', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SignReportControl
        report={divergedReport({ finalTotal: 3010, roundingSurplus: 10 })}
      />,
    )

    await user.click(screen.getByText('Semnează lista'))
    expect(screen.queryByLabelText('Motivul ajustării')).not.toBeInTheDocument()

    await user.click(screen.getByText('Semnează'))
    expect(signMutateAsync).toHaveBeenCalledWith({ id: 'r1' })
  })

  it('DOES require a reason when a cost-line edit after rounding leaves the surplus no longer explaining the gap (closed loophole)', async () => {
    const user = userEvent.setup()
    // Rounded to 1520 from 1513 (surplus 7) — then a cost line moved
    // calculatedTotal to 1550 without finalTotal following (frozen since
    // rounding set it dirty). The 7-lei surplus no longer accounts for the
    // real -30 gap, so the guard must re-activate despite roundingSurplus > 0.
    await renderWithProviders(
      <SignReportControl
        report={divergedReport({
          calculatedTotal: 1550,
          finalTotal: 1520,
          roundingSurplus: 7,
        })}
      />,
    )

    await user.click(screen.getByText('Semnează lista'))
    expect(screen.getByLabelText('Motivul ajustării')).toBeVisible()
  })

  it('does NOT require a reason for a divergence within the threshold', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <SignReportControl
        report={divergedReport({ calculatedTotal: 3000, finalTotal: 2995 })}
      />,
    )

    await user.click(screen.getByText('Semnează lista'))
    expect(screen.queryByLabelText('Motivul ajustării')).not.toBeInTheDocument()
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
