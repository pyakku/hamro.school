import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOFT_DELETE_MODELS, TENANT_MODELS, UNSCOPED_MODELS } from './models.js';

/**
 * The guard that makes models.ts trustworthy.
 *
 * Add a model to the schema with a `schoolId` and forget to list it, and the
 * tenant extension will not scope it. That is a cross-tenant data leak arriving
 * as an ordinary feature commit, so it fails here instead.
 */
const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

interface ParsedModel {
  name: string;
  hasSchoolId: boolean;
  hasDeletedAt: boolean;
}

function parseModels(source: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = modelPattern.exec(source)) !== null) {
    const [, name = '', body = ''] = match;
    models.push({
      name,
      hasSchoolId: /^\s*schoolId\s/m.test(body),
      hasDeletedAt: /^\s*deletedAt\s/m.test(body),
    });
  }
  return models;
}

const parsed = parseModels(schema);
const sorted = (values: readonly string[]): string[] => [...values].sort();

describe('schema.prisma and models.ts agree', () => {
  it('finds the models', () => {
    expect(parsed.length).toBeGreaterThan(40);
  });

  it('lists every model that carries schoolId', () => {
    const inSchema = parsed.filter((m) => m.hasSchoolId).map((m) => m.name);
    expect(sorted(inSchema)).toEqual(sorted(TENANT_MODELS));
  });

  it('accounts for every model with no schoolId', () => {
    const inSchema = parsed.filter((m) => !m.hasSchoolId).map((m) => m.name);
    expect(sorted(inSchema)).toEqual(sorted(UNSCOPED_MODELS));
  });

  it('lists every soft-deletable model', () => {
    const inSchema = parsed.filter((m) => m.hasDeletedAt).map((m) => m.name);
    expect(sorted(inSchema)).toEqual(sorted(SOFT_DELETE_MODELS));
  });

  it('never soft-deletes money', () => {
    // A deleted payment silently changes every historical total and breaks
    // reconciliation against the bank. Payments are reversed, not deleted.
    for (const model of ['Payment', 'PaymentAllocation', 'Invoice', 'AuditLog']) {
      expect(parsed.find((m) => m.name === model)?.hasDeletedAt, model).toBe(false);
    }
  });

  it('keeps the audit log out of reach of soft delete', () => {
    expect(SOFT_DELETE_MODELS as readonly string[]).not.toContain('AuditLog');
  });
});
