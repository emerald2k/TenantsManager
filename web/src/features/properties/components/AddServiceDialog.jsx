import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  SERVICE_CATALOG,
  SERVICE_SOURCE,
} from '@/features/properties/serviceCatalog'

/**
 * "Add service" (FR-PROP-02): the predefined catalog + a custom service.
 *
 * Both paths produce the SAME shape — `{ serviceId, name, source }` (SRS §6) — and
 * hand it to the caller. The dialog does not know the mutation; the page owns it.
 *
 * `name` is a SNAPSHOT, deliberately (FR-PROP-08): it is what published reports
 * will carry. For catalog services the DISPLAY re-translates through `labelKey`
 * (see the detail page), so the stored snapshot never freezes the interface
 * language — it only freezes what a report recorded.
 *
 * Catalog entries already on the property are hidden: `arrayUnion` de-duplicates
 * only byte-identical objects, so the same service added under two languages would
 * land twice.
 */
export function AddServiceDialog({ open, onOpenChange, existing = [], onAdd }) {
  const { t } = useTranslation()
  const [customName, setCustomName] = useState('')

  const taken = new Set(existing.map((service) => service.serviceId))
  const available = SERVICE_CATALOG.filter(
    (entry) => !taken.has(entry.serviceId),
  )

  function addFromCatalog(entry) {
    onAdd({
      serviceId: entry.serviceId,
      name: t(entry.labelKey),
      source: SERVICE_SOURCE.CATALOG,
    })
    onOpenChange(false)
  }

  function addCustom() {
    const name = customName.trim()
    // Presence-only, like the schema (NFR-VAL-01): a blank name is not a service.
    if (!name) return
    onAdd({
      // A custom service has no natural id. A random one keeps two services with
      // the same name distinct — and removal stays correct regardless, because
      // `useRemoveService` matches the STORED element, not a rebuilt one.
      serviceId: crypto.randomUUID(),
      name,
      source: SERVICE_SOURCE.CUSTOM,
    })
    setCustomName('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('properties.services.addTitle')}</DialogTitle>
          <DialogDescription>
            {t('properties.services.addDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">
            {t('properties.services.catalog')}
          </p>
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('properties.services.allAdded')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((entry) => (
                <Button
                  key={entry.serviceId}
                  type="button"
                  variant="outline"
                  onClick={() => addFromCatalog(entry)}
                >
                  {t(entry.labelKey)}
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <Label htmlFor="customService">
            {t('properties.services.custom')}
          </Label>
          <div className="flex gap-2">
            <Input
              id="customService"
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              placeholder={t('properties.services.customPlaceholder')}
            />
            <Button
              type="button"
              onClick={addCustom}
              disabled={!customName.trim()}
            >
              {t('properties.services.addCustom')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
