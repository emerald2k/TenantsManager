import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { PlaceholderPage } from '@/components/shared/PlaceholderPage'
import { NotFoundPage } from '@/components/shared/NotFoundPage'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { PropertiesListPage } from '@/features/properties/pages/PropertiesListPage'
import { CreatePropertyPage } from '@/features/properties/pages/CreatePropertyPage'
import { PropertyDetailPage } from '@/features/properties/pages/PropertyDetailPage'
import { TenantsListPage } from '@/features/tenants/pages/TenantsListPage'
import { OnboardingWizardPage } from '@/features/onboarding/pages/OnboardingWizardPage'
import { ProtectedRoute, GuestRoute, RootRedirect } from '@/routes/guards'
import { AdminLayout } from '@/routes/AdminLayout'
import { TenantLayout } from '@/routes/TenantLayout'

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />

        {/* Shared report (FR-REP-07c) — PUBLIC, entirely unguarded.
            It sits under neither ProtectedRoute nor GuestRoute: an authenticated
            admin must be able to open the link to check what the tenant sees,
            and GuestRoute would redirect them to /admin.
            Exposes EXCLUSIVELY that month's report — nothing else. */}
        <Route
          path="/r/:shareToken"
          element={<PlaceholderPage titleKey="pages.sharedReport" />}
        />

        <Route element={<GuestRoute />}>
          <Route path="/login" element={<LoginPage />} />
        </Route>

        <Route element={<ProtectedRoute allowedRole="admin" />}>
          <Route element={<AdminLayout />}>
            <Route
              path="/admin"
              element={<PlaceholderPage titleKey="pages.adminDashboard" />}
            />
            <Route
              path="/admin/current-month"
              element={<PlaceholderPage titleKey="pages.currentMonth" />}
            />
            <Route path="/admin/properties" element={<PropertiesListPage />} />
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
            <Route
              path="/admin/tenants/:id"
              element={<PlaceholderPage titleKey="pages.tenantDetail" />}
            />
            <Route
              path="/admin/reports/:propertyId"
              element={<PlaceholderPage titleKey="pages.monthlyReportForm" />}
            />
            {/* Phase 2 */}
            <Route
              path="/admin/reports"
              element={<PlaceholderPage titleKey="pages.reportsListPhase2" />}
            />
            <Route
              path="/admin/annual-report"
              element={<PlaceholderPage titleKey="pages.annualReportPhase2" />}
            />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allowedRole="tenant" />}>
          <Route element={<TenantLayout />}>
            <Route
              path="/app"
              element={<PlaceholderPage titleKey="pages.tenantDashboard" />}
            />
            <Route
              path="/app/history"
              element={<PlaceholderPage titleKey="pages.tenantHistory" />}
            />
            <Route
              path="/app/contract"
              element={<PlaceholderPage titleKey="pages.tenantContract" />}
            />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
