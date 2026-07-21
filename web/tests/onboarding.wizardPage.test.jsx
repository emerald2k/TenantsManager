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
  useUserById,
} from '@/features/onboarding/hooks'
import { useProperties } from '@/features/properties/hooks'
import { httpsCallable } from 'firebase/functions'

// Fast band — the boundary (the hooks) is mocked, no emulator. The factory must list
// EVERY hook the wizard/StepPersonal/StepFinancial/PhotoCapture/StepContract call:
// `vi.mock` replaces the WHOLE module, and a hook left out comes back undefined
// and the page crashes.
vi.mock('@/features/onboarding/hooks', () => ({
  useDraft: vi.fn(),
  useUpdateDraft: vi.fn(),
  useCheckExistingEmail: vi.fn(),
  useCheckDuplicateCnp: vi.fn(),
  useUserById: vi.fn(),
}))

vi.mock('@/features/properties/hooks', () => ({ useProperties: vi.fn() }))

// PhotoCapture (Sub-stage D) touches Storage + compression directly, StepContract
// (Sub-stage E) calls the `finalizeKyc` callable. Neither the upload button nor
// Finalizează is clicked in these wiring-level tests — only rendering and the
// min-1/full-validation blocking are — so mocking the boundary (never invoked
// here) is enough to let the real components render.
vi.mock('@/lib/firebase', () => ({
  storage: { __fake: 'storage' },
  functions: { __fake: 'functions' },
}))
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
}))
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
vi.mock('browser-image-compression', () => ({ default: vi.fn() }))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const updateMutate = vi.fn()
const updateMutateAsync = vi.fn()
const checkEmailMutateAsync = vi.fn()
const checkCnpMutateAsync = vi.fn()
const finalizeKycMock = vi.fn()

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
  occupantCount: 2,
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
  employmentDuration: 3,
  monthlyIncome: { source: 'salary', amount: 5000 },
  guarantor: { name: 'Gigi', cnp: '1800101123456', phone: '0722222222' },
  previousReference: { name: 'Vlad', phone: '0733333333' },
}

beforeEach(() => {
  vi.clearAllMocks()
  updateMutateAsync.mockResolvedValue(undefined)
  useUpdateDraft.mockReturnValue({
    mutate: updateMutate,
    mutateAsync: updateMutateAsync,
    isPending: false,
    isError: false,
    error: null,
  })
  checkEmailMutateAsync.mockResolvedValue(null)
  checkCnpMutateAsync.mockResolvedValue(null)
  useCheckExistingEmail.mockReturnValue({ mutateAsync: checkEmailMutateAsync })
  useCheckDuplicateCnp.mockReturnValue({ mutateAsync: checkCnpMutateAsync })
  useUserById.mockReturnValue({ data: undefined, isPending: false })
  useProperties.mockReturnValue({ data: [], isPending: false })
  httpsCallable.mockReturnValue(finalizeKycMock)
  finalizeKycMock.mockResolvedValue({
    data: { tenancyId: 't1', accountCreated: false },
  })
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
  it('renders the step-2 photo capture without crashing', async () => {
    await renderWizard({ ...STEP3_DRAFT, currentStep: 2 })
    expect(
      screen.getByRole('button', { name: 'Fotografiază documentul' }),
    ).toBeInTheDocument()
  })

  it('renders the step-4 contract form (StepContract) without crashing', async () => {
    await renderWizard({ ...STEP3_DRAFT, currentStep: 4 })
    expect(
      screen.getByRole('button', { name: 'Finalizează' }),
    ).toBeInTheDocument()
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
    expect(
      screen.getByRole('button', { name: 'Finalizează' }),
    ).toBeInTheDocument()
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
    expect(
      screen.getByRole('button', { name: 'Fotografiază documentul' }),
    ).toBeInTheDocument()
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

describe('OnboardingWizardPage — autosave failure surfaced (Sub-stage E safety net)', () => {
  // Bug reproduction: `useUpdateDraft`'s mutation can fail for ANY reason (not
  // just the undefined-fields bug fixed alongside this) and, before this, the
  // wizard never read `isError`/`error` — the admin saw the wizard advance to
  // the next step as if nothing happened, with the draft silently unsaved.
  it('shows a visible alert when autosave fails, without blocking navigation', async () => {
    useUpdateDraft.mockReturnValue({
      mutate: updateMutate,
      isPending: false,
      isError: true,
      error: new Error('permission-denied'),
    })
    await renderWizard(STEP3_DRAFT)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Salvarea automată a eșuat — verifică conexiunea.',
    )
    // Not blocked: the admin can still act.
    expect(screen.getByRole('button', { name: 'Continuă' })).toBeEnabled()
  })

  it('shows nothing when autosave has not failed', async () => {
    await renderWizard(STEP3_DRAFT)
    expect(
      screen.queryByText('Salvarea automată a eșuat — verifică conexiunea.'),
    ).toBeNull()
  })
})

describe('OnboardingWizardPage — Step 4 wiring: Finalizează persists first (autosave gap fix)', () => {
  // Wiring-level companion to the StepContract unit tests: proves
  // `OnboardingWizardPage` actually PASSES a working `onBeforeFinalize` down —
  // not just that StepContract calls whatever it's given.
  it('autosaves the Step 4 values via mutateAsync BEFORE calling finalizeKyc', async () => {
    const user = userEvent.setup()
    useProperties.mockReturnValue({
      data: [{ id: 'prop-1', name: 'Apartament Centru', status: 'free' }],
      isPending: false,
    })
    await renderWizard({
      ...STEP3_DRAFT,
      currentStep: 4,
      idDocumentPhotos: [
        {
          url: 'https://storage.example/id.jpg',
          name: 'id.jpg',
          type: 'image',
        },
      ],
      propertyId: 'prop-1',
      startDate: '2026-08-01',
      endDate: '2027-08-01',
      monthlyRent: 2000,
      dueDay: 5,
      reportReminderDaysBefore: 3,
    })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => {
      expect(updateMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'draft-1',
          currentStep: 4,
          values: expect.objectContaining({
            propertyId: 'prop-1',
            monthlyRent: 2000,
          }),
        }),
      )
    })
    expect(finalizeKycMock).toHaveBeenCalledWith({ draftId: 'draft-1' })
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

  it('email match opens the existing-tenant dialog and, on confirm, jumps FOR REAL to Step 4 (Sub-stage E, FR-TEN-07)', async () => {
    // Sub-stage C only set existingUserId and stopped, showing a "coming in E"
    // message. Sub-stage E replaces that with a real jump: autosave(currentStep:4)
    // + the step indicator/content actually move to Step 4 — Steps 1-3 never get
    // validated or revisited on this path.
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
      expect(updateMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'draft-1', currentStep: 4 }),
      )
    })
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent(
      '4. Contract',
    )
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

  it('uses native inputs for dateOfBirth (date) and occupantCount (number, min 1), with CNP/phone placeholders (Sub-stage E)', async () => {
    await renderWizard(EMPTY_DRAFT)

    expect(screen.getByLabelText('Data nașterii')).toHaveAttribute(
      'type',
      'date',
    )
    const occupantCount = screen.getByLabelText('Număr de locatari')
    expect(occupantCount).toHaveAttribute('type', 'number')
    expect(occupantCount).toHaveAttribute('min', '1')
    expect(screen.getByLabelText('CNP')).toHaveAttribute(
      'placeholder',
      'ex: 1234567890123',
    )
    expect(screen.getByLabelText('Telefon')).toHaveAttribute(
      'placeholder',
      'ex: 0712345678',
    )
    expect(screen.getByLabelText('Telefon contact de urgență')).toHaveAttribute(
      'placeholder',
      'ex: 0712345678',
    )
  })
})

describe('OnboardingWizardPage — Step 2 ID document photos (FR-TEN-03)', () => {
  it('blocks Continue with an inline error when no photo was captured', async () => {
    const user = userEvent.setup()
    await renderWizard({ ...STEP3_DRAFT, currentStep: 2, idDocumentPhotos: [] })

    await user.click(screen.getByRole('button', { name: 'Continuă' }))

    await waitFor(() => {
      expect(screen.getAllByText('Câmp obligatoriu').length).toBeGreaterThan(0)
    })
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('allows Continue once at least one photo is present', async () => {
    const user = userEvent.setup()
    await renderWizard({
      ...STEP3_DRAFT,
      currentStep: 2,
      idDocumentPhotos: [
        {
          url: 'https://storage.example/id.jpg',
          name: 'id.jpg',
          type: 'image',
        },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Continuă' }))

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'draft-1', currentStep: 3 }),
      )
    })
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

  it('captures monthlyIncome.amount as a NUMBER, not a string (Sub-stage E follow-up — valueAsNumber)', async () => {
    const user = userEvent.setup()
    await renderWizard(STEP3_DRAFT)

    const amountInput = screen.getByLabelText('Venit lunar')
    await user.clear(amountInput)
    await user.type(amountInput, '4500')
    await user.click(screen.getByRole('button', { name: 'Continuă' }))

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'draft-1',
          currentStep: 4,
          values: expect.objectContaining({
            monthlyIncome: expect.objectContaining({ amount: 4500 }),
          }),
        }),
      )
    })
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

  it('renders the guarantor photo capture without crashing, guarantor.idDocumentPhotos absent', async () => {
    // STEP3_DRAFT's guarantor has no idDocumentPhotos — exactly what `reset` produces
    // after a shallow merge with draftFormDefaults replaces the whole `guarantor`
    // object. PhotoCapture must default the watched array instead of crashing.
    await renderWizard(STEP3_DRAFT)
    expect(
      screen.getByRole('button', { name: 'Fotografiază documentul' }),
    ).toBeInTheDocument()
  })

  it('uses a native number input for employmentDuration ("Vechime (ani)"), placeholders for monthlyIncome.amount/guarantor/previousReference/employer/occupation (Sub-stage E)', async () => {
    await renderWizard(STEP3_DRAFT)

    const employmentDuration = screen.getByLabelText('Vechime (ani)')
    expect(employmentDuration).toHaveAttribute('type', 'number')
    expect(employmentDuration).toHaveAttribute('min', '0')
    expect(screen.getByLabelText('Venit lunar')).toHaveAttribute(
      'type',
      'number',
    )
    expect(screen.getByLabelText('Venit lunar')).toHaveAttribute(
      'placeholder',
      'ex: 3000',
    )
    expect(screen.getByLabelText('CNP garant')).toHaveAttribute(
      'placeholder',
      'ex: 1234567890123',
    )
    expect(screen.getByLabelText('Telefon garant')).toHaveAttribute(
      'placeholder',
      'ex: 0712345678',
    )
    expect(
      screen.getByLabelText('Telefon referință anterioară'),
    ).toHaveAttribute('placeholder', 'ex: 0712345678')
    expect(screen.getByLabelText('Angajator')).toHaveAttribute(
      'placeholder',
      'ex: SC Exemplu SRL',
    )
    expect(screen.getByLabelText('Ocupație')).toHaveAttribute(
      'placeholder',
      'ex: Contabil',
    )
  })
})
