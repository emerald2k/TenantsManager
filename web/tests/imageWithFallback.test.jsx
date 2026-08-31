import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './renderWithProviders'
import { ImageWithFallback } from '@/components/shared/ImageWithFallback'

// Fast band — no Storage, no hook. This component only takes an already
// resolved `src`; the "still resolving" / "getDownloadURL rejected" states
// belong to each caller's `useAttachmentUrl` branch and are tested there
// (tenants.photoGallery / onboarding.photoCapture / tenants.contractUpload).
// jsdom never actually loads an <img>, so the load failure is simulated with
// `fireEvent.error` — the same event the browser fires on a corrupt or
// non-image body (2026-08-31 UI/UX audit, finding #2).

describe('ImageWithFallback', () => {
  it('renders the image while it loads fine', async () => {
    await renderWithProviders(
      <ImageWithFallback src="https://s/x.jpg" alt="carte identitate" />,
    )

    expect(screen.getByRole('img', { name: 'carte identitate' })).toBeVisible()
  })

  it('swaps the broken <img> for an explicit error state + retry when the load fails', async () => {
    await renderWithProviders(
      <ImageWithFallback src="https://s/x.jpg" alt="carte identitate" />,
    )

    fireEvent.error(screen.getByRole('img', { name: 'carte identitate' }))

    expect(screen.getByText('Imaginea nu a putut fi încărcată')).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
    expect(
      screen.getByRole('button', { name: /Încearcă din nou/ }),
    ).toBeVisible()
  })

  it('retry brings the image back for a fresh load attempt', async () => {
    const user = userEvent.setup()
    await renderWithProviders(
      <ImageWithFallback src="https://s/x.jpg" alt="carte identitate" />,
    )

    fireEvent.error(screen.getByRole('img', { name: 'carte identitate' }))
    await user.click(screen.getByRole('button', { name: /Încearcă din nou/ }))

    expect(screen.getByRole('img', { name: 'carte identitate' })).toBeVisible()
    expect(screen.queryByText('Imaginea nu a putut fi încărcată')).toBeNull()
  })

  it('renders the error text in English too', async () => {
    await renderWithProviders(
      <ImageWithFallback src="https://s/x.jpg" alt="id card" />,
      { language: 'en' },
    )

    fireEvent.error(screen.getByRole('img', { name: 'id card' }))

    expect(screen.getByText('The image could not be loaded')).toBeVisible()
  })
})
