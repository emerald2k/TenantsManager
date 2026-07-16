import { render } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

/**
 * Randează un component în arborele de provideri pe care se bazează aplicația,
 * ca testele să nu repete schela la fiecare fișier.
 *
 * Acum: i18n + Router. QueryClientProvider se adaugă aici la sub-etapa B, când
 * intră TanStack Query — până atunci nu există cod care să-l ceară.
 *
 * Folosim instanța reală de i18n (nu una mock), ca testele să verifice
 * traducerile adevărate din locales/ — NFR-LOC-01 cere ca tot textul vizibil să
 * treacă prin i18n, iar un mock ar ascunde exact cheile lipsă.
 *
 * @param ui                    elementul React de randat
 * @param options.language      limba activă ('ro' implicit — limba default a aplicației)
 * @param options.initialEntries istoricul inițial al router-ului (ex. ['/admin/proprietati'])
 * @param options.route         scurtătură pentru o singură intrare de istoric
 * Restul opțiunilor merg mai departe la `render` din Testing Library.
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
  // Instanța de i18n e un singleton partajat între teste: fixăm explicit limba
  // la fiecare randare, ca un test care schimbă limba să nu-l influențeze pe următorul.
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
