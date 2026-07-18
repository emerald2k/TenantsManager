import { render, renderHook } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18n from '@/lib/i18n'

/**
 * The provider tree the application relies on, made available to the tests so
 * they do not repeat the scaffolding in every file: i18n + Router + TanStack Query.
 *
 * We use the real i18n instance (not a mock), so the tests verify the actual
 * translations from locales/ — NFR-LOC-01 requires all visible text to go through
 * i18n, and a mock would hide exactly the missing keys.
 */

/**
 * A NEW QueryClient on every call — never the one from `@/lib/queryClient`. The
 * application's client is a singleton with a cache: shared across tests, one
 * test's result would stay in the cache and decide the next one.
 *
 * `retry: false` everywhere: with the default retry, a test checking an error
 * would wait for the retries and time out instead of failing cleanly.
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

function buildWrapper({ queryClient, initialEntries }) {
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={initialEntries}>
            {children}
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>
    )
  }
}

// The i18n instance is a singleton shared across tests: we set the language
// explicitly on every render, so that a test changing the language does not
// influence the next one.
async function setupProviders({ language, queryClient, initialEntries }) {
  await i18n.changeLanguage(language)
  const client = queryClient ?? createTestQueryClient()
  return {
    client,
    wrapper: buildWrapper({ queryClient: client, initialEntries }),
  }
}

/**
 * Renders a component inside the full provider tree.
 *
 * @param ui                     the React element to render
 * @param options.language       the active language ('ro' by default — the app's default)
 * @param options.route          shorthand for a single history entry
 * @param options.initialEntries the router's initial history
 * @param options.queryClient    a client of your own (default: a new, isolated one)
 * The remaining options are forwarded to Testing Library's `render`.
 * @returns the result of `render`, plus `queryClient` (so the test can spy on it).
 */
export async function renderWithProviders(
  ui,
  {
    language = 'ro',
    route = '/',
    initialEntries = [route],
    queryClient,
    ...renderOptions
  } = {},
) {
  const { client, wrapper } = await setupProviders({
    language,
    queryClient,
    initialEntries,
  })

  return {
    ...render(ui, { wrapper, ...renderOptions }),
    queryClient: client,
  }
}

/**
 * The variant for hooks (`renderHook`), with exactly the same providers.
 * Needed for the hook tests: a data hook needs a QueryClientProvider, but not a
 * hand-written host component.
 *
 * @returns the result of `renderHook`, plus `queryClient`.
 */
export async function renderHookWithProviders(
  hook,
  {
    language = 'ro',
    route = '/',
    initialEntries = [route],
    queryClient,
    ...renderHookOptions
  } = {},
) {
  const { client, wrapper } = await setupProviders({
    language,
    queryClient,
    initialEntries,
  })

  return {
    ...renderHook(hook, { wrapper, ...renderHookOptions }),
    queryClient: client,
  }
}
