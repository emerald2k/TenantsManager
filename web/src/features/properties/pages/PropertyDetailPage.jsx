import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { PropertyForm } from '@/features/properties/components/PropertyForm'
import { AddServiceDialog } from '@/features/properties/components/AddServiceDialog'
import {
  SERVICE_CATALOG,
  SERVICE_SOURCE,
} from '@/features/properties/serviceCatalog'
import {
  useActiveTenancyForProperty,
  useAddService,
  useArchiveProperty,
  useProperty,
  useRemoveService,
  useUpdateProperty,
} from '@/features/properties/hooks'
import { computeDaysUntilDueDay } from '@/features/properties/dueDayCountdown'

/**
 * Property detail (SRS §5.3): Data, Services, Archiving, plus the cost-history
 * placeholder. Covers FR-PROP-01, FR-PROP-02, FR-PROP-04, FR-PROP-06.
 *
 * The mutations live in `../hooks` (sub-stage B) and the fields in
 * `../components/PropertyForm` (shared with creation). This page only orchestrates:
 * which section is in edit mode, which dialog is open, which service is targeted.
 *
 * The cost-history table (SRS §5.3 section 3) arrives at M6, together with the
 * monthly reports it reads — an empty state is the honest placeholder until then.
 */

const CATALOG_BY_ID = new Map(
  SERVICE_CATALOG.map((entry) => [entry.serviceId, entry]),
)

/**
 * A catalog service is DISPLAYED through its i18n key, not through the stored
 * `name`: the stored name is a snapshot for reports (FR-PROP-08), and showing it
 * would freeze the list in whatever language it was added. A custom service has no
 * key — its name IS the content, so it shows as stored.
 */
function serviceLabel(service, t) {
  const entry = CATALOG_BY_ID.get(service.serviceId)
  return service.source === SERVICE_SOURCE.CATALOG && entry
    ? t(entry.labelKey)
    : service.name
}

/** Firestore omits absent optional fields, and RHF needs every field defined —
 * an undefined value would flip the input from controlled to uncontrolled. */
function toFormValues(property) {
  return {
    name: property.name ?? '',
    address: {
      street: property.address?.street ?? '',
      number: property.address?.number ?? '',
      city: property.address?.city ?? '',
      county: property.address?.county ?? '',
      postalCode: property.address?.postalCode ?? '',
    },
    area: property.area ?? '',
    roomCount: property.roomCount ?? '',
  }
}

function Section({ title, action, children }) {
  return (
    <section className="rounded-lg border border-border p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Field({ label, value }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value || '—'}</span>
    </div>
  )
}

export function PropertyDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams()

  const { data: property, isPending, isError } = useProperty(id)
  // FR-PROP-06/11: archiving is blocked, and the due-day countdown is shown, only
  // while occupied. The active-tenancy read is skipped entirely for a free
  // property (hooks stay unconditional — only the ARGUMENT is; React's rule is
  // about call order, not about what's passed in).
  const isOccupied = property?.status === 'occupied'
  const { data: activeTenancy } = useActiveTenancyForProperty(
    isOccupied ? id : undefined,
  )
  const updateProperty = useUpdateProperty()
  const addService = useAddService()
  const removeService = useRemoveService()
  const archiveProperty = useArchiveProperty()

  const [isEditing, setIsEditing] = useState(false)
  const [isAddServiceOpen, setAddServiceOpen] = useState(false)
  // Holds the service being removed — the dialog is shared across rows, so it
  // needs to know WHICH one. `null` means closed.
  const [serviceToRemove, setServiceToRemove] = useState(null)
  const [isArchiveOpen, setArchiveOpen] = useState(false)

  if (isPending) {
    return (
      <p className="p-6 text-sm text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (isError || !property) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {t('properties.detail.notFound')}
      </p>
    )
  }

  const services = property.services ?? []
  // FR-PROP-11: null while the active tenancy hasn't loaded yet, or its dueDay is
  // not a usable positive integer (computeDaysUntilDueDay itself decides that).
  const daysUntilDue = activeTenancy?.dueDay
    ? computeDaysUntilDueDay(activeTenancy.dueDay)
    : null

  async function handleUpdate(values) {
    // Throwing propagates to PropertyForm, which shows the error and KEEPS edit
    // mode open — closing it would discard what the user typed.
    await updateProperty.mutateAsync({ id, values })
    setIsEditing(false)
  }

  function handleAddService(service) {
    addService.mutate({ propertyId: id, service })
  }

  function handleRemoveService() {
    // The stored element, passed through untouched: `arrayRemove` matches by
    // exact value, so a rebuilt object would silently remove nothing.
    removeService.mutate({ propertyId: id, service: serviceToRemove })
    setServiceToRemove(null)
  }

  function handleArchive() {
    archiveProperty.mutate(id)
    setArchiveOpen(false)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          {property.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(
            `properties.status.${property.archived ? 'archived' : property.status}`,
          )}
          {isOccupied && daysUntilDue !== null && (
            <>
              {' · '}
              {t('properties.detail.dueDay')}: {activeTenancy.dueDay} (
              {t('properties.detail.daysUntilDue', { count: daysUntilDue })})
            </>
          )}
        </p>
      </div>

      <Section
        title={t('properties.detail.dataTitle')}
        action={
          !isEditing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditing(true)}
            >
              {t('properties.detail.edit')}
            </Button>
          )
        }
      >
        {isEditing ? (
          <PropertyForm
            defaultValues={toFormValues(property)}
            onSubmit={handleUpdate}
            submitLabelKey="properties.detail.save"
            errorKey="properties.detail.saveError"
            isPending={updateProperty.isPending}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('properties.fields.name')} value={property.name} />
            <Field
              label={t('properties.fields.street')}
              value={property.address?.street}
            />
            <Field
              label={t('properties.fields.number')}
              value={property.address?.number}
            />
            <Field
              label={t('properties.fields.city')}
              value={property.address?.city}
            />
            <Field
              label={t('properties.fields.county')}
              value={property.address?.county}
            />
            <Field
              label={`${t('properties.fields.postalCode')} ${t('properties.new.optional')}`}
              value={property.address?.postalCode}
            />
            <Field
              label={`${t('properties.fields.area')} ${t('properties.new.optional')}`}
              value={property.area}
            />
            <Field
              label={`${t('properties.fields.roomCount')} ${t('properties.new.optional')}`}
              value={property.roomCount}
            />
          </div>
        )}
      </Section>

      <Section
        title={t('properties.detail.servicesTitle')}
        action={
          <Button type="button" onClick={() => setAddServiceOpen(true)}>
            {t('properties.services.add')}
          </Button>
        }
      >
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('properties.services.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {services.map((service) => (
              <li
                key={service.serviceId}
                className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2"
              >
                <span className="text-sm text-foreground">
                  {serviceLabel(service, t)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setServiceToRemove(service)}
                >
                  {t('properties.services.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('properties.detail.archiveTitle')}>
        {property.archived ? (
          <p className="text-sm text-muted-foreground">
            {t('properties.archive.already')}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {t('properties.archive.description')}
            </p>
            {isOccupied && (
              <p className="text-sm text-destructive">
                {t('properties.archive.blockedOccupied')}
              </p>
            )}
            <div>
              <Button
                type="button"
                variant="destructive"
                disabled={isOccupied}
                onClick={() => setArchiveOpen(true)}
              >
                {t('properties.archive.action')}
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title={t('properties.detail.historyTitle')}>
        <p className="text-sm text-muted-foreground">
          {t('properties.detail.historyEmpty')}
        </p>
      </Section>

      <AddServiceDialog
        open={isAddServiceOpen}
        onOpenChange={setAddServiceOpen}
        existing={services}
        onAdd={handleAddService}
      />

      <ConfirmDialog
        open={serviceToRemove !== null}
        onOpenChange={(open) => !open && setServiceToRemove(null)}
        titleKey="properties.services.removeTitle"
        descriptionKey="properties.services.removeConfirm"
        descriptionValues={
          serviceToRemove ? { name: serviceLabel(serviceToRemove, t) } : {}
        }
        confirmKey="properties.services.remove"
        onConfirm={handleRemoveService}
        isPending={removeService.isPending}
      />

      <ConfirmDialog
        open={isArchiveOpen}
        onOpenChange={setArchiveOpen}
        titleKey="properties.archive.confirmTitle"
        descriptionKey="properties.archive.confirmDescription"
        confirmKey="properties.archive.action"
        onConfirm={handleArchive}
        isPending={archiveProperty.isPending}
      />
    </div>
  )
}
