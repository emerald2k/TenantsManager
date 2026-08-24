import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/lib/firebase'
import { deleteAttachmentBestEffort, uploadAttachment } from '@/lib/fileUpload'
import { stripUndefinedDeep } from '@/features/onboarding/hooks'
import { propertyKeys } from '@/features/properties/hooks'

/**
 * The data access layer for the tenant list (FR-TEN-13, SRS §6) and the tenant
 * detail Profile tab (FR-TEN-11, M3-B).
 *
 * Same conventions as the properties/onboarding hooks: single reads with
 * `getDocs` (NOT `onSnapshot`); components never touch `firebase/firestore`
 * directly — that boundary lives here and is exactly what the tests mock.
 *
 * `users` and `tenancies` are both admin-only reads/writes already granted by
 * firestore.rules (added in M2 sub-stages C and E) — no rules change is needed
 * for anything here.
 */

const USERS = 'users'
const TENANCIES = 'tenancies'

function userRef(id) {
  return doc(db, USERS, id)
}

function tenancyRef(id) {
  return doc(db, TENANCIES, id)
}

export const userKeys = {
  all: ['users'],
  lists: () => [...userKeys.all, 'list'],
  list: () => [...userKeys.lists()],
}

// ───────────────────────────── useUsers ──────────────────────────
/**
 * Every tenant (FR-TEN-13). A `users` document IS a tenant: the admin account
 * carries only the custom claim, never a `users` doc (see functions/scripts/
 * setAdminClaim.js), so the whole collection is the tenant list — no need to
 * filter the admin out.
 *
 * NO `where('status','==',...)`: unlike properties (where `archived` is a
 * boolean axis filtered in the query), a tenant's archived state is one value
 * of the `status` ENUM. Filtering archived rows is a display preference done
 * client-side on the "Show archived" toggle — so we fetch all and let the page
 * decide. At this scale (NFR-PERF-01) that is cheaper than a status index.
 */
export function useUsers() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: async () => {
      const snap = await getDocs(collection(db, USERS))
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
  })
}

// ─────────────────────────── useUpdateUser ───────────────────────
/**
 * Writes to `users/{id}` from the Profile tab's per-section edit (FR-TEN-11).
 * A DUMB pass-through, deliberately: `values` reaches `updateDoc` exactly as
 * given, after `stripUndefinedDeep` (CLAUDE.md §7 — mandatory for any Firestore
 * form write; same hazard as the onboarding autosave, same fix, reused rather
 * than re-implemented).
 *
 * The hook does NOT flatten nested objects. Firestore's own `updateDoc`
 * already treats a top-level key containing a literal dot (e.g.
 * `'guarantor.name'`) as a field path, touching only that leaf. That matters
 * because `guarantor` is ONE Firestore map holding both the text fields
 * (name/cnp/phone, this hook's concern) AND `idDocumentPhotos[]` (the photo
 * gallery's concern) — a section-edit form only has the text fields in scope,
 * so it MUST save them as `{'guarantor.name': ..., 'guarantor.cnp': ..., ...}`,
 * not `{guarantor: {name, cnp, phone}}`, or it would silently wipe the photos
 * the gallery already saved. The Profile tab's guarantor section is the one
 * caller that needs this; every other section owns every field of whatever
 * nested object it edits, so a plain nested write is safe there.
 *
 * Invalidates BOTH the tenant list (`useUsers`, so an edited name/status shows
 * up back on /admin/tenants) and this user's detail read (`useUserById`,
 * onboarding/hooks.js — same `['users','detail',id]` key, reused there for the
 * existing-tenant onboarding banner and here for the Profile tab).
 */
export function useUpdateUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, values }) =>
      updateDoc(userRef(id), stripUndefinedDeep(values)),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ['users', 'detail', id] })
    },
  })
}

// ─────────────────────────── useActiveTenancies ──────────────────
/**
 * All active tenancies (FR-CON-02). The tenant list joins these to `users` by
 * `userId` to fill the "current property" (denormalized `property.name`) and
 * "outstanding balance" (`currentBalance`) columns. Constrained to
 * status == 'active' so an ended tenancy never decides a row's current property.
 *
 * FR-CON-02 guarantees at most one active tenancy per account, so keying the
 * result by `userId` in the page is unambiguous.
 */
export function useActiveTenancies() {
  return useQuery({
    queryKey: ['tenancies', 'active', 'list'],
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, TENANCIES), where('status', '==', 'active')),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
  })
}

// ─────────────────────────── useTenancy ──────────────────────────
/**
 * A single tenancy by id (FR-REP-14, M8): backs the monthly report form,
 * which is routed and keyed by tenancyId rather than propertyId since the
 * re-keying — `tenancies/{tenancyId}` already carries the denormalized
 * `property` and `tenantName` the form's header needs, so no separate
 * `useProperty` read is needed alongside this one. `null` (not an error) when
 * the id does not resolve — a stale link or a mistyped URL is a normal
 * "not found" state, not a failure, same convention as `useMonthlyReport`.
 *
 * Deliberately NOT constrained to `status == 'active'`, unlike
 * `useActiveTenancies` above: FR-REP-14 exists precisely so an ENDED tenancy
 * (the outgoing side of a mid-month handover) can still be billed for its
 * last partial month.
 */
export function useTenancy(tenancyId) {
  return useQuery({
    queryKey: ['tenancies', 'detail', tenancyId],
    enabled: Boolean(tenancyId),
    queryFn: async () => {
      const snap = await getDoc(tenancyRef(tenancyId))
      if (!snap.exists()) return null
      return { id: snap.id, ...snap.data() }
    },
  })
}

// ─────────────────────────── useUserTenancies ────────────────────
/**
 * The full tenancy HISTORY of one account (FR-TEN-15): active AND ended alike
 * — deliberately NO `where('status', ...)`, unlike `useActiveTenancies` above.
 * Backs the Tenancy & contract tab (M3-C): the active/last contract plus the
 * history of ended ones underneath it. A `userId` of `undefined` (page still
 * loading the user) holds the query back via `enabled`, same convention as
 * `useUserById` (onboarding/hooks.js).
 */
export function useUserTenancies(userId) {
  return useQuery({
    queryKey: ['tenancies', 'byUser', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, TENANCIES), where('userId', '==', userId)),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
  })
}

// ─────────────────────────── useUpdateTenancy ────────────────────
/**
 * Writes to `tenancies/{id}` — today only used by the Tenancy tab's "Extend"
 * (FR-CON-06, editing `endDate` alone), but a dumb pass-through like
 * `useUpdateUser`, for the same reason: `stripUndefinedDeep` (CLAUDE.md §7)
 * before the write, `values` untouched otherwise.
 *
 * `userId` is NOT written anywhere — it is only mutate-time context, so the
 * `onSuccess` handler knows which user's tenancy-history cache to invalidate
 * without a second read.
 */
export function useUpdateTenancy() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, values }) =>
      updateDoc(tenancyRef(id), stripUndefinedDeep(values)),
    onSuccess: (_result, { userId }) => {
      queryClient.invalidateQueries({
        queryKey: ['tenancies', 'byUser', userId],
      })
      queryClient.invalidateQueries({
        queryKey: ['tenancies', 'active', 'list'],
      })
    },
  })
}

// ─────────────────────────── useEndTenancy ───────────────────────
/**
 * Terminates a tenancy (FR-CON-03/04/05) via the `endTenancy` callable
 * (functions/src/endTenancy.js) — NOT a direct Firestore write: ending a
 * tenancy touches THREE documents (tenancy/property/user) atomically plus the
 * arrears guard, which only the Cloud Function (Admin SDK transaction) can do
 * safely. Same calling convention as `finalizeKyc`
 * (onboarding/components/StepContract.jsx): `httpsCallable`, the raw error
 * (with `.code`/`.details`) propagates to the caller UNCAUGHT here — the
 * Tenancy tab classifies it (arrears vs. generic) the same way StepContract
 * classifies `finalizeKyc` errors.
 *
 * `userId`/`propertyId` are mutate-time context (like `useUpdateTenancy`
 * above) — the callable only takes `tenancyId`; the other two ids just tell
 * `onSuccess` which caches to invalidate, since the property and the user's
 * account status both change as a side effect of this call.
 */
export function useEndTenancy() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ tenancyId }) => {
      const endTenancy = httpsCallable(functions, 'endTenancy')
      return endTenancy({ tenancyId })
    },
    onSuccess: (_result, { userId, propertyId }) => {
      queryClient.invalidateQueries({
        queryKey: ['tenancies', 'byUser', userId],
      })
      queryClient.invalidateQueries({
        queryKey: ['tenancies', 'active', 'list'],
      })
      queryClient.invalidateQueries({ queryKey: userKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ['users', 'detail', userId] })
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: propertyKeys.detail(propertyId),
      })
    },
  })
}

// ───────────────────────── useResetTenantPassword ────────────────
/**
 * Generates a new password on the tenant's Auth account (FR-AUTH-06/07) via
 * the `resetTenantPassword` callable (functions/src/resetTenantPassword.js).
 * NOT a Firestore write of any kind — no cache to invalidate. The response's
 * `data.password` is shown once in the Account tab's dialog (face-to-face
 * handoff, same convention as `finalizeKyc`'s credentials — no email).
 */
export function useResetTenantPassword() {
  return useMutation({
    mutationFn: ({ userId }) => {
      const resetTenantPassword = httpsCallable(
        functions,
        'resetTenantPassword',
      )
      return resetTenantPassword({ userId })
    },
  })
}

// ──────────────────────── useSetTenantAccountStatus ──────────────
/**
 * Disables / re-enables a tenant's account (FR-TEN-24) via the
 * `setTenantAccountStatus` callable (functions/src/setTenantAccountStatus.js)
 * — NOT a direct Firestore write: it also flips the Auth `disabled` flag and
 * revokes refresh tokens on disable, which only the Admin SDK can do.
 * `action` is `'disable'|'enable'` — re-enable RECALCULATES `users.status`
 * server-side (active tenancy → 'active', else 'inactive-readonly'), so the
 * client only needs to invalidate, never compute, the resulting status.
 */
export function useSetTenantAccountStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ userId, action }) => {
      const setTenantAccountStatus = httpsCallable(
        functions,
        'setTenantAccountStatus',
      )
      return setTenantAccountStatus({ userId, action })
    },
    onSuccess: (_result, { userId }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ['users', 'detail', userId] })
    },
  })
}

// ───────────────────────── useSettleDeposit ──────────────────────
/**
 * Writes `tenancies/{id}.depositSettlement` (FR-CON-10/11/12, M8 stage 6). A
 * PLAIN `updateDoc`, not a callable — same call as `useUpdateTenancy`, for the
 * same reason: this touches exactly one document, under the single-trusted-
 * admin model already established there. `endTenancy` needed a callable
 * because it touches three documents atomically and enforces the arrears
 * guard's removal server-side; nothing here needs a transaction.
 *
 * Never writes `currentBalance`/`closingBalance` — FR-CON-11's whole point is
 * that a settlement is completely independent of the arrears ledger.
 *
 * Storage choreography mirrors `useSaveReportDraft` (reports/hooks.js)
 * exactly, at a smaller scale (one array of items, not four cost-line
 * shapes): upload every `file`-bearing attachment under
 * `tenancies/{id}/settlement`, write the document, and on failure delete only
 * what THIS call just uploaded (never anything from a previously saved
 * settlement). On success, best-effort delete whatever attachment the admin
 * removed (`previousAttachmentPaths` diffed against what survived) — the
 * page computes that snapshot via `collectSettlementAttachmentPaths` before
 * calling this, same convention as the report page's `previousAttachmentPaths`.
 *
 * `existingSettledAt` is the settlement's ORIGINAL `settledAt` (a Firestore
 * Timestamp) when this is a correction to an already-completed settlement —
 * carried over so editing a typo doesn't reset "when this was settled";
 * `null`/`undefined` (first-ever completion) stamps a fresh
 * `serverTimestamp()`.
 */
export function useSettleDeposit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      tenancyId,
      items,
      securityDeposit,
      previousAttachmentPaths = [],
      existingSettledAt,
    }) => {
      const basePath = `tenancies/${tenancyId}/settlement`
      const newPaths = []

      const uploadedItems = await Promise.all(
        items.map(async (item) => {
          const attachments = await Promise.all(
            (item.attachments ?? []).map(async (attachment) => {
              if (!attachment.file) {
                return {
                  path: attachment.path,
                  name: attachment.name,
                  type: attachment.type,
                }
              }
              const path = `${basePath}/${crypto.randomUUID()}-${attachment.file.name}`
              const uploaded = await uploadAttachment(path, attachment.file)
              newPaths.push(uploaded.path)
              return uploaded
            }),
          )
          return {
            description: item.description,
            amount: Number(item.amount) || 0,
            attachments,
          }
        }),
      )

      const deducted = uploadedItems.reduce((sum, item) => sum + item.amount, 0)
      const deposit = securityDeposit ?? 0
      const depositSettlement = stripUndefinedDeep({
        items: uploadedItems,
        deducted,
        toReturn: Math.max(deposit - deducted, 0),
        ownerBears: Math.max(deducted - deposit, 0),
        settledAt: existingSettledAt ?? serverTimestamp(),
      })

      try {
        await updateDoc(tenancyRef(tenancyId), { depositSettlement })
      } catch (error) {
        await Promise.allSettled(
          newPaths.map((url) => deleteAttachmentBestEffort(url)),
        )
        throw error
      }

      const survivingPaths = uploadedItems.flatMap((item) =>
        item.attachments.map((attachment) => attachment.path).filter(Boolean),
      )
      const removedPaths = previousAttachmentPaths.filter(
        (url) => !survivingPaths.includes(url),
      )
      await Promise.allSettled(
        removedPaths.map((url) => deleteAttachmentBestEffort(url)),
      )

      return tenancyId
    },
    onSuccess: (_result, { userId }) => {
      queryClient.invalidateQueries({
        queryKey: ['tenancies', 'byUser', userId],
      })
    },
  })
}

// ─────────────────────── useRecalculateTenancyBalance ────────────────────
/**
 * The confirm half of the Recalculate-balance control (FR-SYS-05a, M8 stage
 * 7) — via the `recalculateTenancyBalance` callable, NOT a Firestore write:
 * `NFR-SEC-12` pins `currentBalance` against every client write, so a
 * client `updateDoc` here would simply be refused by the rules. Same
 * calling convention as `useEndTenancy`/`useSettleDeposit`'s sibling
 * callable-vs-`updateDoc` split — the Admin SDK path is the one that
 * already owns this field, and this is the one deliberate exception NFR-
 * SEC-12's own comment names.
 *
 * Returns `{ from, to }` (the callable's response) so the control can show
 * what actually changed — the confirmed write, not the client's own
 * (possibly-stale) preview.
 */
export function useRecalculateTenancyBalance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ tenancyId }) => {
      const recalculateTenancyBalance = httpsCallable(
        functions,
        'recalculateTenancyBalance',
      )
      const result = await recalculateTenancyBalance({ tenancyId })
      return result.data
    },
    onSuccess: (_result, { tenancyId, userId }) => {
      queryClient.invalidateQueries({
        queryKey: ['tenancies', 'detail', tenancyId],
      })
      queryClient.invalidateQueries({
        queryKey: ['tenancies', 'byUser', userId],
      })
      queryClient.invalidateQueries({
        queryKey: ['tenancies', 'active', 'list'],
      })
    },
  })
}
