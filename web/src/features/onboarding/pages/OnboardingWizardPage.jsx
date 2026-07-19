import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useDraft, useUpdateDraft } from '@/features/onboarding/hooks'
import {
  draftFormDefaults,
  step1Schema,
  step2Schema,
  step3Schema,
} from '@/features/onboarding/schema'
import { StepPersonal } from '@/features/onboarding/components/StepPersonal'
import { StepFinancial } from '@/features/onboarding/components/StepFinancial'
import { PhotoCapture } from '@/features/onboarding/components/PhotoCapture'

const STEP_KEYS = ['personal', 'documents', 'financial', 'contract']

// Step 4 is still a placeholder (Sub-stage E) — Continue passes through it
// unvalidated until its real content lands.
const STEP_SCHEMAS = { 1: step1Schema, 2: step2Schema, 3: step3Schema }

/**
 * The onboarding wizard shell (FR-TEN-01…08, SRS §5.1/§5.3, `/admin/onboarding/:draftId`).
 *
 * ONE form instance (`useForm` + `FormProvider`) spans all 4 steps — the URL never
 * changes between steps (SRS §5.1), only `currentStep` (internal state) does, kept
 * in sync with the draft's own `currentStep` (FR-TEN-17, for resuming). Autosave
 * (`useUpdateDraft`) fires on every Back/Continue/Save-and-close, not on a timer or
 * per-keystroke — exactly the moments the admin is about to leave the current step.
 *
 * Per-step validation is MANUAL, not RHF's `resolver`: a single resolver spanning
 * all 4 steps cannot express "only THIS step's fields must be complete right now"
 * without also demanding step 2/4 data before it exists. `validateStep` instead
 * parses the current step's own schema against `getValues()` and turns Zod issues
 * into `setError` calls — same i18n-key error messages the schema already returns.
 */
export function OnboardingWizardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { draftId } = useParams()
  const { data: draft, isPending: draftPending } = useDraft(draftId)
  const updateDraft = useUpdateDraft()

  const [currentStep, setCurrentStep] = useState(1)
  const [cnpConflict, setCnpConflict] = useState(false)

  const methods = useForm({ defaultValues: draftFormDefaults, mode: 'onBlur' })
  const { getValues, reset, setError, clearErrors } = methods

  // Resume (FR-TEN-17): once the draft loads, the form and the step indicator sync
  // to it. Runs only when `draft` itself changes — not on every render.
  useEffect(() => {
    if (!draft) return
    reset({ ...draftFormDefaults, ...draft })
    setCurrentStep(draft.currentStep ?? 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  function validateStep(step) {
    const schema = STEP_SCHEMAS[step]
    if (!schema) return true
    clearErrors()
    const result = schema.safeParse(getValues())
    if (result.success) return true
    for (const issue of result.error.issues) {
      setError(issue.path.join('.'), { type: 'manual', message: issue.message })
    }
    return false
  }

  function autosave(nextStep) {
    updateDraft.mutate({
      id: draftId,
      values: getValues(),
      currentStep: nextStep,
    })
  }

  function handleBack() {
    if (currentStep <= 1) return
    const prev = currentStep - 1
    autosave(prev)
    setCurrentStep(prev)
  }

  function handleContinue() {
    if (cnpConflict) return
    if (!validateStep(currentStep)) return
    if (currentStep >= 4) return
    const next = currentStep + 1
    autosave(next)
    setCurrentStep(next)
  }

  function handleSaveAndClose() {
    autosave(currentStep)
    navigate('/admin/tenants')
  }

  if (draftPending) {
    return (
      <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  return (
    <FormProvider {...methods}>
      <div className="flex flex-col gap-6 p-6">
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {STEP_KEYS.map((key, index) => {
            const step = index + 1
            return (
              <li
                key={key}
                aria-current={step === currentStep ? 'step' : undefined}
                className={`rounded-full px-3 py-1 ${
                  step === currentStep
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground'
                }`}
              >
                {step}. {t(`onboarding.steps.${key}`)}
              </li>
            )
          })}
        </ol>

        <div>
          {currentStep === 1 && (
            <StepPersonal onCnpConflictChange={setCnpConflict} />
          )}
          {currentStep === 2 && (
            <PhotoCapture
              draftId={draftId}
              fieldPath="idDocumentPhotos"
              required
            />
          )}
          {currentStep === 3 && <StepFinancial draftId={draftId} />}
          {currentStep === 4 && (
            <p className="text-sm text-muted-foreground">
              {t('onboarding.wizard.stepComingSoon', { stage: 'E' })}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1}
          >
            {t('onboarding.wizard.back')}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleSaveAndClose}
            >
              {t('onboarding.wizard.saveAndClose')}
            </Button>
            {currentStep < 4 && (
              <Button
                type="button"
                onClick={handleContinue}
                disabled={cnpConflict}
              >
                {t('onboarding.wizard.continue')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </FormProvider>
  )
}
