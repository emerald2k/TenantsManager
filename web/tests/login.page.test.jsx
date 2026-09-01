import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { useAuth } from '@/features/auth/useAuth'

// Fast band. `@/lib/firebase` has import-time side effects (initializeApp,
// connect*Emulator), so it is mocked. LoginPage only reads `usingEmulators`
// and `emulatorHost` from it — exposed here as GETTERS over a mutable state
// object so a test can vary them without reassigning a read-only import.
const fb = vi.hoisted(() => ({
  usingEmulators: true,
  emulatorHost: '127.0.0.1',
}))
vi.mock('@/lib/firebase', () => ({
  get usingEmulators() {
    return fb.usingEmulators
  },
  get emulatorHost() {
    return fb.emulatorHost
  },
}))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))

const login = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  fb.usingEmulators = true
  fb.emulatorHost = '127.0.0.1'
  useAuth.mockReturnValue({ login })
})

async function submit() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'admin@test.ro')
  await user.type(screen.getByLabelText('Parolă'), 'secret')
  await user.click(screen.getByRole('button', { name: 'Autentificare' }))
}

describe('LoginPage — error classification', () => {
  it('wrong credentials → the generic message, never revealing whether the email exists', async () => {
    login.mockRejectedValue({ code: 'auth/invalid-credential' })
    await renderWithProviders(<LoginPage />)

    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email sau parolă incorectă',
    )
  })

  it('disabled account → its own message', async () => {
    login.mockRejectedValue({ code: 'auth/user-disabled' })
    await renderWithProviders(<LoginPage />)

    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cont dezactivat',
    )
  })

  // audit #9 — against the emulators, auth/network-request-failed almost
  // always means VITE_EMULATOR_HOST does not resolve, NOT the user's
  // internet. The message must say so, and name the host it tried.
  it('emulator not responding (dev) → names the host + the variable, not "check your internet"', async () => {
    fb.emulatorHost = 'some-container-host'
    login.mockRejectedValue({ code: 'auth/network-request-failed' })
    await renderWithProviders(<LoginPage />)

    await submit()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('some-container-host')
    expect(alert).toHaveTextContent('VITE_EMULATOR_HOST')
    expect(alert).not.toHaveTextContent('internet')
  })

  it('same code in PRODUCTION (usingEmulators false) → the plain network message', async () => {
    fb.usingEmulators = false
    login.mockRejectedValue({ code: 'auth/network-request-failed' })
    await renderWithProviders(<LoginPage />)

    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Verificați internetul',
    )
  })
})
