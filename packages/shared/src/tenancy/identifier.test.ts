import { describe, expect, it } from 'vitest';
import { buildIdentifier, parseLoginIdentifier } from './identifier.js';

describe('parseLoginIdentifier', () => {
  it('reads the school from the suffix on the shared sign-in', () => {
    expect(parseLoginIdentifier('sunita@modelschool', null)).toEqual({
      username: 'sunita',
      schoolSlug: 'modelschool',
      identifier: 'sunita@modelschool',
    });
  });

  it('requires a suffix on the shared sign-in', () => {
    // Nothing else says which school, so a bare name is not a login.
    expect(parseLoginIdentifier('sunita', null)).toBeNull();
  });

  it('lets a bare username through on the school subdomain', () => {
    expect(parseLoginIdentifier('sunita', 'modelschool')?.identifier).toBe('sunita@modelschool');
  });

  it('accepts the full form on the subdomain too', () => {
    expect(parseLoginIdentifier('sunita@modelschool', 'modelschool')?.schoolSlug).toBe('modelschool');
  });

  it('refuses a suffix that disagrees with the hostname', () => {
    // The host always wins. A typed suffix must never reach another tenant.
    expect(parseLoginIdentifier('admin@greenhill', 'modelschool')).toBeNull();
  });

  it('normalises case and whitespace', () => {
    expect(parseLoginIdentifier('  Sunita@ModelSchool  ', null)?.identifier).toBe('sunita@modelschool');
  });

  it('refuses malformed input', () => {
    for (const bad of ['', '@modelschool', 'sunita@', 'sun ita@modelschool', '@', 'a@b@c']) {
      expect(parseLoginIdentifier(bad, null), bad).toBeNull();
    }
  });

  it('refuses a suffix that could not be a school', () => {
    expect(parseLoginIdentifier('sunita@-bad', null)).toBeNull();
  });

  it('builds the stored form', () => {
    expect(buildIdentifier('Sunita', 'ModelSchool')).toBe('sunita@modelschool');
  });
});
