import { signFeedbackUser } from '@kobecuppens/feedback-core/server';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import config from './e2e.config.json';

/*
 * One project walked through its whole life on a local worker: created and configured in
 * the dashboard, used by an anonymous visitor on the public board, moderated from the
 * dashboard and from inside the web board, branded, and finally deleted.
 * The tests share that project, so they run in order.
 */
test.describe.configure({ mode: 'serial' });

const PROJECT = 'E2E Board';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let adminContext: BrowserContext;
let visitorContext: BrowserContext;
let admin: Page;
let visitor: Page;
let slug = '';
let signingSecret = '';

test.beforeAll(async ({ browser }) => {
  adminContext = await browser.newContext();
  visitorContext = await browser.newContext({ locale: 'en-US' });
  admin = await adminContext.newPage();
  visitor = await visitorContext.newPage();
});

test.afterAll(async () => {
  await adminContext.close();
  await visitorContext.close();
});

async function openSection(section: string) {
  await admin.goto('/admin/');
  await admin
    .getByRole('link', { name: PROJECT })
    .or(admin.getByRole('button', { name: PROJECT }))
    .first()
    .click();
  // The queue tab carries its count: "Review queue (4)".
  await admin
    .getByText(new RegExp(`^${section}( \\(\\d+\\))?$`))
    .first()
    .click();
}

async function setToggle(label: RegExp, on: boolean) {
  const box = admin.getByLabel(label);
  if ((await box.isChecked()) !== on) await box.click();
  // The checkbox reflects the saved setting, so it only flips once the server answers.
  await expect(box).toBeChecked({ checked: on });
}

const queueCard = (title: string) =>
  admin.locator('article.card').filter({ has: admin.getByRole('heading', { name: title, exact: true }) });

async function openDrawer(title: string) {
  await openSection('All posts');
  await admin.getByText(title, { exact: true }).first().click();
  await expect(admin.getByRole('dialog')).toBeVisible();
  return admin.getByRole('dialog');
}

async function visit(page: Page = visitor, query = '') {
  await page.goto(`/p/${slug}${query}`);
}

async function submitIdea(title: string) {
  await visitor.getByRole('button', { name: /New idea/ }).click();
  await visitor.getByLabel('Title').fill(title);
  await visitor.getByLabel('Details').fill(`Body of ${title}`);
  await visitor.getByRole('button', { name: 'Submit' }).click();
  await expect(visitor.getByText('Thanks! Your post will appear once it has been reviewed.')).toBeVisible();
  await visitor.getByRole('button', { name: 'Done' }).click();
  // Done opens the new post; go back to the list for the next one.
  await visitor.getByRole('button', { name: /Back/ }).first().click();
}

test('dashboard: sign in and create a project; its keys are shown once', async () => {
  await admin.goto('/admin/');
  await admin.locator('input[type=password]').fill(config.password);
  await admin.keyboard.press('Enter');
  await admin.getByText('New project').click();
  await admin.getByLabel('App name').fill(PROJECT);
  const created = admin.waitForResponse((r) => r.url().endsWith('/v1/dashboard/projects') && r.request().method() === 'POST');
  await admin.getByRole('button', { name: 'Create', exact: true }).click();
  const body = (await (await created).json()) as { slug: string; secrets: { signingSecret: string } };
  slug = body.slug;
  signingSecret = body.secrets.signingSecret;
  await expect(admin.getByText('Admin API key (shown once)')).toBeVisible();
  await admin.getByRole('button', { name: "I've copied the key" }).click();
});

test('settings: the public board and anonymous posting stay on after a reload', async () => {
  await openSection('Settings & keys');
  await setToggle(/Public board page/, true);
  await setToggle(/Allow anonymous users/, true);
  await setToggle(/In-app admin/, true);
  await expect(admin.locator(`a[href$="/p/${slug}"]`)).toBeVisible();
  await admin.reload();
  await expect(admin.getByLabel(/Public board page/)).toBeChecked();
});

test('public board: an anonymous visitor submits ideas that wait for review', async () => {
  await visit();
  await expect(visitor.getByRole('heading', { name: PROJECT })).toBeVisible();
  for (const t of ['Idea A', 'Idea B (duplicate of A)', 'Idea C', 'Idea D']) await submitIdea(t);
  await expect(visitor.getByText('Idea D', { exact: true })).toBeVisible();
});

test('public board: a pending post says "Awaiting review" once, in the banner', async () => {
  await visitor.getByText('Idea D', { exact: true }).first().click();
  // The list stays mounted (hidden) under the detail, with its own pills: count what shows.
  await expect(visitor.getByText('Awaiting review', { exact: true }).filter({ visible: true })).toHaveCount(1);
  await visitor.getByRole('button', { name: /Back/ }).first().click();
});

test('public board: a screenshot uploads with a new idea', async () => {
  await visitor.getByRole('button', { name: /New idea/ }).click();
  await visitor.getByLabel('Title').fill('Idea with a screenshot');
  await visitor.locator('input[type=file]').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await expect(visitor.locator('.fb-attachmentImage')).toBeVisible();
  await visitor.getByRole('button', { name: 'Submit' }).click();
  await expect(visitor.getByText('Thanks! Your post will appear once it has been reviewed.')).toBeVisible();
  await visitor.getByRole('button', { name: 'Done' }).click();
  await expect(visitor.locator('.fb-attachmentImage')).toBeVisible();
  await visitor.getByRole('button', { name: /Back/ }).first().click();
});

test('categories: add one and rename it', async () => {
  await openSection('Categories');
  await admin.getByLabel('New category name').fill('Bug');
  await admin.getByRole('button', { name: 'Add' }).click();
  const name = admin.getByLabel('Name of Bug');
  await name.fill('Bugs');
  await name.press('Enter');
  await name.blur();
  await expect(admin.getByLabel('Name of Bugs')).toBeVisible();
  await admin.reload();
  await expect(admin.getByLabel('Name of Bugs')).toBeVisible();
});

test('review queue: approve three ideas and decline one with a reason', async () => {
  await openSection('Review queue');
  await expect(admin.getByText('Review queue (5)')).toBeVisible();
  for (const t of ['Idea A', 'Idea B (duplicate of A)', 'Idea C']) {
    await queueCard(t).getByRole('button', { name: 'Approve' }).click();
    await expect(queueCard(t)).toHaveCount(0);
  }
  const d = queueCard('Idea D');
  await d.getByRole('button', { name: 'Decline…' }).click();
  await d.getByLabel('Decline reason').fill('Out of scope for this app');
  await d.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(queueCard('Idea D')).toHaveCount(0);
});

test('public board: the visitor sees approved ideas and the decline reason', async () => {
  await visit();
  await expect(visitor.getByText('Idea A', { exact: true })).toBeVisible();
  await visitor.getByText('Idea D', { exact: true }).first().click();
  await expect(visitor.getByText('Declined: Out of scope for this app')).toBeVisible();
  await expect(visitor.getByText('Declined', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('public board: the visitor comments and votes on an idea', async () => {
  await visit();
  await visitor.getByText('Idea C', { exact: true }).first().click();
  const upvote = visitor.getByRole('button', { name: 'Upvote' }).filter({ visible: true }).first();
  // The author's own vote is already counted; take it back, then vote again.
  const count = visitor.locator('.fb-voteCount').filter({ visible: true }).first();
  await upvote.click();
  await expect(count).toContainText('0 votes');
  await upvote.click();
  await expect(count).toContainText('1 vote');
  await visitor.getByLabel('Add a comment…').fill('A visitor comment');
  await visitor.getByRole('button', { name: 'Send' }).click();
  await expect(visitor.getByText('A visitor comment')).toBeVisible();
});

test('drawer: set status and category, reply as the team', async () => {
  const drawer = await openDrawer('Idea C');
  await drawer.locator('select').first().selectOption({ label: 'Planned' });
  await expect(drawer.getByText('A visitor comment')).toBeVisible();
  await drawer.getByPlaceholder('Official reply (shown with a Team badge)').fill('On the roadmap');
  await drawer.getByRole('button', { name: 'Reply as team' }).click();
  await expect(drawer.getByText('On the roadmap')).toBeVisible();
  await admin.keyboard.press('Escape');
  await admin.getByLabel('Category of Idea C').selectOption({ label: 'Bugs' });
  await expect(admin.getByLabel('Category of Idea C')).toHaveValue(/.+/);
});

test('drawer: merge a duplicate into its original', async () => {
  const drawer = await openDrawer('Idea B (duplicate of A)');
  await drawer.getByLabel('Search merge target').fill('Idea A');
  const select = drawer.getByLabel('Merge into', { exact: true });
  await select.focus();
  const option = select.locator('option', { hasText: /^Idea A \(/ });
  await expect(option).toHaveCount(1);
  await select.selectOption((await option.getAttribute('value'))!);
  await drawer.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(admin.getByRole('dialog')).toHaveCount(0);
  await openSection('All posts');
  await expect(admin.getByText('Idea B (duplicate of A)', { exact: true })).toHaveCount(0);
});

test('roadmap page: move an idea to In progress', async () => {
  await openSection('Roadmap');
  await admin.getByLabel('Move Idea C').selectOption({ label: 'In progress' });
  await admin.reload();
  await expect(admin.getByLabel('Move Idea C')).toHaveValue('in_progress');
});

test('all posts: moderation and status filters', async () => {
  await openSection('All posts');
  await admin.getByLabel('Moderation').selectOption({ label: 'Declined' });
  await expect(admin.getByText('Idea D', { exact: true })).toBeVisible();
  await expect(admin.getByText('Idea A', { exact: true })).toHaveCount(0);
  await admin.getByLabel('Moderation').selectOption({ label: 'Any moderation' });
  await admin.getByLabel('Status').first().selectOption({ label: 'In progress' });
  await expect(admin.getByText('Idea C', { exact: true })).toBeVisible();
  await expect(admin.getByText('Idea A', { exact: true })).toHaveCount(0);
});

test('public board: roadmap and Updates reach the visitor', async () => {
  await visit();
  await visitor.getByRole('tab', { name: 'Roadmap' }).click();
  await expect(visitor.getByText('Idea C', { exact: true })).toBeVisible();
  await visitor.getByRole('tab', { name: /Updates/ }).click();
  await expect(visitor.getByText(/team replied/i)).toBeVisible();
});

test('web board: a signed admin moderates in the board itself', async () => {
  const token = await signFeedbackUser({ id: 'e2e-admin', name: 'Board Admin', isAdmin: true }, signingSecret);
  const page = await visitorContext.newPage();
  await visit(page, `?user=${encodeURIComponent(token)}`);
  await page.getByRole('tab', { name: 'Review' }).click();
  const card = page.locator('.fb-card', { hasText: 'Idea with a screenshot' });
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Nothing to review.')).toBeVisible();
  await page.getByRole('tab', { name: 'Feedback' }).click();
  await page.getByText('Idea with a screenshot', { exact: true }).first().click();
  await expect(page.locator('.fb-attachmentImage')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.fb-statusPill', { hasText: 'Done' }).filter({ visible: true })).toBeVisible();
  await page.close();
});

test('drawer: delete a post', async () => {
  const drawer = await openDrawer('Idea A');
  await drawer.getByText('Delete post…').click();
  await drawer.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await openSection('All posts');
  await expect(admin.getByText('Idea A', { exact: true })).toHaveCount(0);
});

test('webhooks: add an endpoint and delete it', async () => {
  await openSection('Webhooks');
  await admin.getByLabel('Webhook URL').fill('https://example.com/e2e-hook');
  await admin.getByRole('button', { name: 'Add webhook' }).click();
  await expect(admin.getByText('https://example.com/e2e-hook')).toBeVisible();
  await admin.getByRole('button', { name: 'Delete' }).last().click();
  if (await admin.getByText('Delete this webhook?').count())
    await admin.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(admin.getByText('No webhooks yet.')).toBeVisible();
});

test('appearance: the public board takes the project branding', async () => {
  await openSection('Settings & keys');
  await admin.getByLabel('Colour scheme').selectOption({ label: 'Always light' });
  await admin.getByLabel('Logo URL').fill('https://example.com/logo.png');
  await admin.getByLabel('Logo links to').fill('https://example.com/');
  await admin.getByLabel('Theme tokens (JSON)').fill('{"colors":{"primary":"#123456"},"radii":{"lg":0}}');
  await admin.getByLabel('Custom CSS').fill('.fb-page-title { letter-spacing: 3px; }');
  const saved = admin.waitForResponse((r) => r.url().endsWith('/v1/admin/settings') && r.request().method() === 'PATCH');
  await admin.getByRole('button', { name: 'Save appearance' }).click();
  expect((await saved).status()).toBe(200);

  // Same visitor as before: the public project lookup must not be served from the browser cache.
  const page = visitor;
  await visit(page);
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'light');
  await expect(page.locator('.fb-page-header a[href="https://example.com/"] img.fb-page-logo')).toBeAttached();
  await expect(page.locator('.fb-page-title')).toHaveCSS('letter-spacing', '3px');
  await expect(page.locator('.fb-card').first()).toHaveCSS('border-radius', '0px');
  await expect(page.getByRole('button', { name: /New idea/ })).toHaveCSS('background-color', 'rgb(18, 52, 86)');
});

test('appearance: invalid theme JSON is refused before saving', async () => {
  await openSection('Settings & keys');
  await admin.getByLabel('Theme tokens (JSON)').fill('{not json');
  await admin.getByRole('button', { name: 'Save appearance' }).click();
  await expect(admin.getByText('The theme is not valid JSON.')).toBeVisible();
});

test('keys: rotating the public key keeps the public board working', async () => {
  await openSection('Settings & keys');
  await admin.getByText('Rotate public key').click();
  await admin.getByRole('button', { name: 'Rotate', exact: true }).last().click();
  await visit();
  await expect(visitor.getByText('Idea C', { exact: true })).toBeVisible();
});

test('languages: the dashboard switches through every language', async () => {
  await admin.goto('/admin/');
  const select = admin.locator('select').filter({ has: admin.locator('option', { hasText: 'Nederlands' }) });
  const signOut: Record<string, RegExp> = {
    Nederlands: /Afmelden/,
    Français: /Se déconnecter/,
    Deutsch: /Abmelden/,
    Español: /Cerrar sesión/,
    日本語: /サインアウト/,
    한국어: /로그아웃/,
    English: /Sign out/,
  };
  for (const [language, label] of Object.entries(signOut)) {
    await select.selectOption({ label: language });
    await expect(admin.getByText(label).first()).toBeVisible();
  }
});

test('public board: follows ?lang=', async () => {
  await visit(visitor, '?lang=de');
  await expect(visitor.getByRole('tab', { name: 'Roadmap' })).toBeVisible();
  await expect(visitor.getByRole('button', { name: /Neue Idee/ })).toBeVisible();
});

test('project: rename and delete it; the public board is gone', async () => {
  await openSection('Settings & keys');
  await admin.getByLabel('Project name').fill(`${PROJECT} renamed`);
  await admin.getByRole('button', { name: 'Rename' }).click();
  await expect(admin.getByText(`${PROJECT} renamed`).first()).toBeVisible();
  await admin.getByText('Delete project…').click();
  await admin.getByLabel('Confirm slug').fill(slug);
  await admin.getByRole('button', { name: 'Delete forever' }).click();
  await expect(admin.getByText(`${PROJECT} renamed`)).toHaveCount(0);
  const fresh = await visitorContext.browser()!.newContext();
  const page = await fresh.newPage();
  await visit(page);
  await expect(page.getByText("This board doesn't exist or isn't public.")).toBeVisible();
  await fresh.close();
});
