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
