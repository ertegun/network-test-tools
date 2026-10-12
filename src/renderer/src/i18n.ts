// Tüm arayüz metinleri dil başına JSON dosyalarındadır. Yeni dil = yeni JSON + buraya kayıt.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import tr from './locales/tr.json';

export const LANGUAGES = { tr, en } as const;
export type Lang = keyof typeof LANGUAGES;

export function resolveLanguage(pref: string, systemLocale: string): Lang {
  const candidate = (pref === 'system' ? systemLocale : pref).toLowerCase().split(/[-_]/)[0];
  return candidate in LANGUAGES ? (candidate as Lang) : 'en';
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(Object.entries(LANGUAGES).map(([k, v]) => [k, { translation: v }])),
  lng: 'en',
  // Eksik çeviri İngilizce gösterilir.
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
