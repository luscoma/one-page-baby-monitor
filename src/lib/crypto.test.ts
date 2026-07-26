import { describe, expect, it } from 'vitest';
import { authProof, peerIdFor, seal, unseal } from './crypto';
import type { SignalPayload } from '../types';

const PASS = 'quiet-otter-4821';

const payload: SignalPayload = {
  sid: 'a1b2c3d4',
  role: 'offer',
  sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\na=ice-ufrag:abcd\r\na=candidate:1 1 udp 1 10.0.0.5 5000 typ host\r\n',
};

describe('peerIdFor', () => {
  it('is deterministic so both phones derive the same broker id', async () => {
    expect(await peerIdFor(PASS)).toBe(await peerIdFor(PASS));
  });

  it('ignores case and surrounding whitespace, which people get wrong when typing', async () => {
    expect(await peerIdFor('  QUIET-Otter-4821 ')).toBe(await peerIdFor(PASS));
  });

  it('differs for different passphrases', async () => {
    expect(await peerIdFor(PASS)).not.toBe(await peerIdFor('some-other-phrase'));
  });

  it('produces an id the PeerJS broker will accept', async () => {
    expect(await peerIdFor(PASS)).toMatch(/^bm[0-9a-f]{40}$/);
  });
});

describe('authProof', () => {
  it('is reproducible for the same passphrase and nonce', async () => {
    expect(await authProof(PASS, 'nonce-1')).toBe(await authProof(PASS, 'nonce-1'));
  });

  it('changes with the nonce, so a captured proof cannot be replayed', async () => {
    expect(await authProof(PASS, 'nonce-1')).not.toBe(await authProof(PASS, 'nonce-2'));
  });

  it('does not match when the passphrase is wrong', async () => {
    expect(await authProof(PASS, 'n')).not.toBe(await authProof('wrong-passphrase', 'n'));
  });

  it('cannot be derived from the broker id alone', async () => {
    // Different salt domains, so knowing one tells you nothing about the other.
    const id = await peerIdFor(PASS);
    expect(await authProof(PASS, 'n')).not.toContain(id.slice(2));
  });
});

describe('seal / unseal', () => {
  it('round trips a payload', async () => {
    const restored = await unseal(await seal(payload, PASS), PASS);
    expect(restored).toEqual(payload);
  });

  it('rejects the wrong passphrase rather than returning garbage', async () => {
    const blob = await seal(payload, PASS);
    await expect(unseal(blob, 'not-the-passphrase')).rejects.toThrow(/wrong passphrase/i);
  });

  it('produces a different blob every time, so links are not linkable', async () => {
    expect(await seal(payload, PASS)).not.toBe(await seal(payload, PASS));
  });

  it('stays URL-safe', async () => {
    expect(await seal(payload, PASS)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('compresses: an SDP-sized payload seals smaller than it started', async () => {
    const big: SignalPayload = { ...payload, sdp: payload.sdp.repeat(12) };
    const blob = await seal(big, PASS);
    expect(blob.length).toBeLessThan(big.sdp.length);
  });

  it('refuses a tampered ciphertext', async () => {
    const blob = await seal(payload, PASS);
    // Flip a character near the end, inside the ciphertext rather than the header.
    const last = blob.at(-1) === 'A' ? 'B' : 'A';
    await expect(unseal(blob.slice(0, -1) + last, PASS)).rejects.toThrow();
  });

  it('rejects something that is not a sealed blob at all', async () => {
    await expect(unseal('AAAA', PASS)).rejects.toThrow(/not in a format/i);
  });
});
