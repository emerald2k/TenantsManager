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

/**
 * A confirmation dialog, shared by both destructive actions in sub-stage D:
 * removing a service (FR-PROP-02) and archiving (FR-PROP-06).
 *
 * CONTROLLED (`open` + `onOpenChange`), not trigger-driven: the caller opens it for
 * a specific target — the service to remove — and needs to know WHICH one. A
 * self-contained trigger would force one dialog instance per service row.
 *
 * It takes i18n KEYS, not text, for the same reason the schema does: translating
 * at the call site would freeze the language when the component is defined.
 *
 * @param titleKey        the dialog title
 * @param descriptionKey  what exactly is about to happen (the target's name goes
 *                        through `descriptionValues`, i18next-interpolated)
 * @param confirmKey      the label of the confirm button
 * @param onConfirm       fired on confirm; the caller closes the dialog
 * @param destructive     styles confirm as destructive (default: true — both of D's
 *                        uses are destructive)
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  titleKey,
  descriptionKey,
  descriptionValues,
  confirmKey,
  onConfirm,
  destructive = true,
  isPending = false,
}) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(titleKey)}</DialogTitle>
          {descriptionKey && (
            <DialogDescription>
              {t(descriptionKey, descriptionValues)}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? t('common.loading') : t(confirmKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
