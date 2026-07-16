import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { renderWithProviders } from './renderWithProviders'

// Smoke-ul fundației de testare (sub-etapa A): verifică harness-ul, nu produsul.
// Componentele testate aici sunt definite inline, intenționat — la A nu există
// încă cod de produs de testat, iar scopul e să dovedim că banda rapidă merge:
// jsdom + RTL + jest-dom + user-event + providerii din renderWithProviders.

function Greeting() {
  const { t } = useTranslation()
  return <p>{t('common.language')}</p>
}

function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>Clicuri: {count}</button>
}

function CurrentPath() {
  return <span>Ruta: {useLocation().pathname}</span>
}

describe('fundația de testare — banda rapidă', () => {
  it('randează un component și aplică matcherele jest-dom', async () => {
    await renderWithProviders(<Greeting />)

    expect(screen.getByText('Limbă')).toBeInTheDocument()
  })

  it('traduce prin instanța reală de i18n, în limba cerută', async () => {
    await renderWithProviders(<Greeting />, { language: 'en' })

    expect(screen.getByText('Language')).toBeInTheDocument()
  })

  it('revine la română implicit, fără scurgeri de limbă între teste', async () => {
    await renderWithProviders(<Greeting />)

    expect(screen.getByText('Limbă')).toBeInTheDocument()
  })

  it('procesează interacțiuni prin user-event', async () => {
    const user = userEvent.setup()
    await renderWithProviders(<Counter />)

    await user.click(screen.getByRole('button', { name: 'Clicuri: 0' }))

    expect(
      screen.getByRole('button', { name: 'Clicuri: 1' }),
    ).toBeInTheDocument()
  })

  it('pune componentul pe ruta cerută din router', async () => {
    await renderWithProviders(<CurrentPath />, { route: '/admin/proprietati' })

    expect(screen.getByText('Ruta: /admin/proprietati')).toBeInTheDocument()
  })
})
