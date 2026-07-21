/**
 * A pure, client-side text filter shared by the tenant list (name + phone +
 * email, FR-TEN-13) and the property list (name + address, FR-PROP-07).
 *
 * At this scale (NFR-PERF-01: a handful to a few dozen rows) filtering in memory
 * at display time is the right call — no Firestore query, no index. Keeping it a
 * plain function (not a hook) makes it framework-free and trivially testable; the
 * call sites wrap it in `useMemo`.
 *
 * @param items    the rows to filter
 * @param query    the raw search input (trimmed + lowercased here)
 * @param getFields (item) => array of the item's searchable field values; each
 *                 may be a string, or null/undefined (skipped) for a field the
 *                 row has not filled in (e.g. a draft with no email yet)
 * @returns every item where ANY field contains the query as a substring,
 *          case-insensitively; the full list unchanged when the query is empty.
 */
export function filterByText(items, query, getFields) {
  const needle = query.trim().toLowerCase()
  if (needle === '') return items

  return items.filter((item) =>
    getFields(item).some(
      (field) => field != null && String(field).toLowerCase().includes(needle),
    ),
  )
}
