import { describe, expect, it } from 'vitest';
import { countryFlag } from '../src/lib/flags.js';
import { lookupCountry } from '../src/lib/geoip.js';
import { humanSize } from '../src/lib/humanSize.js';
import { RateLimiter } from '../src/lib/rateLimit.js';
import { generateWordToken } from '../src/lib/wordlist.js';
import { WORDS } from '../src/lib/words.js';
import { contentDisposition } from '../src/routes/files.js';

describe('wordlist', () => {
  it('has 1296 lowercase-ascii words without dashes', () => {
    expect(WORDS).toHaveLength(1296);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]+$/);
  });

  it('generates 3 dash-joined wordlist words', () => {
    for (let i = 0; i < 50; i++) {
      const parts = generateWordToken().split('-');
      expect(parts).toHaveLength(3);
      for (const p of parts) expect(WORDS).toContain(p);
    }
  });
});

describe('humanSize', () => {
  it('formats sizes', () => {
    expect(humanSize(0)).toBe('0 B');
    expect(humanSize(999)).toBe('999 B');
    expect(humanSize(1024)).toBe('1 KB');
    expect(humanSize(1536)).toBe('1.5 KB');
    expect(humanSize(104857600)).toBe('100 MB');
    expect(humanSize(1073741824)).toBe('1 GB');
    expect(humanSize(-5)).toBe('0 B');
  });
});

describe('countryFlag', () => {
  it('maps country codes to regional indicator pairs', () => {
    expect(countryFlag('HU')).toBe('\u{1F1ED}\u{1F1FA}');
    expect(countryFlag('us')).toBe('\u{1F1FA}\u{1F1F8}');
    expect(countryFlag(null)).toBe('');
    expect(countryFlag('X')).toBe('');
    expect(countryFlag('USA')).toBe('');
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit per window, then resets', () => {
    const rl = new RateLimiter(3, 1000);
    const t = 1_000_000;
    expect(rl.allow('a', t)).toBe(true);
    expect(rl.allow('a', t + 1)).toBe(true);
    expect(rl.allow('a', t + 2)).toBe(true);
    expect(rl.allow('a', t + 3)).toBe(false);
    expect(rl.allow('b', t + 3)).toBe(true); // independent key
    expect(rl.allow('a', t + 1001)).toBe(true); // new window
  });
});

describe('contentDisposition', () => {
  it('produces an ascii fallback and RFC 5987 encoded name', () => {
    expect(contentDisposition('plain.txt')).toBe(
      `attachment; filename="plain.txt"; filename*=UTF-8''plain.txt`,
    );
    const cd = contentDisposition('árvíztűrő "x".pdf');
    expect(cd).toContain('filename="_rv_zt_r_ _x_.pdf"');
    expect(cd).toContain("filename*=UTF-8''%C3%A1rv%C3%ADzt%C5%B1r%C5%91%20%22x%22.pdf");
  });
});

describe('lookupCountry', () => {
  const okFetch =
    (body: unknown): typeof fetch =>
    () =>
      Promise.resolve(new Response(JSON.stringify(body)));

  it('returns the country code on success', async () => {
    expect(await lookupCountry('8.8.8.8', okFetch({ success: true, country_code: 'US' }))).toBe(
      'US',
    );
  });

  it('returns null for private IPs without calling the API', async () => {
    const fetchFn = (() => {
      throw new Error('should not be called');
    }) as unknown as typeof fetch;
    expect(await lookupCountry('192.168.1.10', fetchFn)).toBeNull();
    expect(await lookupCountry('10.0.0.1', fetchFn)).toBeNull();
    expect(await lookupCountry('127.0.0.1', fetchFn)).toBeNull();
  });

  it('returns null on API failure, bad payload, or network error', async () => {
    expect(await lookupCountry('8.8.8.8', okFetch({ success: false }))).toBeNull();
    expect(
      await lookupCountry('8.8.8.8', okFetch({ success: true, country_code: 'nope' })),
    ).toBeNull();
    const boom = (() => Promise.reject(new Error('down'))) as typeof fetch;
    expect(await lookupCountry('8.8.8.8', boom)).toBeNull();
  });
});
