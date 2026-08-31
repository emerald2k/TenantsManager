import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import {
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { renderHookWithProviders } from './renderWithProviders'
import {
  useActiveTenancies,
  useAllTenancies,
  useEndTenancy,
  useRecalculateTenancyBalance,
  useResetTenantPassword,
  useSetTenantAccountStatus,
  useSettleDeposit,
  useUpdateTenancy,
  useUpdateUser,
  useUserTenancies,
  useUsers,
} from '@/features/tenants/hooks'

// Hook tests with the BOUNDARY MOCKED — no emulator, same convention as the
// onboarding/property hook tests. We check WHICH Firestore operation runs and
// with WHICH constraints; that the rules actually allow the admin read sits in
// the rules band (unchanged here — firestore.rules already grants admin full
// read on both `users` and `tenancies`).

vi.mock('@/lib/firebase', () => ({
  db: { __fake: 'db' },
  functions: { __fake: 'functions' },
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ __collection: name })),
  doc: vi.fn((_db, collection, id) => ({ __doc: `${collection}/${id}` })),
  getDocs: vi.fn(),
  updateDoc: vi.fn(),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}))

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }))

vi.mock('@/lib/fileUpload', () => ({
  uploadAttachment: vi.fn(),
  deleteAttachmentBestEffort: vi.fn(),
}))

import { deleteAttachmentBestEffort, uploadAttachment } from '@/lib/fileUpload'

function listSnapshot(docs) {
  return { docs: docs.map(({ id, ...data }) => ({ id, data: () => data })) }
}

beforeEach(() => {
  vi.clearAllMocks()
  deleteAttachmentBestEffort.mockResolvedValue(undefined)
})

describe('useUsers (FR-TEN-13 — all tenants)', () => {
  it('reads every user with its id alongside the data', async () => {
    const USERS = [
      { id: 'u1', name: 'Ana', status: 'active' },
      { id: 'u2', name: 'Barbu', status: 'inactive-readonly' },
    ]
    getDocs.mockResolvedValue(listSnapshot(USERS))

    const { result } = await renderHookWithProviders(() => useUsers())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(USERS)
    // The whole collection — no WHERE. The archived filtering is a display
    // preference done client-side (status is an enum, not a boolean axis).
    expect(getDocs).toHaveBeenCalledWith({ __collection: 'users' })
  })
})

describe('useActiveTenancies (FR-CON-02 — join for property + balance)', () => {
  it('reads only the active tenancies, constrained by status', async () => {
    const TENANCIES = [
      {
        id: 't1',
        userId: 'u1',
        property: { name: 'Apartament Centru' },
        currentBalance: 0,
        status: 'active',
      },
    ]
    getDocs.mockResolvedValue(listSnapshot(TENANCIES))

    const { result } = await renderHookWithProviders(() => useActiveTenancies())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(TENANCIES)
    // The query is constrained to status == 'active' — ended tenancies never
    // decide a row's "current property".
    expect(where).toHaveBeenCalledWith('status', '==', 'active')
    expect(query).toHaveBeenCalledWith(
      { __collection: 'tenancies' },
      { __where: ['status', '==', 'active'] },
    )
  })
})

describe('useAllTenancies (M8 stage 12 — payments ledger property/renter join)', () => {
  it('reads the WHOLE collection, any status — no WHERE, unlike useActiveTenancies', async () => {
    const TENANCIES = [
      {
        id: 't1',
        tenantName: 'Ion Popescu',
        property: { name: 'Apartament Centru' },
        status: 'active',
        currentBalance: 0,
      },
      {
        id: 't2',
        tenantName: 'Maria Ionescu',
        property: { name: 'Casa Zorilor' },
        status: 'ended',
        currentBalance: 0,
      },
    ]
    getDocs.mockResolvedValue(listSnapshot(TENANCIES))

    const { result } = await renderHookWithProviders(() => useAllTenancies())

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(TENANCIES)
    expect(getDocs).toHaveBeenCalledWith({ __collection: 'tenancies' })
    expect(where).not.toHaveBeenCalled()
  })
})

describe('useUpdateUser (FR-TEN-11 — Profile tab per-section edit)', () => {
  beforeEach(() => {
    updateDoc.mockResolvedValue(undefined)
  })

  it('writes the values to users/{id}, stripped of undefined keys', async () => {
    const { result } = await renderHookWithProviders(() => useUpdateUser())

    await result.current.mutateAsync({
      id: 'u1',
      values: { name: 'Ana Pop', mailingAddress: undefined },
    })

    expect(doc).toHaveBeenCalledWith({ __fake: 'db' }, 'users', 'u1')
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      { name: 'Ana Pop' },
    )
  })

  // Regression (advisor-flagged, M3-B): `guarantor` is ONE Firestore map holding
  // both the text fields (name/cnp/phone) AND `idDocumentPhotos[]` (owned by the
  // gallery, not the text-section form). A naive `{ guarantor: {name,cnp,phone} }`
  // would REPLACE the whole map and silently drop the photos. The hook itself
  // does no flattening — it is a dumb pass-through — so a caller using
  // Firestore's own dot-path keys must reach Firestore untouched, byte for byte.
  it('passes dot-path keys straight through, so a nested-object write does not need to know its siblings', async () => {
    const { result } = await renderHookWithProviders(() => useUpdateUser())

    await result.current.mutateAsync({
      id: 'u1',
      values: {
        'guarantor.name': 'Maria Ionescu',
        'guarantor.cnp': '9876543210123',
        'guarantor.phone': '0733000111',
      },
    })

    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'users/u1' },
      {
        'guarantor.name': 'Maria Ionescu',
        'guarantor.cnp': '9876543210123',
        'guarantor.phone': '0733000111',
      },
    )
  })

  it('invalidates both the tenant list and the user detail on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useUpdateUser(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ id: 'u1', values: { name: 'Ana' } })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['users', 'list'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['users', 'detail', 'u1'],
    })
  })
})

describe('useUserTenancies (FR-TEN-15 — full history for one user)', () => {
  it('reads every tenancy for the user, active and ended alike (no status filter)', async () => {
    const TENANCIES = [
      { id: 't1', userId: 'u1', status: 'active' },
      { id: 't2', userId: 'u1', status: 'ended' },
    ]
    getDocs.mockResolvedValue(listSnapshot(TENANCIES))

    const { result } = await renderHookWithProviders(() =>
      useUserTenancies('u1'),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(TENANCIES)
    expect(where).toHaveBeenCalledWith('userId', '==', 'u1')
    expect(query).toHaveBeenCalledWith(
      { __collection: 'tenancies' },
      { __where: ['userId', '==', 'u1'] },
    )
  })

  it('does not query until a userId is provided', async () => {
    const { result } = await renderHookWithProviders(() =>
      useUserTenancies(undefined),
    )

    expect(result.current.fetchStatus).toBe('idle')
    expect(getDocs).not.toHaveBeenCalled()
  })
})

describe('useUpdateTenancy (FR-CON-06 — Extend)', () => {
  beforeEach(() => {
    updateDoc.mockResolvedValue(undefined)
  })

  it('writes the values to tenancies/{id}, stripped of undefined keys', async () => {
    const { result } = await renderHookWithProviders(() => useUpdateTenancy())

    await result.current.mutateAsync({
      id: 't1',
      userId: 'u1',
      values: { endDate: '2028-01-01', securityDeposit: undefined },
    })

    expect(doc).toHaveBeenCalledWith({ __fake: 'db' }, 'tenancies', 't1')
    expect(updateDoc).toHaveBeenCalledWith(
      { __doc: 'tenancies/t1' },
      { endDate: '2028-01-01' },
    )
  })

  it('invalidates the user’s tenancy history and the active-tenancies list', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useUpdateTenancy(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      id: 't1',
      userId: 'u1',
      values: { endDate: '2028-01-01' },
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'byUser', 'u1'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'active', 'list'],
    })
  })
})

describe('useEndTenancy (FR-CON-03/04/05 — End contract)', () => {
  const endTenancyMock = vi.fn()

  beforeEach(() => {
    httpsCallable.mockReturnValue(endTenancyMock)
    endTenancyMock.mockResolvedValue({ data: { tenancyId: 't1' } })
  })

  it('calls the endTenancy callable with the tenancyId', async () => {
    const { result } = await renderHookWithProviders(() => useEndTenancy())

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      propertyId: 'p1',
    })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'endTenancy',
    )
    expect(endTenancyMock).toHaveBeenCalledWith({ tenancyId: 't1' })
  })

  it('invalidates tenancy, user, and property caches on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useEndTenancy(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      propertyId: 'p1',
    })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'byUser', 'u1'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'active', 'list'],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users', 'list'] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['users', 'detail', 'u1'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['properties', 'list'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['properties', 'detail', 'p1'],
    })
  })

  // Anti-vacuity: without a try/catch swallowing it, this proves the caller
  // (the End-contract dialog) can classify the arrears error and show the
  // right message instead of a generic failure.
  it('propagates a failed-precondition (arrears) error without swallowing it', async () => {
    const arrearsError = Object.assign(new Error('failed'), {
      code: 'functions/failed-precondition',
      details: { reason: 'arrears', currentBalance: 150 },
    })
    endTenancyMock.mockRejectedValue(arrearsError)
    const { result } = await renderHookWithProviders(() => useEndTenancy())

    await expect(
      result.current.mutateAsync({
        tenancyId: 't1',
        userId: 'u1',
        propertyId: 'p1',
      }),
    ).rejects.toMatchObject({ details: { reason: 'arrears' } })
  })
})

describe('useResetTenantPassword (Account tab — Reset password)', () => {
  const resetMock = vi.fn()

  beforeEach(() => {
    httpsCallable.mockReturnValue(resetMock)
    resetMock.mockResolvedValue({ data: { password: 'AbCdEfGh2345' } })
  })

  it('calls the resetTenantPassword callable with userId', async () => {
    const { result } = await renderHookWithProviders(() =>
      useResetTenantPassword(),
    )

    const response = await result.current.mutateAsync({ userId: 'u1' })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'resetTenantPassword',
    )
    expect(resetMock).toHaveBeenCalledWith({ userId: 'u1' })
    expect(response.data.password).toBe('AbCdEfGh2345')
  })
})

describe('useSetTenantAccountStatus (Account tab — Disable/Re-enable)', () => {
  const statusMock = vi.fn()

  beforeEach(() => {
    httpsCallable.mockReturnValue(statusMock)
    statusMock.mockResolvedValue({ data: { status: 'disabled' } })
  })

  it('calls the setTenantAccountStatus callable with userId + action', async () => {
    const { result } = await renderHookWithProviders(() =>
      useSetTenantAccountStatus(),
    )

    await result.current.mutateAsync({ userId: 'u1', action: 'disable' })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'setTenantAccountStatus',
    )
    expect(statusMock).toHaveBeenCalledWith({
      userId: 'u1',
      action: 'disable',
    })
  })

  it('invalidates the tenant list and the user detail on success', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSetTenantAccountStatus(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ userId: 'u1', action: 'enable' })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['users', 'list'] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['users', 'detail', 'u1'],
    })
  })
})

describe('useSettleDeposit (FR-CON-10/11/12 — deposit settlement)', () => {
  beforeEach(() => {
    updateDoc.mockResolvedValue(undefined)
  })

  it('writes ONLY depositSettlement to tenancies/{id} — never currentBalance/closingBalance (FR-CON-11)', async () => {
    const { result } = await renderHookWithProviders(() => useSettleDeposit())

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      items: [{ description: 'Curățenie', amount: 200, attachments: [] }],
      securityDeposit: 1800,
    })

    expect(doc).toHaveBeenCalledWith({ __fake: 'db' }, 'tenancies', 't1')
    expect(updateDoc).toHaveBeenCalledTimes(1)
    const [, payload] = updateDoc.mock.calls[0]
    expect(Object.keys(payload)).toEqual(['depositSettlement'])
    expect(payload.depositSettlement).toMatchObject({
      items: [{ description: 'Curățenie', amount: 200, attachments: [] }],
      deducted: 200,
      toReturn: 1600,
      ownerBears: 0,
    })
  })

  it('computes ownerBears, never toReturn, when deductions exceed the deposit — and it is never folded into a debt field', async () => {
    const { result } = await renderHookWithProviders(() => useSettleDeposit())

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      items: [
        { description: 'Reparații majore', amount: 2500, attachments: [] },
      ],
      securityDeposit: 1800,
    })

    const [, payload] = updateDoc.mock.calls[0]
    expect(payload.depositSettlement).toMatchObject({
      deducted: 2500,
      toReturn: 0,
      ownerBears: 700,
    })
    // FR-CON-10: no field on this write can be mistaken for a tenant debt —
    // the only numbers written are items/deducted/toReturn/ownerBears/settledAt.
    expect(Object.keys(payload.depositSettlement).sort()).toEqual([
      'deducted',
      'items',
      'ownerBears',
      'settledAt',
      'toReturn',
    ])
  })

  it('stamps a fresh settledAt on first completion', async () => {
    const { result } = await renderHookWithProviders(() => useSettleDeposit())

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      items: [{ description: 'Curățenie', amount: 200, attachments: [] }],
      securityDeposit: 1800,
    })

    expect(serverTimestamp).toHaveBeenCalled()
    const [, payload] = updateDoc.mock.calls[0]
    expect(payload.depositSettlement.settledAt).toEqual({
      __serverTimestamp: true,
    })
  })

  it('keeps the ORIGINAL settledAt on a correction, instead of stamping a new one', async () => {
    const { result } = await renderHookWithProviders(() => useSettleDeposit())
    const original = { __fixedTimestamp: '2026-06-01' }

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      items: [
        { description: 'Curățenie (corectat)', amount: 250, attachments: [] },
      ],
      securityDeposit: 1800,
      existingSettledAt: original,
    })

    const [, payload] = updateDoc.mock.calls[0]
    expect(payload.depositSettlement.settledAt).toEqual(original)
    // serverTimestamp() is still called elsewhere in the module in other
    // tests, so assert on THIS call's payload rather than call-count.
  })

  it('uploads a file-bearing attachment and writes its clean {path,name,type}, never the File object', async () => {
    uploadAttachment.mockResolvedValue({
      path: 'tenancies/t1/settlement/uuid-invoice.pdf',
      name: 'invoice.pdf',
      type: 'pdf',
    })
    const { result } = await renderHookWithProviders(() => useSettleDeposit())
    const file = new File(['x'], 'invoice.pdf', { type: 'application/pdf' })

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      items: [
        {
          description: 'Curățenie',
          amount: 200,
          attachments: [{ name: 'invoice.pdf', type: 'pdf', file }],
        },
      ],
      securityDeposit: 1800,
    })

    expect(uploadAttachment).toHaveBeenCalledWith(
      expect.stringMatching(/^tenancies\/t1\/settlement\/.+-invoice\.pdf$/),
      file,
    )
    const [, payload] = updateDoc.mock.calls[0]
    expect(payload.depositSettlement.items[0].attachments[0]).toEqual({
      path: 'tenancies/t1/settlement/uuid-invoice.pdf',
      name: 'invoice.pdf',
      type: 'pdf',
    })
  })

  it('on a failed write, deletes only the attachments THIS call just uploaded (orphan cleanup)', async () => {
    uploadAttachment.mockResolvedValue({
      path: 'tenancies/t1/settlement/uuid-new.pdf',
      name: 'new.pdf',
      type: 'pdf',
    })
    updateDoc.mockRejectedValue(new Error('boom'))
    const { result } = await renderHookWithProviders(() => useSettleDeposit())
    const file = new File(['x'], 'new.pdf', { type: 'application/pdf' })

    await expect(
      result.current.mutateAsync({
        tenancyId: 't1',
        userId: 'u1',
        items: [
          {
            description: 'Curățenie',
            amount: 200,
            attachments: [{ name: 'new.pdf', type: 'pdf', file }],
          },
        ],
        securityDeposit: 1800,
      }),
    ).rejects.toThrow('boom')

    expect(deleteAttachmentBestEffort).toHaveBeenCalledWith(
      'tenancies/t1/settlement/uuid-new.pdf',
    )
  })

  it('after a successful write, deletes attachments the admin removed (diffed against previousAttachmentPaths)', async () => {
    const { result } = await renderHookWithProviders(() => useSettleDeposit())

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      items: [
        {
          description: 'Curățenie',
          amount: 200,
          attachments: [
            {
              path: 'tenancies/t1/settlement/kept.pdf',
              name: 'kept.pdf',
              type: 'pdf',
            },
          ],
        },
      ],
      securityDeposit: 1800,
      previousAttachmentPaths: [
        'tenancies/t1/settlement/kept.pdf',
        'tenancies/t1/settlement/removed.pdf',
      ],
    })

    expect(deleteAttachmentBestEffort).toHaveBeenCalledTimes(1)
    expect(deleteAttachmentBestEffort).toHaveBeenCalledWith(
      'tenancies/t1/settlement/removed.pdf',
    )
  })

  it('invalidates only this user’s tenancy history — no currentBalance-adjacent cache (FR-CON-11)', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useSettleDeposit(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
      items: [{ description: 'Curățenie', amount: 200, attachments: [] }],
      securityDeposit: 1800,
    })

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'byUser', 'u1'],
    })
  })
})

describe('useRecalculateTenancyBalance (FR-SYS-05a — M8 stage 7)', () => {
  const recalculateMock = vi.fn()

  beforeEach(() => {
    httpsCallable.mockReturnValue(recalculateMock)
    recalculateMock.mockResolvedValue({ data: { from: 350, to: 2000 } })
  })

  it('calls the recalculateTenancyBalance callable with the tenancyId, never a Firestore write', async () => {
    const { result } = await renderHookWithProviders(() =>
      useRecalculateTenancyBalance(),
    )

    const response = await result.current.mutateAsync({
      tenancyId: 't1',
      userId: 'u1',
    })

    expect(httpsCallable).toHaveBeenCalledWith(
      { __fake: 'functions' },
      'recalculateTenancyBalance',
    )
    expect(recalculateMock).toHaveBeenCalledWith({ tenancyId: 't1' })
    expect(updateDoc).not.toHaveBeenCalled()
    expect(response).toEqual({ from: 350, to: 2000 })
  })

  it('invalidates the tenancy detail, the user’s history, and the active-tenancies list', async () => {
    const { result, queryClient } = await renderHookWithProviders(() =>
      useRecalculateTenancyBalance(),
    )
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await result.current.mutateAsync({ tenancyId: 't1', userId: 'u1' })

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'detail', 't1'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'byUser', 'u1'],
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['tenancies', 'active', 'list'],
    })
  })

  it('propagates a permission-denied error without swallowing it', async () => {
    recalculateMock.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'permission-denied' }),
    )
    const { result } = await renderHookWithProviders(() =>
      useRecalculateTenancyBalance(),
    )

    await expect(
      result.current.mutateAsync({ tenancyId: 't1', userId: 'u1' }),
    ).rejects.toMatchObject({ code: 'permission-denied' })
  })
})
