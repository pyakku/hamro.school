import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  ROLES,
  ROLE_GRANTS,
  can,
  permissionsFor,
  resolveScope,
  type Permission,
} from './index.js';

describe('permission matrix', () => {
  it('grants every permission to exactly one scope per role', () => {
    for (const role of ROLES) {
      const seen = new Set<Permission>();
      for (const grant of ROLE_GRANTS[role]) {
        expect(seen.has(grant.permission), `${role} grants ${grant.permission} twice`).toBe(false);
        seen.add(grant.permission);
      }
    }
  });

  it('only references permissions that exist', () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ROLES) {
      for (const grant of ROLE_GRANTS[role]) {
        expect(known.has(grant.permission)).toBe(true);
      }
    }
  });

  it('lets every role register a device for push', () => {
    for (const role of ROLES) {
      expect(can([role], 'device:register'), role).toBe(true);
    }
  });
});

/**
 * The boundary the schools ask about. Accounts handles money and must not see
 * anything academic. If someone adds `mark:read` to ACCOUNTS, this fails.
 */
describe('accounts never sees academic records', () => {
  const forbidden: Permission[] = [
    'mark:read',
    'mark:write',
    'mark:publish',
    'report_card:read',
    'report_card:publish',
    'exam:write',
    'homework:read',
    'homework:write',
    'attendance:write',
  ];

  for (const permission of forbidden) {
    it(`denies ${permission}`, () => {
      expect(can(['ACCOUNTS'], permission)).toBe(false);
    });
  }

  it('still sees the ledger', () => {
    expect(resolveScope(['ACCOUNTS'], 'invoice:read')).toBe('ALL');
    expect(resolveScope(['ACCOUNTS'], 'payment:record')).toBe('ALL');
    expect(resolveScope(['ACCOUNTS'], 'student:read')).toBe('ALL');
  });
});

describe('teachers are confined to their own classes', () => {
  it('writes attendance and marks only for their own sections', () => {
    expect(resolveScope(['TEACHER'], 'attendance:write')).toBe('OWN_SECTIONS');
    expect(resolveScope(['TEACHER'], 'mark:write')).toBe('OWN_SECTIONS');
    expect(resolveScope(['TEACHER'], 'student:read')).toBe('OWN_SECTIONS');
  });

  it('cannot amend a locked attendance day', () => {
    expect(can(['TEACHER'], 'attendance:amend')).toBe(false);
    expect(can(['SCHOOL_ADMIN'], 'attendance:amend')).toBe(true);
  });

  it('cannot publish marks or touch money', () => {
    expect(can(['TEACHER'], 'mark:publish')).toBe(false);
    expect(can(['TEACHER'], 'invoice:read')).toBe(false);
    expect(can(['TEACHER'], 'payment:record')).toBe(false);
  });

  it('cannot change the grading scale it is marked against', () => {
    expect(can(['TEACHER'], 'grading_scale:read')).toBe(true);
    expect(can(['TEACHER'], 'grading_scale:write')).toBe(false);
  });
});

describe('guardians and students', () => {
  it('confines a parent to their own children', () => {
    expect(resolveScope(['PARENT'], 'attendance:read')).toBe('OWN_CHILDREN');
    expect(resolveScope(['PARENT'], 'mark:read')).toBe('OWN_CHILDREN');
    expect(resolveScope(['PARENT'], 'invoice:read')).toBe('OWN_CHILDREN');
  });

  it('never lets a parent write attendance, marks or notices', () => {
    expect(can(['PARENT'], 'attendance:write')).toBe(false);
    expect(can(['PARENT'], 'mark:write')).toBe(false);
    expect(can(['PARENT'], 'notice:write')).toBe(false);
  });

  it('does not bill the student', () => {
    expect(can(['STUDENT'], 'invoice:read')).toBe(false);
    expect(can(['STUDENT'], 'payment:read')).toBe(false);
  });

  it('gives a driver nothing beyond notices until bus tracking exists', () => {
    expect(can(['DRIVER'], 'student:read')).toBe(false);
    expect(can(['DRIVER'], 'attendance:read')).toBe(false);
    expect(can(['DRIVER'], 'notice:read')).toBe(true);
  });
});

/**
 * The reason identity is separate from role: one person, two hats. The union
 * must widen access, and it must not leak the teacher's reach to the parent
 * half or vice versa — the scope resolves to the wider of the two, and the
 * API still filters by it.
 */
describe('a user holding several roles', () => {
  it('takes the widest scope granted by any of them', () => {
    expect(resolveScope(['TEACHER', 'PARENT'], 'attendance:read')).toBe('OWN_SECTIONS');
    expect(resolveScope(['PARENT', 'TEACHER'], 'attendance:read')).toBe('OWN_SECTIONS');
  });

  it('gains a permission only one of the roles holds', () => {
    expect(can(['PARENT'], 'mark:write')).toBe(false);
    expect(can(['TEACHER', 'PARENT'], 'mark:write')).toBe(true);
  });

  it('does not invent permissions neither role holds', () => {
    expect(can(['TEACHER', 'PARENT'], 'payment:record')).toBe(false);
    expect(can(['TEACHER', 'PARENT'], 'promotion:run')).toBe(false);
  });

  it('summarises to one grant per permission', () => {
    const grants = permissionsFor(['TEACHER', 'PARENT']);
    const permissions = grants.map((g) => g.permission);
    expect(new Set(permissions).size).toBe(permissions.length);
    expect(grants.find((g) => g.permission === 'student:read')?.scope).toBe('OWN_SECTIONS');
  });
});

describe('unknown or empty roles', () => {
  it('grants nothing to nobody', () => {
    expect(can([], 'student:read')).toBe(false);
    expect(resolveScope([], 'student:read')).toBeNull();
    expect(permissionsFor([])).toEqual([]);
  });
});
