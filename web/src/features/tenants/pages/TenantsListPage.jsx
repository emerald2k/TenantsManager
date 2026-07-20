import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useCreateDraft } from '@/features/onboarding/hooks'

/**
 * The tenant list (FR-TEN-13, SRS §5.3). Today this is ONLY the onboarding entry
 * point — the full list (search, status columns, existing tenants) is M3 scope.
 *
 * Starting onboarding creates an empty draft (FR-TEN-17) and opens the wizard on it;
 * the draft, not this page, owns everything from here on.
 */
export function TenantsListPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createDraft = useCreateDraft()
  const [failed, setFailed] = useState(false)

  async function startOnboarding() {
    setFailed(false)
    try {
      const draftId = await createDraft.mutateAsync()
      navigate(`/admin/onboarding/${draftId}`)
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">
          {t('tenants.list.title')}
        </h1>
        <Button
          type="button"
          onClick={startOnboarding}
          disabled={createDraft.isPending}
        >
          {createDraft.isPending ? t('common.loading') : t('tenants.list.add')}
        </Button>
      </div>

      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('tenants.list.error')}
        </p>
      )}
    </div>
  )
}
