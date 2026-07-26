import { b64urlDecode, b64urlEncode, hex, utf8, utf8Decoder, type Bytes } from './encoding';
import { normalizePassphrase } from './passphrase';
import { isSignalPayload, type SignalPayload } from '../types';

const PEER_ID_ITERATIONS = 100_000;
const AUTH_ITERATIONS = 60_000;
const SEAL_ITERATIONS = 150_000;

async function pbkdf2Bits(
  passphrase: string,
  salt: Bytes,
  iterations: number,
  bits: number,
): Promise<Bytes> {
  const base = await crypto.subtle.importKey('raw', utf8.encode(passphrase), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    bits,
  );
  return new Uint8Array(derived);
}

/**
 * The broker ID is a deliberately slow hash of the passphrase. Whoever runs the broker sees
 * the ID, but working back to the passphrase costs a full PBKDF2 run per guess.
 */
export async function peerIdFor(passphrase: string): Promise<string> {
  const bits = await pbkdf2Bits(
    normalizePassphrase(passphrase),
    utf8.encode('baby-monitor/peer-id/v1'),
    PEER_ID_ITERATIONS,
    160,
  );
  return 'bm' + hex(bits);
}

/**
 * Knowing the broker ID is not proof of knowing the passphrase, so the monitor challenges
 * every caller with a nonce before it hands over the microphone. Slow-hashed as well, so an
 * observed proof is not a cheap oracle for guessing.
 */
export async function authProof(passphrase: string, nonce: string): Promise<string> {
  const bits = await pbkdf2Bits(
    normalizePassphrase(passphrase),
    utf8.encode('baby-monitor/auth/v1|' + nonce),
    AUTH_ITERATIONS,
    256,
  );
  return hex(bits);
}

async function deflateRaw(bytes: Bytes): Promise<Bytes | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflateRaw(bytes: Bytes): Promise<Bytes> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const SEAL_VERSION = 1;
const HEADER_BYTES = 30; // version + flags + 16-byte salt + 12-byte iv

/**
 * Packs a signal payload into a URL-safe blob encrypted with a key derived from the
 * passphrase. Compression matters: it keeps an invite link short enough to send over a
 * messenger. Older browsers without CompressionStream fall back to plain bytes, recorded in
 * the flags byte so the other side knows.
 */
export async function seal(payload: SignalPayload, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = utf8.encode(JSON.stringify(payload));
  const squeezed = await deflateRaw(plain);
  const body = squeezed ?? plain;

  const keyBits = await pbkdf2Bits(normalizePassphrase(passphrase), salt, SEAL_ITERATIONS, 256);
  const key = await crypto.subtle.importKey('raw', keyBits, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body),
  );

  const out = new Uint8Array(HEADER_BYTES + ciphertext.length);
  out[0] = SEAL_VERSION;
  out[1] = squeezed ? 1 : 0;
  out.set(salt, 2);
  out.set(iv, 18);
  out.set(ciphertext, HEADER_BYTES);
  return b64urlEncode(out);
}

export async function unseal(blob: string, passphrase: string): Promise<SignalPayload> {
  let raw: Bytes;
  try {
    raw = b64urlDecode(blob);
  } catch {
    throw new Error('That link is damaged — copy the whole thing and try again.');
  }
  if (raw.length <= HEADER_BYTES || raw[0] !== SEAL_VERSION) {
    throw new Error('This link is not in a format this page understands.');
  }

  const compressed = raw[1] === 1;
  const salt = raw.slice(2, 18);
  const iv = raw.slice(18, HEADER_BYTES);
  const ciphertext = raw.slice(HEADER_BYTES);

  const keyBits = await pbkdf2Bits(normalizePassphrase(passphrase), salt, SEAL_ITERATIONS, 256);
  const key = await crypto.subtle.importKey('raw', keyBits, 'AES-GCM', false, ['decrypt']);

  let body: Bytes;
  try {
    body = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext),
    );
  } catch {
    // AES-GCM authentication failed, which for our purposes means the wrong passphrase.
    throw new Error('Wrong passphrase for this link.');
  }
  if (compressed) body = await inflateRaw(body);

  const parsed: unknown = JSON.parse(utf8Decoder.decode(body));
  if (!isSignalPayload(parsed)) throw new Error('That link does not contain connection details.');
  return parsed;
}
