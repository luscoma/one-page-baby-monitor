/** The passphrase is the entirety of the security, so make a good one easy to get. */

// No look-alike characters: someone will read this aloud across a hallway.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export const MIN_PASSPHRASE_LENGTH = 8;

/** Three groups of four, roughly 59 bits of entropy. */
export function generatePassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
    if (i % 4 === 3 && i < 11) out += '-';
  }
  return out;
}

/** Matched case- and whitespace-insensitively so both phones agree on what was typed. */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isPassphraseLongEnough(passphrase: string): boolean {
  return normalizePassphrase(passphrase).length >= MIN_PASSPHRASE_LENGTH;
}
