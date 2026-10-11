import { describe, expect, it } from 'vitest';
import { allKeys, isRTL, t, type Lang } from '../src/i18n';

describe('i18n dictionary parity', () => {
  const keys = allKeys();
  it('has a non-trivial key set', () => {
    expect(keys.length).toBeGreaterThan(40);
  });

  it.each(['ar', 'en'] as Lang[])('every key resolves to a non-empty string in %s', (lang) => {
    for (const k of keys) {
      const v = t(lang, k);
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('spot-checks critical keys', () => {
    expect(t('ar', 'auth.loginButton')).toBe('تسجيل الدخول');
    expect(t('en', 'auth.loginButton')).toBe('Sign in');
    expect(t('ar', 'msg.documented')).toBe('معرفة موثقة');
    expect(t('en', 'msg.documented')).toBe('Documented knowledge');
  });
});

describe('direction', () => {
  it('arabic is RTL, english is LTR', () => {
    expect(isRTL('ar')).toBe(true);
    expect(isRTL('en')).toBe(false);
  });
});
