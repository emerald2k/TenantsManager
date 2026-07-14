import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ro from './locales/ro.json'
import en from './locales/en.json'

export const LANGUAGE_STORAGE_KEY = 'tm_lang'
export const SUPPORTED_LANGUAGES = ['ro', 'en']
const DEFAULT_LANGUAGE = 'ro'

function getStoredLanguage() {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return SUPPORTED_LANGUAGES.includes(stored) ? stored : DEFAULT_LANGUAGE
}

i18n.use(initReactI18next).init({
  resources: {
    ro: { translation: ro },
    en: { translation: en },
  },
  lng: getStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
