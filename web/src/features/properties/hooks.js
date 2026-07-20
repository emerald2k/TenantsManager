import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'

/**
 * The data access layer for properties (FR-PROP-01…07, SRS §6).
 *
 * We read with `getDocs`/`getDoc` — a single read — NOT with `onSnapshot`. The
 * list stays fresh because every mutation invalidates the queries it touches
 * (see `@/lib/queryClient` for the reasoning).
 *
 * Components NEVER touch `firebase/firestore` directly: all data access goes
 * through here. That keeps the backend boundary in one place — and it is exactly
 * the boundary the tests mock.
 */

const COLLECTION = 'properties'

/**
 * The cache keys, hierarchically. Invalidating on `lists()` catches every list
 * variant (with and without archived) in a single call, without enumerating them.
 */
export const propertyKeys = {
  all: ['properties'],
  lists: () => [...propertyKeys.all, 'list'],
  list: (options) => [...propertyKeys.lists(), options],
  details: () => [...propertyKeys.all, 'detail'],
  detail: (id) => [...propertyKeys.details(), id],
}

function propertyRef(id) {
  return doc(db, COLLECTION, id)
}

/**
 * The property list (FR-PROP-07).
 *
 * Filtering out archived properties happens HERE, in the query — not in the
 * Security Rules (architecture decision: the rules are an access boundary, not a
 * business-logic one). `includeArchived: true` serves the "Show archived" toggle
 * from sub-stage E.
 *
 * No `orderBy('name')`: combined with `where('archived', ...)` it would require a
 * composite index in Firestore. At 5–20 properties (NFR-PERF-01) the alphabetical
 * sorting (FR-PROP-07) is done in memory, at display time.
 */
export function useProperties({ includeArchived = false } = {}) {
  return useQuery({
    queryKey: propertyKeys.list({ includeArchived }),
    queryFn: async () => {
      const constraints = includeArchived
        ? []
        : [where('archived', '==', false)]
      const snap = await getDocs(
        query(collection(db, COLLECTION), ...constraints),
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
  })
}

/** A single property (FR-PROP-04). `enabled` holds the read back until there is an id. */
export function useProperty(id) {
  return useQuery({
    queryKey: propertyKeys.detail(id),
    enabled: Boolean(id),
    queryFn: async () => {
      const snap = await getDoc(propertyRef(id))
      if (!snap.exists()) {
        throw new Error(`Property ${id} does not exist`)
      }
      return { id: snap.id, ...snap.data() }
    },
  })
}

/**
 * Property creation (FR-PROP-01).
 *
 * Besides the form values, the document receives the system fields:
 * - `ownerId` — from SRS §6; there is a single admin (NFR-SEC-04)
 * - `services: []` — the list is populated from the property page (FR-PROP-02)
 * - `status: 'free'` — provisional; from M2 it is computed from tenancies (FR-PROP-05)
 * - `archived: false` — MANDATORY explicitly: a `where('archived','==',false)` does
 *   NOT return documents that lack the field, so a document without it would
 *   silently disappear from the list.
 */
export function useCreateProperty() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (values) => {
      const ref = await addDoc(collection(db, COLLECTION), {
        ...values,
        ownerId: auth.currentUser?.uid ?? null,
        services: [],
        status: 'free',
        archived: false,
      })
      return ref.id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() })
    },
  })
}

/** Editing the property data (FR-PROP-04). */
export function useUpdateProperty() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, values }) => updateDoc(propertyRef(id), values),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() })
      queryClient.invalidateQueries({ queryKey: propertyKeys.detail(id) })
    },
  })
}

/**
 * Archiving = soft-delete (FR-PROP-06): marks `archived: true`, does NOT delete
 * the document. The property has history (reports, tenancies) that must survive;
 * a physical deletion would break it.
 */
export function useArchiveProperty() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id) => updateDoc(propertyRef(id), { archived: true }),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() })
      queryClient.invalidateQueries({ queryKey: propertyKeys.detail(id) })
    },
  })
}

/**
 * Adding a service (FR-PROP-02).
 *
 * `service` is the complete `{ serviceId, name, source }` object (SRS §6), built
 * by the component — the hook does not compose it. That way the same mutation
 * serves both the catalog and custom services, without knowing the difference.
 *
 * `arrayUnion` writes without re-reading the document: no race between read and
 * write, unlike "read the list, add, write the list".
 */
export function useAddService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ propertyId, service }) =>
      updateDoc(propertyRef(propertyId), { services: arrayUnion(service) }),
    onSuccess: (_result, { propertyId }) => {
      queryClient.invalidateQueries({
        queryKey: propertyKeys.detail(propertyId),
      })
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() })
    },
  })
}

/**
 * Removing a service (FR-PROP-02).
 *
 * `arrayRemove` needs the object EXACTLY as stored — the component passes along
 * the element from `services`, not a reconstructed one.
 *
 * It does not touch published reports (FR-PROP-08): there the name and cost are
 * snapshots, and the service disappears only from future reports.
 */
export function useRemoveService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ propertyId, service }) =>
      updateDoc(propertyRef(propertyId), { services: arrayRemove(service) }),
    onSuccess: (_result, { propertyId }) => {
      queryClient.invalidateQueries({
        queryKey: propertyKeys.detail(propertyId),
      })
      queryClient.invalidateQueries({ queryKey: propertyKeys.lists() })
    },
  })
}

/**
 * The active tenancy for a property, if any (Sub-stage E, FR-PROP-11): backs the
 * due-day + countdown shown next to the status badge on the property detail page.
 * `null` (not an error) when the property is free — a free property is a normal,
 * expected state, not a failure. `enabled` holds the read back until there is a
 * propertyId, exactly like `useProperty`.
 */
export function useActiveTenancyForProperty(propertyId) {
  return useQuery({
    queryKey: ['tenancies', 'activeForProperty', propertyId],
    enabled: Boolean(propertyId),
    queryFn: async () => {
      const snap = await getDocs(
        query(
          collection(db, 'tenancies'),
          where('propertyId', '==', propertyId),
          where('status', '==', 'active'),
          limit(1),
        ),
      )
      if (snap.empty) return null
      const match = snap.docs[0]
      return { id: match.id, ...match.data() }
    },
  })
}
