import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { RetryButton } from '@/components/shared/RetryButton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  EditableSection,
  Field,
  FieldError,
  Section,
} from '@/features/tenants/components/ProfileTab'
import { ContractUpload } from '@/features/tenants/components/ContractUpload'
import { DepositSettlementForm } from '@/features/tenants/components/DepositSettlementForm'
import { DepositSettlementView } from '@/components/shared/DepositSettlementView'
import { RecalculateBalanceControl } from '@/features/tenants/components/RecalculateBalanceControl'
import { formatCurrency } from '@/lib/formatCurrency'
import {
  useEndTenancy,
  useUpdateTenancy,
  useUserTenancies,
} from '@/features/tenants/hooks'
import { step4Schema } from '@/features/onboarding/schema'

/**
 * The Tenancy & contract tab (M3-C, SRS §5.3, FR-CON-01…09): the tenant's
 * active (or last) contract, its documents, "Extend", "End contract", and the
 * history of past tenancies (FR-TEN-15).
 *
 * `endDate` plus both reminder lead times — editable "at assignment or later"
 * (SRS §6, §5.3). Reused from `step4Schema` (onboarding/schema.js) via
 * `.pick()`, the SAME schema the onboarding wizard's step 4 validates, so the
 * two surfaces cannot drift: `reportReminderDaysBefore` stays unbounded
 * (FR-REP-15, one admin-facing email), `paymentReminderDaysBefore` stays
 * 1-10 (NFR-VAL-02 — it drives automated outbound volume at the tenant). No
 * new validation rule is declared here.
 *
 * `EditableSection` submits the whole picked schema, so a plain "Extend" now
 * writes `endDate` + both lead times back (unchanged values re-sent) — never
 * `currentBalance`/`closingBalance`, which `useUpdateTenancy`'s `updateDoc`
 * merge leaves untouched and NFR-SEC-12 would reject anyway.
 */
const tenancyContractSchema = step4Schema.pick({
  endDate: true,
  reportReminderDaysBefore: true,
  paymentReminderDaysBefore: true,
})

/** Which tenancy to show as "the contract": the active one if there is one,
 * otherwise the MOST RECENTLY ended one (SRS §5.3: "active/last contract") —
 * comparing `endDate` lexicographically works because it is always an ISO
 * `YYYY-MM-DD` string (same convention as every other date field here). */
function selectDisplayedTenancy(tenancies) {
  const active = tenancies.find((t) => t.status === 'active')
  if (active) return active

  const ended = tenancies.filter((t) => t.status === 'ended')
  if (ended.length === 0) return null
  return [...ended].sort((a, b) =>
    (b.endDate ?? '').localeCompare(a.endDate ?? ''),
  )[0]
}

/**
 * The closing-balance line shown before termination (FR-CON-04, reversed at
 * M8): "the screen states the closing balance plainly and requires an
 * explicit acknowledgement, then proceeds". Three states, never conflated —
 * NFR-VAL-03's money-is-never-exact discipline is moot here (this is a
 * three-way sign check, not an equality comparison against a computed
 * total), so a plain `> 0`/`< 0`/`=== 0` split is correct as written.
 */
function closingBalanceKey(currentBalance) {
  if (currentBalance > 0) return 'tenants.detail.tenancy.endBalanceOwed'
  if (currentBalance < 0) return 'tenants.detail.tenancy.endBalanceCredit'
  return 'tenants.detail.tenancy.endBalanceSettled'
}

/**
 * The deposit-settlement section (FR-CON-10/11/12, M8 stage 6) — a completely
 * separate action from "End contract" (Bogdan's explicit call): it appears
 * once the tenancy is ended, fillable whenever the administrator has
 * actually inspected the property. Toggles between the read-only view (once
 * a settlement exists) and the editable form — "Edit" reopens the form
 * pre-filled, since a settlement is a correctable record, not a one-shot.
 */
function DepositSettlementSection({ tenancy, userId }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const settlement = tenancy.depositSettlement

  if (settlement && !editing) {
    return (
      <div className="flex flex-col gap-2">
        <DepositSettlementView
          securityDeposit={tenancy.securityDeposit}
          depositSettlement={settlement}
        />
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
          >
            {t('tenants.detail.tenancy.settlement.editButton')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <DepositSettlementForm
      tenancy={tenancy}
      userId={userId}
      onDone={() => setEditing(false)}
      onCancel={settlement ? () => setEditing(false) : undefined}
    />
  )
}

function ContractSummary({ tenancy, userId, isActive }) {
  const { t } = useTranslation()
  const updateTenancy = useUpdateTenancy()
  const endTenancy = useEndTenancy()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [endError, setEndError] = useState(false)

  async function handleEnd() {
    setEndError(false)
    try {
      await endTenancy.mutateAsync({
        tenancyId: tenancy.id,
        userId,
        propertyId: tenancy.propertyId,
      })
      setConfirmOpen(false)
    } catch {
      setEndError(true)
    }
  }

  const currentBalance = tenancy.currentBalance ?? 0

  return (
    <>
      <EditableSection
        titleKey="tenants.detail.tenancy.title"
        schema={tenancyContractSchema}
        defaultValues={{
          endDate: tenancy.endDate ?? '',
          // Tolerate absence (CLAUDE.md §10.5): a tenancy created before the
          // M6/M8 fields, or restored from an older backup, may lack them.
          reportReminderDaysBefore: tenancy.reportReminderDaysBefore ?? 3,
          paymentReminderDaysBefore: tenancy.paymentReminderDaysBefore ?? 3,
        }}
        onSave={(values) =>
          updateTenancy.mutateAsync({ id: tenancy.id, userId, values })
        }
        renderView={() => (
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('tenants.detail.tenancy.property')}
              value={tenancy.property?.name}
            />
            <Field
              label={t('onboarding.fields.startDate')}
              value={tenancy.startDate}
            />
            <Field
              label={t('onboarding.fields.endDate')}
              value={tenancy.endDate}
            />
            <Field
              label={t('onboarding.fields.monthlyRent')}
              value={tenancy.monthlyRent}
            />
            <Field
              label={t('onboarding.fields.securityDeposit')}
              value={tenancy.securityDeposit}
            />
            <Field
              label={t('onboarding.fields.dueDay')}
              value={tenancy.dueDay}
            />
            <Field
              label={t('onboarding.fields.reportReminderDaysBefore')}
              value={tenancy.reportReminderDaysBefore}
            />
            <Field
              label={t('onboarding.fields.paymentReminderDaysBefore')}
              value={tenancy.paymentReminderDaysBefore}
            />
          </div>
        )}
        renderFields={({ register, errors, t: tt }) => (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="endDate">{tt('onboarding.fields.endDate')}</Label>
              <Input id="endDate" type="date" {...register('endDate')} />
              <FieldError error={errors.endDate} t={tt} />
            </div>

            {/* Mirrors the onboarding wizard step 4 field for field (SRS §5.2
                step 4) — same labels, same helper text, same order, same
                validation. The report field is admin-facing (preparing the
                list, FR-REP-15) and unbounded; the payment field is
                tenant-facing (paying the bill, FR-PAY-10) and 1-10. */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="reportReminderDaysBefore">
                {tt('onboarding.fields.reportReminderDaysBefore')}
              </Label>
              <Input
                id="reportReminderDaysBefore"
                type="number"
                min="1"
                {...register('reportReminderDaysBefore', {
                  valueAsNumber: true,
                })}
              />
              <FieldError error={errors.reportReminderDaysBefore} t={tt} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="paymentReminderDaysBefore">
                {tt('onboarding.fields.paymentReminderDaysBefore')}
              </Label>
              <Input
                id="paymentReminderDaysBefore"
                type="number"
                min="1"
                max="10"
                {...register('paymentReminderDaysBefore', {
                  valueAsNumber: true,
                })}
              />
              <p className="text-xs text-muted-foreground">
                {tt('onboarding.fields.paymentReminderDaysBeforeHelp')}
              </p>
              <FieldError error={errors.paymentReminderDaysBefore} t={tt} />
            </div>
          </div>
        )}
      />

      <Section title={t('tenants.detail.balance.title')}>
        <RecalculateBalanceControl tenancy={tenancy} userId={userId} />
      </Section>

      {isActive ? (
        <Section title={t('tenants.detail.tenancy.endTitle')}>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            {t('tenants.detail.tenancy.endButton')}
          </Button>
        </Section>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t('tenants.detail.tenancy.notActiveNotice')}
          </p>
          <DepositSettlementSection tenancy={tenancy} userId={userId} />
        </>
      )}

      <Section title={t('tenants.detail.tenancy.documentsTitle')}>
        <ContractUpload
          tenancyId={tenancy.id}
          userId={userId}
          documents={tenancy.attachedDocuments ?? []}
        />
      </Section>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open)
          if (open) {
            setEndError(false)
            setAcknowledged(false)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('tenants.detail.tenancy.endConfirmTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('tenants.detail.tenancy.endConfirmBody')}
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm font-medium text-foreground">
            {t(closingBalanceKey(currentBalance), {
              balance: formatCurrency(Math.abs(currentBalance)),
            })}
          </p>

          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5"
            />
            {t('tenants.detail.tenancy.endAcknowledge')}
          </label>

          {endError && (
            <p role="alert" className="text-sm text-destructive">
              {t('tenants.detail.tenancy.endGenericError')}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleEnd}
              disabled={endTenancy.isPending || !acknowledged}
            >
              {endTenancy.isPending
                ? t('common.loading')
                : t('tenants.detail.tenancy.endConfirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function TenancyTab({ userId }) {
  const { t } = useTranslation()
  const {
    data: tenancies,
    isPending,
    isError,
    isFetching,
    refetch,
  } = useUserTenancies(userId)

  if (isPending) {
    return (
      <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }
  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">
          {t('tenants.detail.saveError')}
        </p>
        <RetryButton onRetry={refetch} disabled={isFetching} />
      </div>
    )
  }

  const displayed = selectDisplayedTenancy(tenancies)
  const history = tenancies.filter(
    (item) => item.status === 'ended' && item.id !== displayed?.id,
  )

  return (
    <div className="flex flex-col gap-6">
      {!displayed && (
        <p className="text-sm text-muted-foreground">
          {t('tenants.detail.tenancy.none')}
        </p>
      )}

      {displayed && (
        <ContractSummary
          tenancy={displayed}
          userId={userId}
          isActive={displayed.status === 'active'}
        />
      )}

      {history.length > 0 && (
        <Section title={t('tenants.detail.tenancy.historyTitle')}>
          <ul className="flex flex-col gap-2">
            {history.map((item) => (
              <li key={item.id} className="text-sm text-muted-foreground">
                {t('tenants.detail.tenancy.historyItem', {
                  property: item.property?.name,
                  startDate: item.startDate,
                  endDate: item.endDate,
                })}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
