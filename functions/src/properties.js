const { getApps, initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { onDocumentUpdated } = require('firebase-functions/v2/firestore')

/**
 * onPropertyUpdate (SRS §7.2, FR-PROP-10).
 *
 * Keeps `tenancies/{id}.property {name, address}` in sync with the property
 * it was denormalized from. Without this, the copy `toTenancyDocument`
 * (kyc.js) writes once at tenancy creation drifts silently and permanently
 * from the real property the moment the admin edits its name or address —
 * the tenant then sees a stale name/address in the portal and on the
 * contract page forever, with nothing to ever correct it.
 *
 * `onDocumentUpdated`, deliberately NOT `onDocumentWritten`: a brand-new
 * property cannot already have an active tenancy (a tenancy is only ever
 * created by finalizeKyc, which requires the property to already exist —
 * SRS §7.2), so a create event would always be a guaranteed no-op query. A
 * property is never physically deleted either — FR-PROP-06 is a soft-delete
 * (`archived: true`), the document itself stays. Only the update case can
 * ever have work to do.
 */

if (!getApps().length) {
  initializeApp()
}

/**
 * Shallow equality over the UNION of both objects' own keys — not a
 * hardcoded field list, so a future address field (e.g. a "block"/"floor"
 * addition, SRS §6) is picked up automatically without editing this file. A
 * key present on one side and absent on the other (e.g. `postalCode`
 * removed) counts as a difference: `undefined !== <value>`.
 */
function shallowEqual(a, b) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  for (const key of keys) {
    if (a?.[key] !== b?.[key]) return false
  }
  return true
}

async function onPropertyUpdateHandler(event) {
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after = event.data?.after?.exists ? event.data.after.data() : null
  if (!before || !after) return

  // GUARD: a property is also rewritten by service add/remove and archiving
  // (FR-PROP-02/06) — none of those change name/address, and without this
  // check every such edit would trigger a pointless tenancy write. Placed
  // FIRST, ahead of the corrupted-data guard below: this is a pure in-memory
  // comparison, no database round-trip, so nothing is saved by checking it
  // second — and checking it first means the corrupted-data guard's
  // console.error only fires when someone actually attempts to change the
  // name or address of a corrupted property, not on every unrelated edit
  // (service add/remove, archiving) that document happens to receive. Cloud
  // Logging is the only observability channel here (Sentry is out of scope
  // for the MVP, SRS §2.7), and noise there buries the signal.
  const nameChanged = before.name !== after.name
  const addressChanged = !shallowEqual(before.address, after.address)
  if (!nameChanged && !addressChanged) return

  // GUARD: refuse to sync from a property document missing `name` or
  // `address` (both mandatory per FR-PROP-01 — this means corrupted data,
  // not a legitimate state). The alternative — writing whatever IS present —
  // would denormalize PARTIALLY (e.g. `property: { name }`, address
  // silently dropped), destroying the tenancy's last good address instead
  // of merely failing to update it. Not writing at all means the tenancy
  // keeps its last valid denormalization, stale but intact. `console.error`
  // rather than a silent return: a return with no trace would hide corrupted
  // property data indefinitely — Cloud Logging is the only observability
  // channel here (Sentry is out of scope for the MVP, SRS §2.7). Strict
  // `== null` (catches both `undefined` and `null`), not a falsy check: an
  // empty string is degenerate data, but still a writable value, not what
  // this guard exists to catch. Placed SECOND, after the change guard: only
  // an actual attempted name/address change on a corrupted property should
  // log — an unrelated edit (service add/remove, archiving) must stay silent.
  if (after.name == null || after.address == null) {
    console.error(
      `onPropertyUpdate: property ${event.params.propertyId} is missing ` +
        `name or address — skipping sync to avoid writing a partial ` +
        `denormalization. The tenancy keeps its last valid copy.`,
    )
    return
  }

  const propertyId = event.params.propertyId
  const db = getFirestore()

  // No `orderBy` — firestore.indexes.json defines zero composite indexes, and
  // adding one here would require one (passes on emulator, fails in
  // production with FAILED_PRECONDITION). No `limit(1)` either: FR-CON-02
  // guarantees at most one active tenancy per property, but if that were
  // ever violated by corrupted data, updating every match is safer than
  // silently leaving extras stale.
  const snap = await db
    .collection('tenancies')
    .where('propertyId', '==', propertyId)
    .where('status', '==', 'active')
    .get()

  if (snap.empty) return

  // The SAME canonical shape `toTenancyDocument` (kyc.js) writes at creation
  // — the full `property` map, verbatim, in ONE write. Never a dotted path
  // (`'property.address': after.address`): `property` is a Firestore map,
  // so a dotted-path update would MERGE into the existing map instead of
  // replacing it — a key the admin just removed (e.g. `postalCode`) would
  // survive as a stale residue alongside the fresh fields, producing a
  // hybrid address worse than the drift this function exists to fix.
  const property = { name: after.name, address: after.address }

  await Promise.all(snap.docs.map((doc) => doc.ref.update({ property })))
}

const onPropertyUpdate = onDocumentUpdated(
  'properties/{propertyId}',
  onPropertyUpdateHandler,
)

module.exports = {
  onPropertyUpdate,
  onPropertyUpdateHandler,
}
