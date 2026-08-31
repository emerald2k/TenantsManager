import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './renderWithProviders'
import { PageHeader } from '@/components/shared/PageHeader'

describe('PageHeader', () => {
  it('renders the title as an h1', async () => {
    await renderWithProviders(<PageHeader title="Proprietăți" />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Proprietăți' }),
    ).toBeVisible()
  })

  it('renders the actions slot when given', async () => {
    await renderWithProviders(
      <PageHeader title="Proprietăți" actions={<button>Adaugă</button>} />,
    )

    expect(screen.getByRole('button', { name: 'Adaugă' })).toBeVisible()
  })

  it('renders no empty actions wrapper when actions is omitted', async () => {
    const { container } = await renderWithProviders(
      <PageHeader title="Proprietăți" />,
    )

    // Only the h1 should be inside the header row — no leftover empty div.
    expect(container.querySelector('h1 + div')).toBeNull()
  })
})
