import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { DateInWords } from '@/components/shared/DateInWords'

// Fast band — pure presentational. It states the resolved date of a native
// <input type="date"> in words, because the input's own rendering follows
// the browser/OS locale and ignores `lang` (2026-08-31 UI/UX audit #3).

describe('DateInWords', () => {
  it('spells the date in Romanian by default', async () => {
    await renderWithProviders(<DateInWords value="2026-08-10" />)

    expect(screen.getByText('10 august 2026')).toBeVisible()
  })

  it('spells the date in English when the interface is English', async () => {
    await renderWithProviders(<DateInWords value="2026-08-10" />, {
      language: 'en',
    })

    expect(screen.getByText('August 10, 2026')).toBeVisible()
  })

  it('renders NOTHING for an empty value — no placeholder, no dash (NFR-UX-08)', async () => {
    const { container } = await renderWithProviders(<DateInWords value="" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a half-typed / unparseable value', async () => {
    const { container } = await renderWithProviders(
      <DateInWords value="2026-08" />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
