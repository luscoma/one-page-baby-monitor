import { describe, expect, it } from 'vitest';
import { extractBlob } from './invite';
import { trimSdp } from './webrtc';
import { generatePassphrase, isPassphraseLongEnough, normalizePassphrase } from './passphrase';
import { formatDuration } from './format';

const BLOB = 'AQFhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5emFiY2RlZmdoaWo';

describe('extractBlob', () => {
  it('reads an invite link', () => {
    expect(extractBlob(`https://example.com/baby/#i=${BLOB}`)).toBe(BLOB);
  });

  it('reads a reply link', () => {
    expect(extractBlob(`https://example.com/baby/#r=${BLOB}`)).toBe(BLOB);
  });

  it('accepts a bare code pasted from the fallback box', () => {
    expect(extractBlob(BLOB)).toBe(BLOB);
  });

  it('tolerates the whitespace a messenger adds', () => {
    expect(extractBlob(`  https://example.com/#i=${BLOB}  \n`)).toBe(BLOB);
  });

  it('returns null for junk and empty input', () => {
    expect(extractBlob('hello there')).toBeNull();
    expect(extractBlob('')).toBeNull();
    expect(extractBlob(null)).toBeNull();
    expect(extractBlob('   ')).toBeNull();
  });

  it('returns null for a code too short to be real', () => {
    expect(extractBlob('AQFhYmNk')).toBeNull();
  });
});

describe('trimSdp', () => {
  const sdp = [
    'v=0',
    'a=candidate:1 1 udp 2122260223 192.168.1.10 54321 typ host',
    'a=candidate:2 1 tcp 1518280447 192.168.1.10 9 typ host tcptype active',
    'a=ice-ufrag:Xy9z',
    '',
  ].join('\r\n');

  it('drops TCP candidates to keep the invite link short', () => {
    expect(trimSdp(sdp)).not.toContain('tcp');
  });

  it('keeps the UDP candidates that actually connect on a home network', () => {
    expect(trimSdp(sdp)).toContain('192.168.1.10 54321 typ host');
  });

  it('leaves the rest of the session description alone', () => {
    expect(trimSdp(sdp)).toContain('a=ice-ufrag:Xy9z');
    expect(trimSdp(sdp).startsWith('v=0')).toBe(true);
  });
});

describe('passphrases', () => {
  it('generates a readable grouped code', () => {
    expect(generatePassphrase()).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
  });

  it('generates a different one each time', () => {
    const seen = new Set(Array.from({ length: 20 }, () => generatePassphrase()));
    expect(seen.size).toBe(20);
  });

  it('avoids characters that are misread aloud', () => {
    const joined = Array.from({ length: 50 }, () => generatePassphrase()).join('');
    expect(joined).not.toMatch(/[01ilo]/);
  });

  it('normalises case and internal whitespace', () => {
    expect(normalizePassphrase('  Quiet   Otter ')).toBe('quiet otter');
  });

  it('enforces a minimum length against guessable passphrases', () => {
    expect(isPassphraseLongEnough('short')).toBe(false);
    expect(isPassphraseLongEnough(generatePassphrase())).toBe(true);
  });
});

describe('formatDuration', () => {
  it('reads naturally at each scale', () => {
    expect(formatDuration(5_000)).toBe('5s');
    expect(formatDuration(65_000)).toBe('1m 5s');
    expect(formatDuration(3_930_000)).toBe('1h 5m');
  });
});
