// The real client SDKs (hosted adapter + admin client) talking to the real worker.
import { createAdminClient, createHostedAdapter, FeedbackApiError } from '@kobecuppens/feedback-core';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { createHarness } from './harness';

describe('client ↔ worker contract', () => {
  it('runs the full submit → moderate → vote → roadmap → updates loop through the SDKs', async () => {
    const h = await createHarness();
    const fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(app.request(String(input), init, h.env))) as typeof globalThis.fetch;
    const baseUrl = 'https://feedback.test';

    const alice = createHostedAdapter({
      projectKey: h.project.publicKey,
      baseUrl,
      fetch,
      userToken: await h.userToken({ id: 'alice', name: 'Alice', email: 'alice@x.io' }),
    });
    const anon = createHostedAdapter({ projectKey: h.project.publicKey, baseUrl, fetch });
    const admin = createAdminClient({ baseUrl, fetch, secretKey: h.project.secretKey }).project();

    const cat = await admin.createCategory({ name: 'Feature', color: '#2563EB' });
    const config = await alice.getConfig();
    expect(config.categories.map((c) => c.name)).toEqual(['Feature']);

    const file = await alice.upload(new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }));
    const post = await alice.createPost({ title: 'Offline mode', body: 'Please', categoryId: cat.id, attachmentIds: [file.id] });
    expect(post).toMatchObject({ moderation: 'pending', isMine: true, category: { name: 'Feature' }, attachments: [{ id: file.id }] });

    expect((await anon.listPosts({})).items).toEqual([]);
    const queue = await admin.listQueue();
    expect(queue.items.map((p) => p.id)).toEqual([post.id]);
    await admin.approve(post.id);

    const voted = await anon.vote(post.id, -1);
    expect(voted).toMatchObject({ myVote: -1, score: 0, upvotes: 1, downvotes: 1 });
    await anon.createComment(post.id, { body: 'Would love this' });
    await admin.reply(post.id, 'Planned for Q3');
    await admin.updatePost(post.id, { status: 'planned' });

    const comments = await alice.listComments(post.id);
    expect(comments.items.map((c) => [c.body, c.isOfficial])).toEqual([
      ['Would love this', false],
      ['Planned for Q3', true],
    ]);
    const roadmap = await anon.getRoadmap();
    expect(roadmap.find((c) => c.status === 'planned')!.posts[0]!.id).toBe(post.id);

    const updates = await alice.getUpdates();
    expect(updates.unseen).toBe(3);
    await alice.markUpdatesSeen();
    expect((await alice.getUpdates()).unseen).toBe(0);

    const filtered = await anon.listPosts({ status: ['planned', 'done'], categoryId: cat.id, sort: 'trending', q: 'offline' });
    expect(filtered.items).toHaveLength(1);

    // In-app admin via the same adapter, once the project allows it.
    await admin.updateSettings({ inAppAdmin: true });
    const boss = createHostedAdapter({ projectKey: h.project.publicKey, baseUrl, fetch, userToken: await h.userToken({ id: 'boss', isAdmin: true }) });
    expect((await boss.getConfig()).viewer.isAdmin).toBe(true);
    await boss.admin!.updatePost(post.id, { status: 'in_progress' });
    const err = await alice.admin!.listQueue().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FeedbackApiError);
    expect((err as FeedbackApiError).status).toBe(403);

    // New-post alert to the owner, then approved, planned and in-progress notices to Alice.
    expect(h.emails.map((e) => e.to)).toEqual(['owner@example.com', 'alice@x.io', 'alice@x.io', 'alice@x.io']);
  });
});
