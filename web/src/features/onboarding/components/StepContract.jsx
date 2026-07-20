import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fullDraftSchema } from '@/features/onboarding/schema'
import { useUserById } from '@/features/onboarding/hooks'
import { useProperties } from '@/features/properties/hooks'

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

function FieldError({ error, t }) {
  if (!error) return null
  return <p className="text-sm text-destructive">{t(error.message)}</p>
}

/**
 * Classifies a `finalizeKyc` callable error into what the UI needs to show
 * (SRS §5.3 "Completion"). `error.code` is prefixed `functions/...` by the client
 * SDK; `error.details` is whatever the third `HttpsError` argument carried
 * server-side (`functions/src/kyc.js`):
 *  - `already-exists` + `details.conflictName` → the ONE case SRS calls out by
 *    name as a "blocking dialog with link" (duplicate CNP, new-tenant branch only).
 *  - `details.reason` (`property-occupied` / `active-tenancy`) → a structured
 *    discriminator, not string-matching the English message, for the two
 *    `failed-precondition` cases that need different text (FR-TEN-14/23 vs
 *    FR-CON-02) — both branches can throw either.
 *  - anything else → a generic message (unexpected failure, incomplete draft
 *    slipping past client validation, etc.).
 */
function classifyError(error) {
  if (!error) return null
  if (
    error.code === 'functions/already-exists' &&
    error.details?.conflictName
  ) {
    return {
      kind: 'cnp',
      conflictName: error.details.conflictName,
      conflictUserId: error.details.conflictUserId,
    }
  }
  if (error.details?.reason === 'property-occupied') return { kind: 'occupied' }
  if (error.details?.reason === 'active-tenancy')
    return { kind: 'activeTenancy' }
  return { kind: 'generic' }
}

/**
 * Step 4 — property + contract data (FR-TEN-05, FR-CON-01), and completion
 * (FR-TEN-16). Same shared-form pattern as the other steps (`useFormContext`).
 *
 * Unlike Steps 1-3, this step does NOT go through the wizard's `validateStep` /
 * Continue — it is the LAST step, and completion is "full validation" (SRS §5.3),
 * not per-step: `fullDraftSchema` (branch-aware on `existingUserId`, Sub-stage E)
 * runs on click, not on navigation.
 *
 * The property dropdown reuses `useProperties` (features/properties/hooks) as-is
 * — no separate occupancy query here; `property.status` is kept accurate by
 * `finalizeKyc` itself (FR-PROP-05, written inside its transaction).
 */
export function StepContract({ draftId, onBeforeFinalize }) {
  const { t } = useTranslation()
  const {
    register,
    getValues,
    watch,
    setError,
    clearErrors,
    formState: { errors },
  } = useFormContext()

  const existingUserId = watch('existingUserId')
  const { data: existingUser } = useUserById(existingUserId)
  const { data: properties } = useProperties()

  const [isFinalizing, setIsFinalizing] = useState(false)
  const [result, setResult] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const classifiedError = classifyError(submitError)

  async function handleFinalize() {
    clearErrors()
    const validation = fullDraftSchema.safeParse(getValues())
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        setError(issue.path.join('.'), {
          type: 'manual',
          message: issue.message,
        })
      }
      return
    }

    setSubmitError(null)
    setIsFinalizing(true)
    try {
      // Step 4's OWN fields (propertyId, dates, rent...) are only ever in local
      // form state until now — nothing autosaves them on arrival at this step
      // (unlike Steps 1-3, which autosave on Continue). `finalizeKyc` reads the
      // draft as PERSISTED in Firestore, so without this, it always saw them
      // missing. Awaited: the write must complete before the server ever reads
      // the draft.
      await onBeforeFinalize?.()
      const finalizeKyc = httpsCallable(functions, 'finalizeKyc')
      const response = await finalizeKyc({ draftId })
      setResult(response.data)
    } catch (error) {
      setSubmitError(error)
    } finally {
      setIsFinalizing(false)
    }
  }

  function handleCopyPassword() {
    navigator.clipboard.writeText(result.password)
  }

  return (
    <div className="flex flex-col gap-4">
      {existingUserId && existingUser && (
        <p className="text-sm text-muted-foreground">
          {t('onboarding.stepContract.assigningTo', {
            name: existingUser.name,
            email: existingUser.email,
          })}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="propertyId">{t('onboarding.fields.propertyId')}</Label>
        <select
          id="propertyId"
          className={SELECT_CLASS}
          {...register('propertyId')}
        >
          <option value="">—</option>
          {properties?.map((property) => (
            <option
              key={property.id}
              value={property.id}
              disabled={property.status === 'occupied'}
            >
              {property.name}
              {property.status === 'occupied'
                ? ` ${t('onboarding.stepContract.propertyOccupiedOption')}`
                : ''}
            </option>
          ))}
        </select>
        <FieldError error={errors.propertyId} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="startDate">{t('onboarding.fields.startDate')}</Label>
        <Input id="startDate" type="date" {...register('startDate')} />
        <FieldError error={errors.startDate} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="endDate">{t('onboarding.fields.endDate')}</Label>
        <Input id="endDate" type="date" {...register('endDate')} />
        <FieldError error={errors.endDate} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="monthlyRent">
          {t('onboarding.fields.monthlyRent')}
        </Label>
        <Input
          id="monthlyRent"
          type="number"
          min="0"
          placeholder={t('onboarding.placeholders.rent')}
          {...register('monthlyRent', { valueAsNumber: true })}
        />
        <FieldError error={errors.monthlyRent} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="securityDeposit">
          {t('onboarding.fields.securityDeposit')}
          <span className="ml-1 font-normal text-muted-foreground">
            {t('onboarding.optional')}
          </span>
        </Label>
        <Input
          id="securityDeposit"
          type="number"
          min="0"
          placeholder={t('onboarding.placeholders.rent')}
          {...register('securityDeposit', { valueAsNumber: true })}
        />
        <FieldError error={errors.securityDeposit} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="dueDay">{t('onboarding.fields.dueDay')}</Label>
        <Input
          id="dueDay"
          type="number"
          min="1"
          max="31"
          {...register('dueDay', { valueAsNumber: true })}
        />
        <FieldError error={errors.dueDay} t={t} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="reportReminderDaysBefore">
          {t('onboarding.fields.reportReminderDaysBefore')}
        </Label>
        <Input
          id="reportReminderDaysBefore"
          type="number"
          min="1"
          {...register('reportReminderDaysBefore', { valueAsNumber: true })}
        />
        <FieldError error={errors.reportReminderDaysBefore} t={t} />
      </div>

      {(classifiedError?.kind === 'occupied' ||
        classifiedError?.kind === 'activeTenancy' ||
        classifiedError?.kind === 'generic') && (
        <p role="alert" className="text-sm text-destructive">
          {t(`onboarding.stepContract.errors.${classifiedError.kind}`)}
          {/* An UNEXPECTED (generic) error also shows the raw server text —
              intentionally NOT translated, NOT hidden behind a static message:
              a case we didn't anticipate is exactly when the admin (or Bogdan,
              debugging) needs to see what actually happened, not "try again". */}
          {classifiedError.kind === 'generic' &&
            (submitError?.details ? (
              <span className="mt-1 block font-mono text-xs opacity-80">
                {JSON.stringify(submitError.details)}
              </span>
            ) : submitError?.message ? (
              <span className="mt-1 block font-mono text-xs opacity-80">
                {submitError.message}
              </span>
            ) : null)}
        </p>
      )}

      <div>
        <Button type="button" onClick={handleFinalize} disabled={isFinalizing}>
          {isFinalizing
            ? t('common.loading')
            : t('onboarding.stepContract.finalize')}
        </Button>
      </div>

      <Dialog
        open={Boolean(result)}
        onOpenChange={(open) => !open && setResult(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {result?.accountCreated
                ? t('onboarding.stepContract.successNewTitle')
                : t('onboarding.stepContract.successExistingTitle', {
                    name: existingUser?.name,
                  })}
            </DialogTitle>
          </DialogHeader>
          {result?.accountCreated && (
            <div className="flex flex-col gap-2 text-sm">
              <p>{result.email}</p>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  {t('onboarding.stepContract.password')}:
                </span>
                <span className="font-mono">{result.password}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyPassword}
                >
                  {t('onboarding.stepContract.copyPassword')}
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button asChild variant="outline">
              <Link to="/admin/tenants">
                {t('onboarding.stepContract.goToTenants')}
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={classifiedError?.kind === 'cnp'}
        onOpenChange={(open) => !open && setSubmitError(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('onboarding.stepContract.cnpDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('onboarding.wizard.cnpConflict', {
                name: classifiedError?.conflictName,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild variant="outline">
              <Link to={`/admin/tenants/${classifiedError?.conflictUserId}`}>
                {t('onboarding.stepContract.viewProfile')}
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
