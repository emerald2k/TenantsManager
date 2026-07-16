import { render } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

/**
 * Renders a component inside the provider tree the application relies on, so the
 * tests do not repeat the scaffolding in every file.
 *
 * For now: i18n + Router. QueryClientProvider is added here at sub-stage B, when
 * TanStack Query arrives — until then no code asks for it.
 *
 * We use the real i18n instance (not a mock), so the tests verify the actual
 * translations from locales/ — NFR-LOC-01 requires all visible text to go through
 * i18n, and a mock would hide exactly the missing keys.
 *
 * @param ui                     the React element to render
 * @param options.language       the active language ('ro' by default — the app's default)
 * @param options.initialEntries the router's initial history (e.g. ['/admin/properties'])
 * @param options.route          shorthand for a single history entry
 * The remaining options are forwarded to Testing Library's `render`.
 */
export async function renderWithProviders(
  ui,
  {
    language = 'ro',
    route = '/',
    initialEntries = [route],
    ...renderOptions
  } = {},
) {
  // The i18n instance is a singleton shared across tests: we set the language
  // explicitly on every render, so that a test changing the language does not
  // influence the next one.
  await i18n.changeLanguage(language)

  function Wrapper({ children }) {
    return (
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </I18nextProvider>
    )
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}
