import { describe, expect, it } from 'vitest';
import { registerCatalogue, translate } from './index.js';

/**
 * Pluralisation, which is the part of a catalogue that cannot be retrofitted.
 *
 * English hides the problem behind two forms. Arabic has six, and this product
 * is sold into Doha — so the selection has to come from the locale's own rules
 * rather than from `count === 1 ? a : b` written at a call site.
 */

describe('interpolation', () => {
  it('fills placeholders', () => {
    expect(translate('home.greeting', { name: 'Meera' })).toBe('Good morning, Meera');
  });

  it('leaves an unknown placeholder alone rather than printing undefined', () => {
    expect(translate('home.greeting', {})).toContain('{name}');
  });

  it('falls back to the key, which greps cleanly', () => {
    expect(translate('nope.not.a.key' as never)).toBe('nope.not.a.key');
  });
});

describe('plurals', () => {
  it('uses the singular variant for one', () => {
    expect(translate('attendance.saved_notify', { count: 1 })).toBe(
      'One guardian would be notified of an absence.',
    );
  });

  it('uses the general form for anything else', () => {
    expect(translate('attendance.saved_notify', { count: 3 })).toBe(
      '3 guardians would be notified of an absence.',
    );
    expect(translate('attendance.saved_notify', { count: 0 })).toBe(
      '0 guardians would be notified of an absence.',
    );
  });

  it('needs no variants for a message that does not care', () => {
    expect(translate('home.registers.expected', { count: 6 })).toBe('of 6 expected');
  });

  it('selects by the locale rules, not by count === 1', () => {
    // Welsh distinguishes zero, one, two, few, many and other. If selection
    // were hard-coded to "one vs other" this could not be expressed at all.
    registerCatalogue('cy', {
      'home.fees.overdue_count': '{count} anfoneb yn hwyr',
      'home.fees.overdue_count.one': 'Un anfoneb yn hwyr',
      'home.fees.overdue_count.zero': 'Dim anfonebau yn hwyr',
    } as never);

    expect(translate('home.fees.overdue_count', { count: 1 }, 'cy')).toBe('Un anfoneb yn hwyr');
    expect(translate('home.fees.overdue_count', { count: 0 }, 'cy')).toBe('Dim anfonebau yn hwyr');
    expect(translate('home.fees.overdue_count', { count: 5 }, 'cy')).toBe('5 anfoneb yn hwyr');
  });

  it('falls back to English variants for a partial translation', () => {
    registerCatalogue('fr', { 'home.greeting': 'Bonjour, {name}' } as never);
    expect(translate('attendance.saved_notify', { count: 1 }, 'fr')).toBe(
      'One guardian would be notified of an absence.',
    );
  });

  it('survives a nonsense locale rather than throwing at a parent', () => {
    expect(translate('attendance.saved_notify', { count: 1 }, 'not-a-locale')).toContain(
      'One guardian',
    );
  });
});
