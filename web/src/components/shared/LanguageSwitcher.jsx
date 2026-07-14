import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from '@/lib/i18n'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()

  function handleChange(lang) {
    i18n.changeLanguage(lang)
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">
        {t('common.language')}:
      </span>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <Button
          key={lang}
          type="button"
          size="sm"
          variant={i18n.resolvedLanguage === lang ? 'default' : 'outline'}
          onClick={() => handleChange(lang)}
        >
          {lang.toUpperCase()}
        </Button>
      ))}
    </div>
  )
}
