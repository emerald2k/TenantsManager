import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { PlaceholderPage } from '@/components/shared/PlaceholderPage'
import { NotFoundPage } from '@/components/shared/NotFoundPage'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { PropertiesListPage } from '@/features/properties/pages/PropertiesListPage'
import { CreatePropertyPage } from '@/features/properties/pages/CreatePropertyPage'
import { PropertyDetailPage } from '@/features/properties/pages/PropertyDetailPage'
import { TenantsListPage } from '@/features/tenants/pages/TenantsListPage'
import { TenantDetailPage } from '@/features/tenants/pages/TenantDetailPage'
import { OnboardingWizardPage } from '@/features/onboarding/pages/OnboardingWizardPage'
import { MonthlyReportPage } from '@/features/reports/pages/MonthlyReportPage'
import { PropertyReportRedirectPage } from '@/features/reports/pages/PropertyReportRedirectPage'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { CurrentMonthPage } from '@/features/dashboard/pages/CurrentMonthPage'
import { SharedReportPage } from '@/features/sharedReport/pages/SharedReportPage'
import { TenantDashboardPage } from '@/features/tenantApp/pages/TenantDashboardPage'
import { TenantHistoryPage } from '@/features/tenantApp/pages/TenantHistoryPage'
import { TenantReportDetailPage } from '@/features/tenantApp/pages/TenantReportDetailPage'
import { TenantContractPage } from '@/features/tenantApp/pages/TenantContractPage'
import { ProtectedRoute, GuestRoute, RootRedirect } from '@/routes/guards'
import { AdminLayout } from '@/routes/AdminLayout'
import { TenantLayout } from '@/routes/TenantLayout'

export function AppRoutes() {
  return (
    <BrowserRouter>
      {/* Inside BrowserRouter (needs useLocation), outside Routes (a
          route-level render error must be caught by something above the
          routes, not beside them) — SRS §5.5, M8 stage 10. */}
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<RootRedirect />} />

          {/* Shared report (FR-REP-07c) — PUBLIC, entirely unguarded.
              It sits under neither ProtectedRoute nor GuestRoute: an authenticated
              admin must be able to open the link to check what the tenant sees,
              and GuestRoute would redirect them to /admin.
              Exposes EXCLUSIVELY that month's report — nothing else. */}
          <Route path="/r/:shareToken" element={<SharedReportPage />} />

          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>

          <Route element={<ProtectedRoute allowedRole="admin" />}>
            <Route element={<AdminLayout />}>
              <Route path="/admin" element={<DashboardPage />} />
              <Route
                path="/admin/current-month"
                element={<CurrentMonthPage />}
              />
              <Route
                path="/admin/properties"
                element={<PropertiesListPage />}
              />
              <Route
                path="/admin/properties/new"
                element={<CreatePropertyPage />}
              />
              {/* Declared AFTER /new: react-router ranks static segments above
                  dynamic ones, so "new" is never swallowed as an :id. */}
              <Route
                path="/admin/properties/:id"
                element={<PropertyDetailPage />}
              />
              <Route path="/admin/tenants" element={<TenantsListPage />} />
              <Route
                path="/admin/onboarding/:draftId"
                element={<OnboardingWizardPage />}
              />
              <Route path="/admin/tenants/:id" element={<TenantDetailPage />} />
              <Route
                path="/admin/reports/:tenancyId"
                element={<MonthlyReportPage />}
              />
              {/* Re-keyed at M8 (FR-REP-14): monthlyReports is keyed by
                  tenancy, not property, so a property alone can no longer say
                  which report to open. Two path segments keep this distinct
                  from the :tenancyId route above regardless of declaration
                  order. */}
              <Route
                path="/admin/reports/property/:propertyId"
                element={<PropertyReportRedirectPage />}
              />
              {/* Placeholders ahead of their own stages (M8 stage 10's
                  six-item sidebar links to both already) — payments lands
                  at stage 12, the notification log at stage 14. Not "Phase
                  2": these are in scope for THIS milestone, just not built
                  yet, unlike the two below. */}
              <Route
                path="/admin/payments"
                element={
                  <PlaceholderPage titleKey="pages.paymentsComingSoon" />
                }
              />
              <Route
                path="/admin/notifications"
                element={
                  <PlaceholderPage titleKey="pages.notificationsComingSoon" />
                }
              />
              {/* Phase 2 */}
              <Route
                path="/admin/reports"
                element={<PlaceholderPage titleKey="pages.reportsListPhase2" />}
              />
              <Route
                path="/admin/annual-report"
                element={
                  <PlaceholderPage titleKey="pages.annualReportPhase2" />
                }
              />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allowedRole="tenant" />}>
            <Route element={<TenantLayout />}>
              <Route path="/app" element={<TenantDashboardPage />} />
              <Route path="/app/history" element={<TenantHistoryPage />} />
              <Route
                path="/app/reports/:reportId"
                element={<TenantReportDetailPage />}
              />
              <Route path="/app/contract" element={<TenantContractPage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
