/**
 * The title + actions row every admin list page opens with (SRS §5.5's
 * shared shell, M8 stage 10) — extracted from what PropertiesListPage and
 * TenantsListPage had already converged on independently (`h1` +
 * flex-wrapped actions on the right), so a third and fourth page reuse it
 * instead of hand-copying the markup a third time.
 */
export function PageHeader({ title, actions }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      {actions && (
        <div className="flex flex-wrap items-center gap-4">{actions}</div>
      )}
    </div>
  )
}
