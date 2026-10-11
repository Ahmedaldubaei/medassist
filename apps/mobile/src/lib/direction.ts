/**
 * Applies RTL/LTR direction for the chosen language.
 * Native: I18nManager.forceRTL (takes effect after reload).
 * Web: sets document.documentElement.dir immediately.
 */
import { I18nManager, Platform } from 'react-native';
import type { Lang } from '../i18n';
import { isRTL } from '../i18n';

export function currentDirection(): 'rtl' | 'ltr' {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    return document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
  }
  return I18nManager.isRTL ? 'rtl' : 'ltr';
}

export function applyDirection(lang: Lang): void {
  const rtl = isRTL(lang);
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    return;
  }
  if (I18nManager.isRTL !== rtl) {
    I18nManager.forceRTL(rtl);
  }
}
