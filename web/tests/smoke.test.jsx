import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { renderWithProviders } from './renderWithProviders'

// Smoke test for the testing foundation (sub-stage A): it checks the harness, not
// the product. The components tested here are defined inline, deliberately — at A
// there was no product code to test yet, and the point is to prove the fast band
// works: jsdom + RTL + jest-dom + user-event + the providers from renderWithProviders.
//
// The expected strings 'Limbă'/'Language' are Romanian/English on purpose: they
// come from locales/, where Romanian is displayed content, not working language.

function Greeting() {
  const { t } = useTranslation()
  return <p>{t('common.language')}</p>
}

function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>Clicks: {count}</button>
}

function CurrentPath() {
  return <span>Route: {useLocation().pathname}</span>
}

describe('testing foundation — fast band', () => {
  it('renders a component and applies the jest-dom matchers', async () => {
    await renderWithProviders(<Greeting />)

    expect(screen.getByText('Limbă')).toBeInTheDocument()
  })

  it('translates through the real i18n instance, in the requested language', async () => {
    await renderWithProviders(<Greeting />, { language: 'en' })

    expect(screen.getByText('Language')).toBeInTheDocument()
  })

  it('falls back to Romanian by default, with no language leaking between tests', async () => {
    await renderWithProviders(<Greeting />)

    expect(screen.getByText('Limbă')).toBeInTheDocument()
  })

  it('processes interactions through user-event', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<Counter />)

    await user.click(screen.getByRole('button', { name: 'Clicks: 0' }))

    expect(
      screen.getByRole('button', { name: 'Clicks: 1' }),
    ).toBeInTheDocument()
  })

  it('places the component on the requested route from the router', async () => {
    await renderWithProviders(<CurrentPath />, { route: '/admin/properties' })

    expect(screen.getByText('Route: /admin/properties')).toBeInTheDocument()
  })
})
