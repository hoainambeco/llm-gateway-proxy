import type { Translations } from '../i18n/types';
import { en } from '../i18n/locales/en';
import { vi } from '../i18n/locales/vi';

function flattenKeys(prefix: string, tree: unknown, into: Map<string, unknown>): void {
  if (tree === null || tree === undefined) {
    into.set(prefix, tree);
    return;
  }
  if (typeof tree !== 'object' || Array.isArray(tree)) {
    into.set(prefix, tree);
    return;
  }
  const record = tree as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    into.set(prefix, tree);
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    flattenKeys(prefix ? `${prefix}.${key}` : key, value, into);
  }
}

function flattenTranslations(source: Translations): Map<string, unknown> {
  const flattened = new Map<string, unknown>();
  flattenKeys('', source, flattened);
  return flattened;
}

describe('en/vi locale parity', () => {
  const enKeys = flattenTranslations(en);
  const viKeys = flattenTranslations(vi);

  it('defines exactly the same set of keys in both locales', () => {
    const enOnly = [...enKeys.keys()].filter((key) => !viKeys.has(key));
    const viOnly = [...viKeys.keys()].filter((key) => !enKeys.has(key));

    expect(enOnly).toEqual([]);
    expect(viOnly).toEqual([]);
  });

  it('has no empty translation value in either locale', () => {
    for (const [localeKeys, localeName] of [
      [enKeys, 'en'],
      [viKeys, 'vi'],
    ] as const) {
      // Prefix each offender with its locale so a failure names both the
      // locale and the diverging key.
      const emptyKeys = [...localeKeys.entries()]
        .filter(([, value]) => typeof value === 'string' && value.trim() === '')
        .map(([key]) => `${localeName}.${key}`);
      expect(emptyKeys).toEqual([]);
    }
  });

  it('keeps the identification of the English keys stable', () => {
    expect(enKeys.size).toBeGreaterThan(0);
    expect(viKeys.size).toBe(enKeys.size);
  });
});
