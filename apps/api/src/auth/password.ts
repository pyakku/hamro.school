import argon2 from 'argon2';

/**
 * Password hashing.
 *
 * argon2id at the OWASP-recommended settings: 19 MiB of memory, two passes.
 * The memory cost is what makes a stolen database expensive to attack — GPUs
 * are good at hashing and bad at having a lot of fast memory per core.
 *
 * The parameters are recorded inside the hash string, so raising them later
 * only affects new hashes; `needsRehash` spots the old ones at next login.
 */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  // No `raw` key: with it, argon2.hash returns a Buffer instead of the
  // encoded string that carries the parameters we need for needsRehash.
} satisfies argon2.HashOptions;

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, OPTIONS);
}

/**
 * Never throws on a malformed or missing hash — an account without a password
 * (invited but not yet activated) must fail like a wrong password, not like a
 * server error, or the difference tells an attacker which emails are real.
 */
export async function verifyPassword(hash: string | null, plaintext: string): Promise<boolean> {
  if (!hash) {
    // Spend roughly the same time as a real verification so the response time
    // does not reveal whether the account exists.
    await burnTime(plaintext);
    return false;
  }
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

/** True when the stored hash was made with weaker settings than we now use. */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, OPTIONS);
  } catch {
    return true;
  }
}

let decoyHash: string | null = null;

async function burnTime(plaintext: string): Promise<void> {
  const decoy = (decoyHash ??= await argon2.hash('hamro.school timing decoy', OPTIONS));
  try {
    await argon2.verify(decoy, plaintext);
  } catch {
    /* the point is the work, not the answer */
  }
}
