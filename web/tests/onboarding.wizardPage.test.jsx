import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from './renderWithProviders'
import { OnboardingWizardPage } from '@/features/onboarding/pages/OnboardingWizardPage'
import {
  useCheckDuplicateCnp,
  useCheckExistingEmail,
  useDraft,
  useUpdateDraft,
} from '@/features/onboarding/hooks'

// Fast band — the boundary (the hooks) is mocked, no emulator. The factory must list
// EVERY hook the wizard/StepPersonal/StepFinancial call: `vi.mock` replaces the
// WHOLE module, and a hook left out comes back undefined and the page crashes.
vi.mock('@/features/onboarding/hooks', () => ({
  useDraft: vi.fn(),
  useUpdateDraft: vi.fn(),
  useCheckExistingEmail: vi.fn(),
  useCheckDuplicateCnp: vi.fn(),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const updateMutate = vi.fn()
const checkEmailMutateAsync = vi.fn()
const checkCnpMutateAsync = vi.fn()

const EMPTY_DRAFT = { id: 'draft-1', status: 'in_progress', currentStep: 1 }

const STEP1_FILLED = {
  name: 'Ion Popescu',
  dateOfBirth: '1990-01-01',
  cnp: '1900101123456',
  phone: '0712345678',
  email: 'ion@example.com',
  preferredLanguage: 'ro',
  previousAddress: 'Str. Veche 1',
  emergencyContact: { name: 'Maria', phone: '0700000000' },
  occupantCount: '2',
  smoker: false,
  pets: { has: false },
  vehicle: { has: false },
}

const STEP3_DRAFT = {
  id: 'draft-1',
  status: 'in_progress',
  currentStep: 3,
  ...STEP1_FILLED,
  employer: 'ACME SRL',
  occupation: 'Engineer',
  employmentDuration: '3 years',
  monthlyIncome: { source: 'salary', amount: '5000' },
  guarantor: { name: 'Gigi', cnp: '1800101123456', phone: '0722222222' },
  previousReference: { name: 'Vlad', phone: '0733333333' },
}

beforeEach(() => {
  vi.clearAllMocks()
  useUpdateDraft.mockReturnValue({ mutate: updateMutate, isPending: false })
  checkEmailMutateAsync.mockResolvedValue(null)
  checkCnpMutateAsync.mockResolvedValue(null)
  useCheckExistingEmail.mockReturnValue({ mutateAsync: checkEmailMutateAsync })
  useCheckDuplicateCnp.mockReturnValue({ mutateAsync: checkCnpMutateAsync })
})

function renderWizard(draft) {
  useDraft.mockReturnValue({ data: draft, isPending: false })
  return renderWithProviders(
    <Routes>
      <Route
        path="/admin/onboarding/:draftId"
        element={<OnboardingWizardPage />}
      />
    </Routes>,
    { route: `/admin/onboarding/${draft.id}` },
  )
}

describe('OnboardingWizardPage — shell', () => {
  it('renders the step-2 placeholder without crashing', async () => {
    await renderWizard({ ...STEP3_DRAFT, currentStep: 2 })
    expect(screen.getByText('Disponibil în Sub-etapa D')).toBeInTheDocument()
  })

  it('renders the step-4 placeholder without crashing', async () => {
    await renderWizard({ ...STEP3_DRAFT, currentStep: 4 })
    expect(screen.getByText('Disponibil în Sub-etapa E')).toBeInTheDocument()
  })

  it('Continue autosaves (useUpdateDraft) and advances to the next step', async () => {
    const user = userEvent.setup()
    await renderWizard(STEP3_DRAFT)

    await user.click(screen.getByRole('button', { name: 'Continuă' }))

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'draft-1', currentStep: 4 }),
      )
    })
    expect(screen.getByText('Disponibil în Sub-etapa E')).toBeInTheDocument()
  })

  it('Back autosaves (useUpdateDraft) and returns to the previous step', async () => {
    const user = userEvent.setup()
    await renderWizard(STEP3_DRAFT)

    await user.click(screen.getByRole('button', { name: 'Înapoi' }))

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'draft-1', currentStep: 2 }),
      )
    })
    expect(screen.getByText('Disponibil în Sub-etapa D')).toBeInTheDocument()
  })

  it('Save and close saves and navigates back to the tenant list', async () => {
    const user = userEvent.setup()
    await renderWizard(STEP3_DRAFT)

    await user.click(
      screen.getByRole('button', { name: 'Salvează și închide' }),
    )

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'draft-1', currentStep: 3 }),
      )
    })
    expect(navigate).toHaveBeenCalledWith('/admin/tenants')
  })

  it('disables Back on step 1', async () => {
    await renderWizard(EMPTY_DRAFT)
    expect(screen.getByRole('button', { name: 'Înapoi' })).toBeDisabled()
  })

  it('hides Continue on step 4 (last step)', async () => {
    await renderWizard({ ...STEP3_DRAFT, currentStep: 4 })
    expect(screen.queryByRole('button', { name: 'Continuă' })).toBeNull()
  })
})

describe('OnboardingWizardPage — Step 1 personal data (FR-TEN-02)', () => {
  it('shows an inline error per missing mandatory field on Continue', async () => {
    const user = userEvent.setup()
    await renderWizard(EMPTY_DRAFT)

    await user.click(screen.getByRole('button', { name: 'Continuă' }))

    await waitFor(() => {
      expect(screen.getAllByText('Câmp obligatoriu').length).toBeGreaterThan(0)
    })
    expect(updateMutate).not.toHaveBeenCalled()
  })

  // Anti-vacuity: this must FAIL if smoker/pets.has/vehicle.has ever get a
  // `.default(false)` — an untouched field would then read as a chosen "no".
  it('does not pre-select smoker/pets/vehicle — nothing chosen until the admin picks', async () => {
    await renderWizard(EMPTY_DRAFT)
    expect(screen.getByLabelText('Fumător')).toHaveValue('')
    expect(screen.getByLabelText('Animale de companie')).toHaveValue('')
    expect(screen.getByLabelText('Vehicul')).toHaveValue('')
  })

  it('choosing "yes" for pets reveals the type field (conditional)', async () => {
    const user = userEvent.setup()
    await renderWizard(EMPTY_DRAFT)

    expect(screen.queryByLabelText('Tip animal')).toBeNull()
    await user.selectOptions(
      screen.getByLabelText('Animale de companie'),
      'true',
    )
    expect(screen.getByLabelText('Tip animal')).toBeInTheDocument()
  })

  it('email match opens the existing-tenant dialog and sets existingUserId on confirm', async () => {
    const user = userEvent.setup()
    checkEmailMutateAsync.mockResolvedValue({
      id: 'user-1',
      name: 'Maria Ionescu',
    })
    await renderWizard(EMPTY_DRAFT)

    await user.type(screen.getByLabelText('Email'), 'maria@example.com')
    await user.tab()

    await waitFor(() => {
      expect(
        screen.getByText('Chiriaș existent — chirie nouă'),
      ).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Confirmă' }))

    await waitFor(() => {
      expect(
        screen.getByText(/Acest draft este legat de chiriașul existent/),
      ).toBeInTheDocument()
    })
  })

  it('cnp match shows a blocking warning and disables Continue', async () => {
    const user = userEvent.setup()
    checkCnpMutateAsync.mockResolvedValue({ id: 'user-2', name: 'Vasile Pop' })
    await renderWizard(EMPTY_DRAFT)

    await user.type(screen.getByLabelText('CNP'), '1900101123456')
    await user.tab()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Există deja un chiriaș cu acest CNP: "Vasile Pop"',
      )
    })
    expect(screen.getByRole('button', { name: 'Continuă' })).toBeDisabled()
  })
})

describe('OnboardingWizardPage — Step 3 financial data + guarantor (FR-TEN-04)', () => {
  it('shows an inline error per missing mandatory field on Continue', async () => {
    const user = userEvent.setup()
    await renderWizard({ id: 'draft-1', status: 'in_progress', currentStep: 3 })

    await user.click(screen.getByRole('button', { name: 'Continuă' }))

    await waitFor(() => {
      expect(screen.getAllByText('Câmp obligatoriu').length).toBeGreaterThan(0)
    })
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('allows Continue with guarantor photos absent — optional, non-blocking', async () => {
    const user = userEvent.setup()
    await renderWizard(STEP3_DRAFT)

    await user.click(screen.getByRole('button', { name: 'Continuă' }))

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'draft-1', currentStep: 4 }),
      )
    })
  })

  it('renders the guarantor photo-upload placeholder without crashing', async () => {
    await renderWizard(STEP3_DRAFT)
    expect(screen.getByText('Încărcare poze — Sub-etapa D')).toBeInTheDocument()
  })
})
