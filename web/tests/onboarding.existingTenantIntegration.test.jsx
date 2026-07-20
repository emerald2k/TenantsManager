import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithProviders } from './renderWithProviders'
import { OnboardingWizardPage } from '@/features/onboarding/pages/OnboardingWizardPage'
import {
  useCheckDuplicateCnp,
  useCheckExistingEmail,
} from '@/features/onboarding/hooks'
import { useProperties } from '@/features/properties/hooks'
import { httpsCallable } from 'firebase/functions'
import { getDoc } from 'firebase/firestore'

// Reproduction of Bogdan's exact sequence: does `existingUserId` survive the
// REAL autosave → invalidateQueries → refetch → reset() cycle?
//
// Deliberately does NOT mock useDraft/useUpdateDraft/useUserById — those run
// FOR REAL (real useQuery/useMutation from @/features/onboarding/hooks), against
// a stateful in-memory Firestore double below. Only the SDK boundary
// (firebase/firestore) is mocked, plus the two live-check hooks
// (useCheckExistingEmail/useCheckDuplicateCnp) and whatever Steps 2/3's child
// components need to import cleanly (they're never RENDERED on this path — the
// existing-user branch jumps straight from Step 1 to Step 4 — but
// OnboardingWizardPage imports them unconditionally at module load).

vi.mock('@/features/onboarding/hooks', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useCheckExistingEmail: vi.fn(),
    useCheckDuplicateCnp: vi.fn(),
  }
})

vi.mock('@/features/properties/hooks', () => ({ useProperties: vi.fn() }))

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  storage: { __fake: 'storage' },
  functions: { __fake: 'functions' },
}))

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
}))
vi.mock('browser-image-compression', () => ({ default: vi.fn() }))
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

// ── Stateful in-memory Firestore double, one Map per collection — a real
// simulation of persistence, not an empty jest.fn(). ──
const stores = { onboardingDrafts: new Map(), users: new Map() }

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_db, collectionName, id) => ({
    __collection: collectionName,
    __id: id,
  })),
  getDoc: vi.fn(async (ref) => {
    const data = stores[ref.__collection]?.get(ref.__id)
    return {
      exists: () => data !== undefined,
      id: ref.__id,
      data: () => data,
    }
  }),
  getDocs: vi.fn(async () => ({ docs: [], empty: true })),
  addDoc: vi.fn(),
  updateDoc: vi.fn(async (ref, patch) => {
    const store = stores[ref.__collection]
    const current = store.get(ref.__id) ?? {}
    store.set(ref.__id, { ...current, ...patch })
  }),
  deleteDoc: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  limit: vi.fn((n) => ({ __limit: n })),
  query: vi.fn((collectionRef, ...constraints) => ({
    __collection: collectionRef,
    constraints,
  })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const checkEmailMutateAsync = vi.fn()
const checkCnpMutateAsync = vi.fn()
const finalizeKycMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  stores.onboardingDrafts.clear()
  stores.users.clear()
  stores.onboardingDrafts.set('draft-1', {
    status: 'in_progress',
    currentStep: 1,
  })

  checkEmailMutateAsync.mockResolvedValue(null)
  checkCnpMutateAsync.mockResolvedValue(null)
  useCheckExistingEmail.mockReturnValue({ mutateAsync: checkEmailMutateAsync })
  useCheckDuplicateCnp.mockReturnValue({ mutateAsync: checkCnpMutateAsync })
  useProperties.mockReturnValue({
    data: [{ id: 'prop-1', name: 'Apartament Test', status: 'free' }],
    isPending: false,
  })
  httpsCallable.mockReturnValue(finalizeKycMock)
  finalizeKycMock.mockResolvedValue({
    data: { tenancyId: 't1', userId: 'existing-user-1', accountCreated: false },
  })
})

function renderWizard() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/admin/onboarding/:draftId"
        element={<OnboardingWizardPage />}
      />
    </Routes>,
    { route: '/admin/onboarding/draft-1' },
  )
}

describe('Onboarding — existingUserId across the REAL autosave/refetch/reset cycle (bug reproduction)', () => {
  it('Step 1 confirm → autosave writes existingUserId → refetch/reset settles → Step 4 Finalizează still takes the existingUserId branch', async () => {
    const user = userEvent.setup()
    checkEmailMutateAsync.mockResolvedValue({
      id: 'existing-user-1',
      name: 'Maria Ionescu',
    })

    await renderWizard()

    // The initial useDraft() read is genuinely async (a real getDoc call
    // against the in-memory double) — wait for it to resolve past the
    // "Se încarcă..." loading state before interacting.
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeInTheDocument()
    })

    // 1-2. Step 1: email blur triggers the match, confirm the dialog.
    await user.type(screen.getByLabelText('Email'), 'maria@example.com')
    await user.tab()
    await waitFor(() => {
      expect(
        screen.getByText('Chiriaș existent — chirie nouă'),
      ).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Confirmă' }))

    // The write: confirmExistingTenant's setValue + handleExistingTenantConfirmed's
    // autosave(4) → REAL updateDoc against the in-memory store.
    await waitFor(() => {
      expect(stores.onboardingDrafts.get('draft-1').existingUserId).toBe(
        'existing-user-1',
      )
    })

    // 3. The refetch: useUpdateDraft's onSuccess invalidates the detail query,
    // which triggers a SECOND real getDoc('draft-1') — proof the
    // invalidate→refetch→reset() cycle has actually run (not just the write).
    await waitFor(() => {
      const draftReads = getDoc.mock.calls.filter(
        ([ref]) =>
          ref.__collection === 'onboardingDrafts' && ref.__id === 'draft-1',
      )
      expect(draftReads.length).toBeGreaterThanOrEqual(2)
    })

    // 4. Step 4 rendered (currentStep synced from the refetched draft).
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Finalizează' }),
      ).toBeInTheDocument()
    })

    // Fill ONLY Step 4 — Steps 1-3 were never touched beyond the email.
    await user.selectOptions(screen.getByLabelText('Proprietate'), 'prop-1')
    fireEvent.change(screen.getByLabelText('Dată început'), {
      target: { value: '2026-08-01' },
    })
    fireEvent.change(screen.getByLabelText('Dată sfârșit'), {
      target: { value: '2027-08-01' },
    })
    fireEvent.change(screen.getByLabelText('Chirie lunară'), {
      target: { value: '2000' },
    })
    fireEvent.change(screen.getByLabelText('Zi scadentă'), {
      target: { value: '5' },
    })

    await user.click(screen.getByRole('button', { name: 'Finalizează' }))

    // 5. THE ASSERTION: if existingUserId survived the cycle, fullDraftSchema
    // takes the Step-4-only branch and finalizeKyc gets called. If it was
    // lost, the new-tenant branch demands Steps 1-3 and shows "Câmp
    // obligatoriu" instead — finalizeKycMock is never reached.
    await waitFor(() => {
      expect(finalizeKycMock).toHaveBeenCalledWith({ draftId: 'draft-1' })
    })
    expect(screen.queryByText('Câmp obligatoriu')).toBeNull()
  })
})
