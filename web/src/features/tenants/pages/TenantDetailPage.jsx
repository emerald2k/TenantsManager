import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useUserById } from '@/features/onboarding/hooks'
import { ProfileTab } from '@/features/tenants/components/ProfileTab'
import {
  mapUserStatus,
  StatusBadge,
} from '@/features/tenants/pages/TenantsListPage'
import { cn } from '@/lib/utils'

/**
 * The tenant detail page (M3-B, SRS §5.3, "/admin/tenants/:id"): header + 4
 * tabs. Only the Profile tab is built this sub-stage — Tenancy & contract,
 * Financial history, and Account are literal placeholders (Sub-stages C/D/E).
 *
 * Reads `users/{userId}` via `useUserById` (onboarding/hooks.js) — the same
 * hook already used for the existing-tenant onboarding banner; reused here
 * rather than a second `users`-by-id read hook.
 *
 * Local `useState` tab switching, no URL routing for the active tab: a
 * placeholder shell does not need deep-linkable tabs, and adding one now would
 * be scope the sub-stage does not ask for.
 */

const TABS = [
  { key: 'profile', labelKey: 'tenants.detail.tabs.profile' },
  { key: 'tenancy', labelKey: 'tenants.detail.tabs.tenancy' },
  { key: 'financial', labelKey: 'tenants.detail.tabs.financial' },
  { key: 'account', labelKey: 'tenants.detail.tabs.account' },
]

export function TenantDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const { data: user, isPending, isError } = useUserById(id)
  const [activeTab, setActiveTab] = useState('profile')

  if (isPending) {
    return (
      <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (isError || !user) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('tenants.detail.notFound')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{user.name}</h1>
        <div className="mt-1">
          <StatusBadge statusKey={mapUserStatus(user.status)} />
        </div>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'rounded-t-md px-4 py-2 text-sm font-medium hover:bg-muted',
              activeTab === tab.key
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground',
            )}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {activeTab === 'profile' && <ProfileTab user={user} userId={id} />}
        {activeTab === 'tenancy' && (
          <p className="text-sm text-muted-foreground">
            {t('tenants.detail.placeholderTenancy')}
          </p>
        )}
        {activeTab === 'financial' && (
          <p className="text-sm text-muted-foreground">
            {t('tenants.detail.placeholderFinancial')}
          </p>
        )}
        {activeTab === 'account' && (
          <p className="text-sm text-muted-foreground">
            {t('tenants.detail.placeholderAccount')}
          </p>
        )}
      </div>
    </div>
  )
}
