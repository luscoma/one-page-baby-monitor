/** Byte and string conversions used by the crypto and link code. */

export const utf8 = new TextEncoder();
export const utf8Decoder = new TextDecoder();

/**
 * A byte array backed by a plain ArrayBuffer. `Uint8Array` on its own is generic over
 * ArrayBufferLike, which includes SharedArrayBuffer and so is not accepted by WebCrypto or Blob.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export function hex(bytes: Bytes): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function b64urlEncode(bytes: Bytes): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text: string): Bytes {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Compares two hex digests without leaking where they diverge. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomHex(byteLength = 8): string {
  return hex(crypto.getRandomValues(new Uint8Array(byteLength)));
}
