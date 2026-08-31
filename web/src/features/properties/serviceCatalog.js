/**
 * The catalog of predefined services (SRS §6, FR-PROP-02).
 *
 * A constant hardcoded in the application — NOT a Firestore collection. It is a
 * fixed seed that the admin does not edit; a collection would add a read and
 * access rules for data that never changes.
 *
 * Maintenance is NOT a service — it is its own category in the monthly report
 * (FR-REP-01a), alongside rent. That is why it does not appear here.
 *
 * Custom services (FR-PROP-02) do not go through the catalog: they are added with
 * a free-form name and `source: 'custom'`.
 *
 * Each entry has only a `serviceId` + an i18n key: the displayed name is
 * translated at render time (NFR-LOC-01). The service stored on the property has
 * the shape `{ serviceId, name, source }` (SRS §6) — `name` is a snapshot, so
 * that removing a service does not affect already-published reports (FR-PROP-08).
 */

export const SERVICE_SOURCE = {
  CATALOG: 'catalog',
  CUSTOM: 'custom',
}

export const SERVICE_CATALOG = [
  { serviceId: 'electricity', labelKey: 'properties.services.electricity' },
  { serviceId: 'gas', labelKey: 'properties.services.gas' },
  { serviceId: 'internet', labelKey: 'properties.services.internet' },
  { serviceId: 'tv', labelKey: 'properties.services.tv' },
  { serviceId: 'water', labelKey: 'properties.services.water' },
]

const CATALOG_BY_ID = new Map(
  SERVICE_CATALOG.map((entry) => [entry.serviceId, entry]),
)

/**
 * The DISPLAY label for a stored service line. A catalog service
 * re-translates through its i18n key every render, so the stored `name` — a
 * snapshot frozen for reports (FR-PROP-08) — never freezes the interface
 * language; a custom service has no key, so its stored `name` IS the content
 * and shows as-is (2026-08-31 UI/UX audit, finding #4).
 *
 * Works on two shapes: a property's service `{ serviceId, name, source }`
 * (SRS §6) AND a report's cost line `{ serviceId, name, amount, … }`, which
 * carries NO `source` at all. So the test is: the `serviceId` is one of the
 * five fixed catalog ids AND `source` is not explicitly `'custom'`. The
 * catalog id set is a hardcoded constant and `AddServiceDialog` only ever
 * stores a catalog service under its literal id (a custom one gets a
 * `crypto.randomUUID()`), so a catalog hit is sufficient and no data
 * migration is needed. Anything off that path — an unknown id, a UUID, a
 * `'custom'` source — falls through to the stored `name`.
 */
export function serviceLabel(service, t) {
  const entry = CATALOG_BY_ID.get(service.serviceId)
  return entry && service.source !== SERVICE_SOURCE.CUSTOM
    ? t(entry.labelKey)
    : service.name
}
