import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { MoneyAmount } from '@/components/shared/MoneyAmount'

async function renderAmount(props) {
  await i18n.changeLanguage('ro')
  return render(
    <I18nextProvider i18n={i18n}>
      <span data-testid="cell">
        <MoneyAmount {...props} />
      </span>
    </I18nextProvider>,
  )
}

describe('MoneyAmount (M8 stage 10)', () => {
  it('renders "—" for null — no figure yet', async () => {
    await renderAmount({ value: null })
    expect(screen.getByTestId('cell').textContent).toBe('—')
  })

  it('renders "—" for undefined too', async () => {
    await renderAmount({ value: undefined })
    expect(screen.getByTestId('cell').textContent).toBe('—')
  })

  it('formats a positive value through formatCurrency, not as a bare number', async () => {
    await renderAmount({ value: 2730 })
    expect(screen.getByTestId('cell').textContent).toBe('2.730,00 lei')
  })

  it('emphasizes a positive value in the destructive colour by default (arrears)', async () => {
    await renderAmount({ value: 500 })
    expect(
      screen.getByTestId('cell').querySelector('.text-destructive'),
    ).not.toBeNull()
  })

  it('emphasizePositive=false renders a positive value plainly (an ordinary bill, not arrears)', async () => {
    await renderAmount({ value: 500, emphasizePositive: false })
    expect(
      screen.getByTestId('cell').querySelector('.text-destructive'),
    ).toBeNull()
  })

  it('a zero value is never emphasized', async () => {
    await renderAmount({ value: 0 })
    expect(
      screen.getByTestId('cell').querySelector('.text-destructive'),
    ).toBeNull()
    expect(screen.getByTestId('cell').textContent).toBe('0,00 lei')
  })

  it('a negative value renders as a positive figure labelled Credit, never a bare negative number (§5.5)', async () => {
    await renderAmount({ value: -150 })
    const text = screen.getByTestId('cell').textContent
    expect(text).toBe('150,00 lei (Credit)')
    expect(text).not.toContain('-150')
  })

  it('a negative value is never emphasized, regardless of emphasizePositive', async () => {
    await renderAmount({ value: -150, emphasizePositive: true })
    expect(
      screen.getByTestId('cell').querySelector('.text-destructive'),
    ).toBeNull()
  })
})
