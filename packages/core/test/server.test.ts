import { describe, expect, it } from 'vitest';
import { signFeedbackUser, signWebhook, verifyFeedbackUser, verifyWebhook } from '../src/server';

const SECRET = 'fbs_test_secret';

describe('signFeedbackUser / verifyFeedbackUser', () => {
  it('round-trips claims and stamps iat', async () => {
    const now = 1_700_000_000_000;
    const token = await signFeedbackUser({ id: 'u1', name: 'Ann', email: 'a@x.io', isAdmin: true }, SECRET, now);
    const result = await verifyFeedbackUser(token, SECRET, now);
    expect(result).toEqual({
      ok: true,
      claims: { id: 'u1', name: 'Ann', email: 'a@x.io', isAdmin: true, iat: now / 1000 },
    });
  });

  it('handles non-ASCII names', async () => {
    const token = await signFeedbackUser({ id: 'u2', name: 'Zoë – 日本' }, SECRET);
    const result = await verifyFeedbackUser(token, SECRET);
    expect(result.ok && result.claims.name).toBe('Zoë – 日本');
  });

  it('rejects a tampered payload', async () => {
    const token = await signFeedbackUser({ id: 'u1' }, SECRET);
    const [, sig] = token.split('.');
    const forged = `${btoa(JSON.stringify({ id: 'u1', isAdmin: true, iat: Date.now() / 1000 })).replace(/=+$/, '')}.${sig}`;
    expect(await verifyFeedbackUser(forged, SECRET)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects the wrong secret', async () => {
    const token = await signFeedbackUser({ id: 'u1' }, SECRET);
    expect(await verifyFeedbackUser(token, 'other')).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects expired tokens', async () => {
    const issued = 1_700_000_000_000;
    const token = await signFeedbackUser({ id: 'u1' }, SECRET, issued);
    const later = issued + 25 * 60 * 60 * 1000;
    expect(await verifyFeedbackUser(token, SECRET, later)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects garbage', async () => {
    expect(await verifyFeedbackUser('nope', SECRET)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('requires an id when signing', async () => {
    await expect(signFeedbackUser({ id: '' }, SECRET)).rejects.toThrow('claims.id');
  });
});

describe('webhook signatures', () => {
  it('verifies its own signature and rejects stale or altered bodies', async () => {
    const now = 1_700_000_000_000;
    const header = await signWebhook('whsec', '{"a":1}', now);
    expect(await verifyWebhook('whsec', '{"a":1}', header, 300, now)).toBe(true);
    expect(await verifyWebhook('whsec', '{"a":2}', header, 300, now)).toBe(false);
    expect(await verifyWebhook('whsec', '{"a":1}', header, 300, now + 10 * 60 * 1000)).toBe(false);
  });
});
