import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { Routes, Route } from 'react-router-dom'
import { renderWithProviders } from './renderWithProviders'
import { StepContract } from '@/features/onboarding/components/StepContract'
import { draftFormDefaults } from '@/features/onboarding/schema'
import { useUserById } from '@/features/onboarding/hooks'
import { useProperties } from '@/features/properties/hooks'
import { httpsCallable } from 'firebase/functions'

// Fast band — the boundary (the hooks + httpsCallable) is mocked, no emulator.

vi.mock('@/lib/firebase', () => ({ functions: { __fake: 'functions' } }))
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))
vi.mock('@/features/onboarding/hooks', () => ({ useUserById: vi.fn() }))
vi.mock('@/features/properties/hooks', () => ({ useProperties: vi.fn() }))

const finalizeKycMock = vi.fn()

const FREE_PROPERTY = {
  id: 'prop-1',
  name: 'Apartament Centru',
  status: 'free',
}
const OCCUPIED_PROPERTY = {
  id: 'prop-2',
  name: 'Garsonieră Mărăști',
  status: 'occupied',
}

function Host({ defaultValues, onBeforeFinalize }) {
  const methods = useForm({ defaultValues })
  return (
    <FormProvider {...methods}>
      <StepContract draftId="draft-1" onBeforeFinalize={onBeforeFinalize} />
    </FormProvider>
  )
}

function renderStepContract({ defaultValues, onBeforeFinalize } = {}) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/"
        element={
          <Host
            defaultValues={{ ...draftFormDefaults, ...defaultValues }}
            onBeforeFinalize={onBeforeFinalize}
          />
        }
      />
    </Routes>,
  )
}

// Only Step 4 — enough for the existingUserId branch (Steps 1-3 irrelevant there).
const CONTRACT_FILLED = {
  propertyId: 'prop-1',
  startDate: '2026-08-01',
  endDate: '2027-08-01',
  monthlyRent: 2000,
  dueDay: 5,
  reportReminderDaysBefore: 3,
}

// A COMPLETE draft (Steps 1-4) — required for the new-tenant branch, where full
// validation still demands every step (fullDraftSchema, Sub-stage E).
const FULL_NEW_TENANT_DRAFT = {
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
  idDocumentPhotos: [
    { url: 'gs://bucket/1.jpg', name: 'front.jpg', type: 'image' },
  ],
  employer: 'ACME SRL',
  occupation: 'Engineer',
  employmentDuration: 3,
  monthlyIncome: { source: 'salary', amount: 5000 },
  guarantor: { name: 'Gigi', cnp: '1800101123456', phone: '0722222222' },
  previousReference: { name: 'Vlad', phone: '0733333333' },
  ...CONTRACT_FILLED,
}

beforeEach(() => {
  vi.clearAllMocks()
  useProperties.mockReturnValue({
    data: [FREE_PROPERTY, OCCUPIED_PROPERTY],
    isPending: false,
  })
  useUserById.mockReturnValue({ data: undefined, isPending: false })
  httpsCallable.mockReturnValue(finalizeKycMock)
})

describe('StepContract — rendering (FR-CON-01, FR-TEN-14)', () => {
  it('renders the property dropdown, contract fields, and the Finalizează button', async () => {
    await renderStepContract()

    expect(screen.getByLabelText('Proprietate')).toBeInTheDocument()
    expect(screen.getByLabelText('Dată început')).toBeInTheDocument()
    expect(screen.getByLabelText('Dată sfârșit')).toBeInTheDocument()
    expect(screen.getByLabelText('Chirie lunară')).toBeInTheDocument()
    expect(screen.getByLabelText('Zi scadentă')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Finalizează' }),
    ).toBeInTheDocument()
  })

  it('disables the occupied property in the dropdown (FR-TEN-14)', async () => {
    await renderStepContract()

    const select = screen.getByLabelText('Proprietate')
    const occupiedOption = Array.from(select.options).find(
      (o) => o.value === 'prop-2',
    )
    expect(occupiedOption.disabled).toBe(true)
    const freeOption = Array.from(select.options).find(
      (o) => o.value === 'prop-1',
    )
    expect(freeOption.disabled).toBe(false)
  })

  it('shows the "assigning to" banner when existingUserId is set (FR-TEN-07)', async () => {
    useUserById.mockReturnValue({
      data: { id: 'user-1', name: 'Maria Ionescu', email: 'maria@example.com' },
      isPending: false,
    })

    await renderStepContract({
      defaultValues: { existingUserId: 'user-1' },
    })

    expect(
      screen.getByText('Asignare pentru: Maria Ionescu (maria@example.com)'),
    ).toBeInTheDocument()
  })

  it('shows no banner for a brand-new tenant (existingUserId absent)', async () => {
    await renderStepContract()
    expect(screen.queryByText(/Asignare pentru/)).toBeNull()
  })

  it('uses native date inputs for startDate/endDate, number inputs (with min/max) for dueDay/monthlyRent/securityDeposit/reportReminderDaysBefore, and rent placeholders (Sub-stage E)', async () => {
    await renderStepContract()

    expect(screen.getByLabelText('Dată început')).toHaveAttribute(
      'type',
      'date',
    )
    expect(screen.getByLabelText('Dată sfârșit')).toHaveAttribute(
      'type',
      'date',
    )
    const dueDay = screen.getByLabelText('Zi scadentă')
    expect(dueDay).toHaveAttribute('type', 'number')
    expect(dueDay).toHaveAttribute('min', '1')
    expect(dueDay).toHaveAttribute('max', '31')
    const monthlyRent = screen.getByLabelText('Chirie lunară')
    expect(monthlyRent).toHaveAttribute('type', 'number')
    expect(monthlyRent).toHaveAttribute('min', '0')
    expect(monthlyRent).toHaveAttribute('placeholder', 'ex: 1500')
    const securityDeposit = screen.getByLabelText(/Garanție/)
    expect(securityDeposit).toHaveAttribute('type', 'number')
    expect(securityDeposit).toHaveAttribute('min', '0')
    expect(securityDeposit).toHaveAttribute('placeholder', 'ex: 1500')
    const reminder = screen.getByLabelText(
      'Reminder raport (zile înainte de scadență)',
    )
    expect(reminder).toHaveAttribute('type', 'number')
    expect(reminder).toHaveAttribute('min', '1')
  })
})

describe('StepContract — full validation on Finalizează (SRS §5.3)', () => {
  it('blocks with inline errors when Step 4 fields are missing, without calling finalizeKyc', async () => {
    const user = userEvent.setup()
    await renderStepContract()

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => {
      expect(screen.getAllByText('Câmp obligatoriu').length).toBeGreaterThan(0)
    })
    expect(finalizeKycMock).not.toHaveBeenCalled()
  })
})

describe('StepContract — finalize success (new tenant, accountCreated:true)', () => {
  it('calls finalizeKyc with the draftId and shows credentials on success', async () => {
    const user = userEvent.setup()
    finalizeKycMock.mockResolvedValue({
      data: {
        uid: 'new-uid',
        tenancyId: 't1',
        email: 'ion@example.com',
        password: 'Ab3dEfGhJkLm',
        accountCreated: true,
      },
    })
    await renderStepContract({ defaultValues: FULL_NEW_TENANT_DRAFT })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => {
      expect(finalizeKycMock).toHaveBeenCalledWith({ draftId: 'draft-1' })
    })
    expect(screen.getByText('Cont creat')).toBeInTheDocument()
    expect(screen.getByText('ion@example.com')).toBeInTheDocument()
    expect(screen.getByText('Ab3dEfGhJkLm')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Către lista de chiriași' }),
    ).toHaveAttribute('href', '/admin/tenants')
  })

  it('copies the password to the clipboard', async () => {
    // `userEvent.setup()` installs ITS OWN `navigator.clipboard` mock (needed for
    // user.copy()/paste()) — it must run BEFORE we can spy on the real, final
    // `writeText`; spying earlier (e.g. in `beforeEach`) would spy on a clipboard
    // object userEvent immediately replaces.
    const user = userEvent.setup()
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText')
    finalizeKycMock.mockResolvedValue({
      data: {
        uid: 'new-uid',
        tenancyId: 't1',
        email: 'ion@example.com',
        password: 'Ab3dEfGhJkLm',
        accountCreated: true,
      },
    })
    await renderStepContract({ defaultValues: FULL_NEW_TENANT_DRAFT })
    await user.click(screen.getByRole('button', { name: 'Finalizează' }))
    await waitFor(() => screen.getByText('Cont creat'))

    await user.click(screen.getByRole('button', { name: 'Copiază' }))

    expect(writeTextSpy).toHaveBeenCalledWith('Ab3dEfGhJkLm')
  })
})

describe('StepContract — finalize success (existing tenant, accountCreated:false)', () => {
  it('shows a tenancy-created message with NO password, using the existing user name', async () => {
    const user = userEvent.setup()
    useUserById.mockReturnValue({
      data: { id: 'user-1', name: 'Maria Ionescu', email: 'maria@example.com' },
      isPending: false,
    })
    finalizeKycMock.mockResolvedValue({
      data: { tenancyId: 't1', userId: 'user-1', accountCreated: false },
    })
    await renderStepContract({
      defaultValues: { ...CONTRACT_FILLED, existingUserId: 'user-1' },
    })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => {
      expect(
        screen.getByText('Tenanță creată pentru Maria Ionescu'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Ab3dEfGhJkLm')).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Către lista de chiriași' }),
    ).toHaveAttribute('href', '/admin/tenants')
  })
})

describe('StepContract — persists Step 4 fields before finalizing (autosave gap)', () => {
  // Bug: `handleFinalize` validated locally then called `finalizeKyc({ draftId })`
  // directly — the wizard's Step 4 fields (propertyId, dates, rent, dueDay...)
  // were NEVER autosaved anywhere before that. `finalizeKyc` reads the draft as
  // PERSISTED in Firestore, so it always saw them missing — reproduced live: the
  // undefined-autosave fix alone was not enough, Finalizează still failed with
  // `{"issues":["propertyId","startDate","endDate","monthlyRent","dueDay"]}` on a
  // freshly created draft. `onBeforeFinalize` is the wizard's own autosave,
  // awaited here so the write completes before the server ever reads the draft.
  it('awaits onBeforeFinalize BEFORE calling finalizeKyc', async () => {
    const user = userEvent.setup()
    const callOrder = []
    const onBeforeFinalize = vi.fn(async () => {
      callOrder.push('autosave')
    })
    finalizeKycMock.mockImplementation(async () => {
      callOrder.push('finalizeKyc')
      return {
        data: { tenancyId: 't1', userId: 'user-1', accountCreated: false },
      }
    })
    useUserById.mockReturnValue({
      data: { id: 'user-1', name: 'Maria Ionescu', email: 'maria@example.com' },
      isPending: false,
    })
    await renderStepContract({
      defaultValues: { ...CONTRACT_FILLED, existingUserId: 'user-1' },
      onBeforeFinalize,
    })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => expect(finalizeKycMock).toHaveBeenCalled())
    expect(callOrder).toEqual(['autosave', 'finalizeKyc'])
  })

  it('does not call finalizeKyc when the pre-finalize autosave fails, and surfaces the error', async () => {
    const user = userEvent.setup()
    const onBeforeFinalize = vi
      .fn()
      .mockRejectedValue(new Error('write failed'))
    await renderStepContract({
      defaultValues: FULL_NEW_TENANT_DRAFT,
      onBeforeFinalize,
    })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('write failed')
    })
    expect(finalizeKycMock).not.toHaveBeenCalled()
  })

  it('does not autosave when local validation fails — nothing valid to persist', async () => {
    const user = userEvent.setup()
    const onBeforeFinalize = vi.fn()
    await renderStepContract({ onBeforeFinalize })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => {
      expect(screen.getAllByText('Câmp obligatoriu').length).toBeGreaterThan(0)
    })
    expect(onBeforeFinalize).not.toHaveBeenCalled()
  })
})

describe('StepContract — finalize errors', () => {
  it('duplicate CNP shows a blocking dialog with the conflicting name + a link to their profile', async () => {
    const user = userEvent.setup()
    const err = Object.assign(
      new Error('A tenant with this CNP already exists.'),
      {
        code: 'functions/already-exists',
        details: { conflictUserId: 'user-9', conflictName: 'Vasile Pop' },
      },
    )
    finalizeKycMock.mockRejectedValue(err)
    await renderStepContract({ defaultValues: FULL_NEW_TENANT_DRAFT })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => {
      expect(
        screen.getByText('Există deja un chiriaș cu acest CNP: "Vasile Pop".'),
      ).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'Vezi profilul' })).toHaveAttribute(
      'href',
      '/admin/tenants/user-9',
    )
  })

  it('occupied property shows a clear inline message (not a dialog)', async () => {
    const user = userEvent.setup()
    const err = Object.assign(new Error('occupied'), {
      code: 'functions/failed-precondition',
      details: { reason: 'property-occupied' },
    })
    finalizeKycMock.mockRejectedValue(err)
    await renderStepContract({ defaultValues: FULL_NEW_TENANT_DRAFT })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Proprietatea selectată este deja ocupată',
      )
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('an UNEXPECTED error shows the raw error.message alongside the generic text (debugging visibility)', async () => {
    const user = userEvent.setup()
    const err = Object.assign(
      new Error('Something truly unexpected exploded in the transaction.'),
      { code: 'functions/internal' },
    )
    finalizeKycMock.mockRejectedValue(err)
    await renderStepContract({ defaultValues: FULL_NEW_TENANT_DRAFT })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Something truly unexpected exploded in the transaction.',
      )
    })
    // The static generic text is STILL there too — this is additive, not a
    // replacement.
    expect(screen.getByRole('alert')).toHaveTextContent('Finalizarea a eșuat')
  })

  it('FR-CON-02 (existing account already has an active tenancy) shows a clear inline message', async () => {
    const user = userEvent.setup()
    const err = Object.assign(new Error('active tenancy'), {
      code: 'functions/failed-precondition',
      details: { reason: 'active-tenancy' },
    })
    finalizeKycMock.mockRejectedValue(err)
    await renderStepContract({
      defaultValues: { ...CONTRACT_FILLED, existingUserId: 'user-1' },
    })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Acest cont are deja o tenanță activă',
      )
    })
  })
})
