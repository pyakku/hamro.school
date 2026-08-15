import { describe, expect, it } from 'vitest';
import { isSchoolSlugAvailable, schoolSlugFromHost, schoolUrl } from './index.js';

const opts = { baseDomain: 'hamro.school' };

describe('schoolSlugFromHost', () => {
  it('reads the school from its own subdomain', () => {
    expect(schoolSlugFromHost('stmarys.hamro.school', opts)).toBe('stmarys');
    expect(schoolSlugFromHost('green-hill.hamro.school:443', opts)).toBe('green-hill');
    expect(schoolSlugFromHost('StMarys.Hamro.School', opts)).toBe('stmarys');
  });

  it('returns null for the shared sign-in and the apex', () => {
    // Null means "ask which school", not "reject".
    expect(schoolSlugFromHost('app.hamro.school', opts)).toBeNull();
    expect(schoolSlugFromHost('hamro.school', opts)).toBeNull();
    expect(schoolSlugFromHost('www.hamro.school', opts)).toBeNull();
  });

  it('refuses a hostname that is not ours', () => {
    // The obvious impersonation: a domain that merely ends with our name.
    expect(schoolSlugFromHost('stmarys.hamro.school.evil.com', opts)).toBeNull();
    expect(schoolSlugFromHost('nothamro.school', opts)).toBeNull();
    expect(schoolSlugFromHost('evil.com', opts)).toBeNull();
  });

  it('refuses a nested label', () => {
    expect(schoolSlugFromHost('a.b.hamro.school', opts)).toBeNull();
  });

  it('refuses infrastructure names a school must not claim', () => {
    for (const name of ['api', 'admin', 'mail', 'internal', 'auth']) {
      expect(schoolSlugFromHost(`${name}.hamro.school`, opts), name).toBeNull();
      expect(isSchoolSlugAvailable(name), name).toBe(false);
    }
  });

  it('refuses malformed labels', () => {
    for (const bad of ['-lead.hamro.school', 'trail-.hamro.school', 'a.hamro.school', '.hamro.school']) {
      expect(schoolSlugFromHost(bad, opts), bad).toBeNull();
    }
  });

  it('handles nothing at all', () => {
    expect(schoolSlugFromHost(undefined, opts)).toBeNull();
    expect(schoolSlugFromHost('', opts)).toBeNull();
  });

  it('builds the address a school is told to use', () => {
    expect(schoolUrl('stmarys', 'hamro.school')).toBe('https://stmarys.hamro.school');
  });
});
