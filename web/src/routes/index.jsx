import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { PlaceholderPage } from '@/components/shared/PlaceholderPage'
import { NotFoundPage } from '@/components/shared/NotFoundPage'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { ProtectedRoute, GuestRoute, RootRedirect } from '@/routes/guards'
import { AdminLayout } from '@/routes/AdminLayout'
import { TenantLayout } from '@/routes/TenantLayout'

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />

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
              path="/admin/luna-curenta"
              element={<PlaceholderPage titleKey="pages.currentMonth" />}
            />
            <Route
              path="/admin/proprietati"
              element={<PlaceholderPage titleKey="pages.propertiesList" />}
            />
            <Route
              path="/admin/proprietati/noua"
              element={<PlaceholderPage titleKey="pages.newProperty" />}
            />
            <Route
              path="/admin/proprietati/:id"
              element={<PlaceholderPage titleKey="pages.propertyDetail" />}
            />
            <Route
              path="/admin/chiriasi"
              element={<PlaceholderPage titleKey="pages.tenantsList" />}
            />
            <Route
              path="/admin/onboarding/:draftId"
              element={<PlaceholderPage titleKey="pages.onboardingWizard" />}
            />
            <Route
              path="/admin/chiriasi/:id"
              element={<PlaceholderPage titleKey="pages.tenantDetail" />}
            />
            <Route
              path="/admin/rapoarte/:propertyId"
              element={<PlaceholderPage titleKey="pages.monthlyReportForm" />}
            />
            {/* Faza 2 */}
            <Route
              path="/admin/rapoarte"
              element={<PlaceholderPage titleKey="pages.reportsListPhase2" />}
            />
            <Route
              path="/admin/raport-anual"
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
              path="/app/istoric"
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
