import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  add,
  allocate,
  applyBasisPoints,
  compare,
  currency,
  format,
  fromWire,
  money,
  parseDecimalString,
  subtract,
  sum,
  toDecimalString,
  toWire,
  zero,
} from './index.js';

const INR = currency('INR', 2);
const JPY = currency('JPY', 0);
const KWD = currency('KWD', 3);

describe('construction', () => {
  it('rejects a fractional minor amount instead of rounding it', () => {
    expect(() => money(10.5, INR)).toThrow(MoneyError);
  });

  it('rejects a currency code that is not ISO 4217 shaped', () => {
    expect(() => currency('rupees')).toThrow(MoneyError);
  });
});

describe('arithmetic', () => {
  it('adds without the float problem', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In minor units it is 30.
    const a = parseDecimalString('0.10', INR);
    const b = parseDecimalString('0.20', INR);
    expect(toDecimalString(add(a, b))).toBe('0.30');
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(100n, INR), money(100n, JPY))).toThrow(MoneyError);
  });

  it('sums an empty list to zero', () => {
    expect(sum([], INR)).toEqual(zero(INR));
  });

  it('subtracts into negative territory for credit notes', () => {
    expect(toDecimalString(subtract(money(100n, INR), money(250n, INR)))).toBe('-1.50');
  });

  it('compares', () => {
    expect(compare(money(1n, INR), money(2n, INR))).toBe(-1);
    expect(compare(money(2n, INR), money(2n, INR))).toBe(0);
  });
});

describe('basis points', () => {
  it('applies a 25% sibling discount exactly', () => {
    const fee = parseDecimalString('48000.00', INR);
    expect(toDecimalString(applyBasisPoints(fee, 2500))).toBe('12000.00');
  });

  it('rounds half away from zero, the way a bursar does', () => {
    // 5 paise at 50% is 2.5 paise.
    expect(applyBasisPoints(money(5n, INR), 5000).amountMinor).toBe(3n);
    expect(applyBasisPoints(money(-5n, INR), 5000).amountMinor).toBe(-3n);
  });

  it('rejects fractional basis points', () => {
    expect(() => applyBasisPoints(money(100n, INR), 12.5)).toThrow(MoneyError);
  });
});

describe('allocate', () => {
  it('never loses or invents a minor unit', () => {
    const parts = allocate(money(10_00n, INR), 3);
    expect(parts.map((p) => p.amountMinor)).toEqual([334n, 333n, 333n]);
    expect(sum(parts, INR).amountMinor).toBe(1000n);
  });

  it('handles a negative amount', () => {
    const parts = allocate(money(-10n, INR), 3);
    expect(sum(parts, INR).amountMinor).toBe(-10n);
  });

  it('rejects a nonsensical split', () => {
    expect(() => allocate(money(100n, INR), 0)).toThrow(MoneyError);
  });
});

describe('decimal strings', () => {
  it('round-trips at every supported exponent', () => {
    expect(toDecimalString(money(480_000n, INR))).toBe('4800.00');
    expect(toDecimalString(money(4800n, JPY))).toBe('4800');
    expect(toDecimalString(money(4800n, KWD))).toBe('4.800');
  });

  it('pads amounts smaller than one major unit', () => {
    expect(toDecimalString(money(5n, INR))).toBe('0.05');
    expect(toDecimalString(money(-5n, INR))).toBe('-0.05');
  });

  it('parses what the office actually types', () => {
    expect(parseDecimalString('48,000.50', INR).amountMinor).toBe(4_800_050n);
    expect(parseDecimalString(' 48000 ', INR).amountMinor).toBe(4_800_000n);
    expect(parseDecimalString('48000.5', INR).amountMinor).toBe(4_800_050n);
  });

  it('refuses more precision than the currency has, rather than rounding it away', () => {
    expect(() => parseDecimalString('100.005', INR)).toThrow(MoneyError);
    expect(() => parseDecimalString('100.5', JPY)).toThrow(MoneyError);
  });

  it('rejects junk', () => {
    expect(() => parseDecimalString('', INR)).toThrow(MoneyError);
    expect(() => parseDecimalString('twelve', INR)).toThrow(MoneyError);
    expect(() => parseDecimalString('1.2.3', INR)).toThrow(MoneyError);
  });

  it('survives an amount no float could hold', () => {
    const huge = money(9_007_199_254_740_993n, INR); // Number.MAX_SAFE_INTEGER + 2
    expect(toDecimalString(huge)).toBe('90071992547409.93');
  });
});

describe('the wire', () => {
  it('serialises the amount as a string, never a number', () => {
    const wire = toWire(money(480_000n, INR));
    expect(wire).toEqual({ amountMinor: '480000', currency: 'INR', minorUnits: 2 });
    expect(typeof wire.amountMinor).toBe('string');
    expect(() => JSON.stringify(wire)).not.toThrow();
  });

  it('round-trips through JSON without losing a unit', () => {
    const original = money(9_007_199_254_740_993n, INR);
    const restored = fromWire(JSON.parse(JSON.stringify(toWire(original))));
    expect(restored.amountMinor).toBe(original.amountMinor);
  });
});

describe('display', () => {
  it('formats through the exact decimal string', () => {
    const formatted = format(money(480_000n, INR), 'en-IN');
    expect(formatted).toContain('4,800.00');
  });

  it('groups rupees in lakhs, not thousands, for a bare `en`', () => {
    // ₹58,20,000.00 — what a bursar in Kalimpong reads. The Western
    // ₹5,820,000.00 is the bug this mapping exists to prevent, and it is
    // invisible until an amount passes a lakh.
    expect(format(money(582_000_000n, INR))).toContain('58,20,000.00');
  });

  it('leaves currencies outside the subcontinent grouped in thousands', () => {
    expect(format(money(582_000_000n, currency('AED', 2)))).toContain('5,820,000.00');
  });

  it('never overrides a locale the school actually set', () => {
    expect(format(money(582_000_000n, INR), 'en-US')).toContain('5,820,000.00');
  });
});
