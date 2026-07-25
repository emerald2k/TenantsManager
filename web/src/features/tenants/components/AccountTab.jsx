import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Section } from '@/features/tenants/components/ProfileTab'
import {
  mapUserStatus,
  StatusBadge,
} from '@/features/tenants/pages/TenantsListPage'
import {
  useResetTenantPassword,
  useSetTenantAccountStatus,
  useUserTenancies,
} from '@/features/tenants/hooks'

/**
 * The Account tab (M3-D, SRS §5.3, FR-TEN-24): status badge, "Reset
 * password", "Disable/Re-enable", "Archive". Implements Bogdan's state
 * machine (M3-D, revised post-M3-audit D#3):
 *
 *   active → (End Contract) → inactive-readonly → (Archive) → archived
 *   active / inactive-readonly ⇄ disabled  (re-enable RECALCULATES the
 *     status server-side — setTenantAccountStatus, not this component)
 *   archived is terminal — no actions.
 *
 * Archive goes through `setTenantAccountStatus` with `action:'archive'` — the
 * SAME callable as Disable/Re-enable, NOT a plain client-side Firestore write
 * (the original M3-D design). A post-merge audit found that a purely
 * Firestore-side archive left a native Firebase Auth login fully working for
 * an "archived" account, contradicting SRS §5.3's login spec ("disabled/
 * archived account → blocked"). Archiving now also disables the Auth account
 * server-side (see setTenantAccountStatus.js) — the same fix Disable already
 * had. The "blocked while there's an active tenancy or the account is
 * disabled" guard still lives HERE too (disabled button + message) as a UI
 * convenience; the ACTIVE-TENANCY half is re-enforced server-side
 * (setTenantAccountStatus.js's `archive()`). The DISABLED half is NOT
 * re-enforced server-side — archiving now implies disabled anyway, so
 * blocking archive on an already-disabled account has no server-side
 * safety rationale left; this is a judgment call flagged to Bogdan, not a
 * silently-made decision.
 */
export function AccountTab({ userId, status }) {
  const { t } = useTranslation()
  const { data: tenancies } = useUserTenancies(userId)
  const resetPassword = useResetTenantPassword()
  const setAccountStatus = useSetTenantAccountStatus()

  const [generatedPassword, setGeneratedPassword] = useState(null)
  const [resetError, setResetError] = useState(false)
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false)
  const [statusError, setStatusError] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [archiveError, setArchiveError] = useState(false)

  const isArchived = status === 'archived'
  const isDisabled = status === 'disabled'
  const hasActiveTenancy = (tenancies ?? []).some(
    (tenancy) => tenancy.status === 'active',
  )
  const archiveBlockedReason = hasActiveTenancy
    ? 'activeTenancy'
    : isDisabled
      ? 'disabled'
      : null

  async function handleResetPassword() {
    setResetError(false)
    try {
      const response = await resetPassword.mutateAsync({ userId })
      setGeneratedPassword(response.data.password)
    } catch {
      setResetError(true)
    }
  }

  async function handleToggleStatus() {
    setStatusError(false)
    try {
      await setAccountStatus.mutateAsync({
        userId,
        action: isDisabled ? 'enable' : 'disable',
      })
      setStatusConfirmOpen(false)
    } catch {
      setStatusError(true)
    }
  }

  async function handleArchive() {
    setArchiveError(false)
    try {
      await setAccountStatus.mutateAsync({ userId, action: 'archive' })
      setArchiveConfirmOpen(false)
    } catch {
      setArchiveError(true)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Section title={t('tenants.detail.account.title')}>
        <StatusBadge statusKey={mapUserStatus(status)} />
      </Section>

      {isArchived ? (
        <p className="text-sm text-muted-foreground">
          {t('tenants.detail.account.archivedNotice')}
        </p>
      ) : (
        <>
          <Section title={t('tenants.detail.account.resetPasswordTitle')}>
            <Button
              type="button"
              onClick={handleResetPassword}
              disabled={resetPassword.isPending}
            >
              {t('tenants.detail.account.resetPasswordButton')}
            </Button>
            {resetError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {t('tenants.detail.account.resetPasswordError')}
              </p>
            )}
          </Section>

          <Section title={t('tenants.detail.account.statusActionTitle')}>
            <Button
              type="button"
              variant={isDisabled ? 'default' : 'destructive'}
              onClick={() => setStatusConfirmOpen(true)}
            >
              {isDisabled
                ? t('tenants.detail.account.enableButton')
                : t('tenants.detail.account.disableButton')}
            </Button>
          </Section>

          <Section title={t('tenants.detail.account.archiveTitle')}>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setArchiveConfirmOpen(true)}
              disabled={Boolean(archiveBlockedReason)}
            >
              {t('tenants.detail.account.archiveButton')}
            </Button>
            {archiveBlockedReason && (
              <p className="mt-2 text-sm text-muted-foreground">
                {t(
                  `tenants.detail.account.archiveBlocked.${archiveBlockedReason}`,
                )}
              </p>
            )}
          </Section>
        </>
      )}

      <Dialog
        open={Boolean(generatedPassword)}
        onOpenChange={(open) => !open && setGeneratedPassword(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('tenants.detail.account.resetPasswordDialogTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <span className="font-mono">{generatedPassword}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.writeText(generatedPassword)}
            >
              {t('onboarding.stepContract.copyPassword')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={statusConfirmOpen}
        onOpenChange={(open) => {
          setStatusConfirmOpen(open)
          if (open) setStatusError(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isDisabled
                ? t('tenants.detail.account.enableConfirmTitle')
                : t('tenants.detail.account.disableConfirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {isDisabled
                ? t('tenants.detail.account.enableConfirmBody')
                : t('tenants.detail.account.disableConfirmBody')}
            </DialogDescription>
          </DialogHeader>
          {statusError && (
            <p role="alert" className="text-sm text-destructive">
              {t('tenants.detail.account.statusActionError')}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStatusConfirmOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant={isDisabled ? 'default' : 'destructive'}
              onClick={handleToggleStatus}
              disabled={setAccountStatus.isPending}
            >
              {setAccountStatus.isPending
                ? t('common.loading')
                : isDisabled
                  ? t('tenants.detail.account.enableButton')
                  : t('tenants.detail.account.disableButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={archiveConfirmOpen}
        onOpenChange={(open) => {
          setArchiveConfirmOpen(open)
          if (open) setArchiveError(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('tenants.detail.account.archiveConfirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('tenants.detail.account.archiveConfirmBody')}
            </DialogDescription>
          </DialogHeader>
          {archiveError && (
            <p role="alert" className="text-sm text-destructive">
              {t('tenants.detail.account.statusActionError')}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setArchiveConfirmOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleArchive}
              disabled={setAccountStatus.isPending}
            >
              {setAccountStatus.isPending
                ? t('common.loading')
                : t('tenants.detail.account.archiveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
