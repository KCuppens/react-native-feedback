import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});

const alice = { user: 'alice', email: 'alice@example.com' };
const storedLocale = (externalId: string) =>
  (h.db.prepare('SELECT locale FROM end_users WHERE external_id = ?').get(externalId) as { locale: string | null }).locale;

async function postIn(locale: string | null, title = 'Dark mode please') {
  const headers = { ...(await h.as(alice)), ...(locale ? { 'X-Feedback-Locale': locale } : {}) };
  const res = await h.request('/v1/posts', { method: 'POST', headers, json: { title } });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

describe('email languages', () => {
  it("stores the author's app language and writes their emails in it", async () => {
    const post = await postIn('de-AT');
    expect(storedLocale('alice')).toBe('de');
    h.emails.length = 0;

    await h.approve(post.id);
    expect(h.emails.at(-1)).toMatchObject({ to: 'alice@example.com', subject: '[Demo App] Dein Feedback ist jetzt öffentlich' });
    expect(h.emails.at(-1)!.text).toContain('Danke, dass du hilfst, Demo App zu verbessern!');

    await h.request(`/v1/admin/posts/${post.id}`, { method: 'PATCH', headers: h.admin(), json: { status: 'planned' } });
    expect(h.emails.at(-1)!.subject).toBe('[Demo App] Dein Feedback ist jetzt „Geplant“');
  });

  it('keeps the stored language when a later request sends none, and follows a change', async () => {
    await postIn('ja');
    await postIn(null, 'Second idea');
    expect(storedLocale('alice')).toBe('ja');
    await postIn('ko', 'Third idea');
    expect(storedLocale('alice')).toBe('ko');
  });

  it('falls back to English for unknown or missing languages', async () => {
    const post = await postIn('pt-BR');
    expect(storedLocale('alice')).toBe('en');
    await h.request(`/v1/admin/posts/${post.id}/decline`, { method: 'POST', headers: h.admin(), json: { reason: 'Duplicate' } });
    expect(h.emails.at(-1)).toMatchObject({ subject: '[Demo App] Your feedback was declined' });
    expect(h.emails.at(-1)!.text).toContain('Reason: Duplicate');
  });

  it("writes the team's new-post email in the project's email language", async () => {
    const saved = await h.request('/v1/admin/settings', { method: 'PATCH', headers: h.admin(), json: { emailLocale: 'nl' } });
    expect(saved.status).toBe(200);
    h.emails.length = 0;
    await postIn('fr', 'Donker thema');
    expect(h.emails[0]).toMatchObject({
      to: 'owner@example.com',
      subject: '[Demo App] Nieuwe feedback om na te kijken: Donker thema',
    });
    expect(h.emails[0]!.html).toContain('Nakijken in het dashboard');
  });

  it('rejects an email language the board does not ship', async () => {
    const res = await h.request('/v1/admin/settings', { method: 'PATCH', headers: h.admin(), json: { emailLocale: 'pt' } });
    expect(res.status).toBe(400);
  });

  it('lets browsers send the language header cross-origin', async () => {
    const res = await h.request('/v1/config', { method: 'OPTIONS', headers: { Origin: 'https://app.example' } });
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-Feedback-Locale');
  });
});
