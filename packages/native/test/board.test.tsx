import { createMemoryAdapter, type Post } from '@kobecuppens/feedback-core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Text } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackBoard, FeedbackList, FeedbackProvider, type PostCardProps } from '../src';

const seed = () =>
  createMemoryAdapter({
    categories: [{ id: 'bug', name: 'Bug', color: '#DC2626', sort: 0 }],
    posts: [
      { id: 'p1', title: 'Dark mode', body: 'Please', score: 5, upvotes: 5 },
      { id: 'p2', title: 'Widgets', score: 2, upvotes: 2, status: 'planned' },
      { id: 'p3', title: 'Crash on launch', score: 1, upvotes: 1, category: { id: 'bug', name: 'Bug', color: '#DC2626', sort: 0 } },
    ],
  });

describe('<FeedbackBoard>', () => {
  it('renders posts sorted by votes with tabs from server features', async () => {
    render(<FeedbackBoard adapter={seed()} locale="en" />);
    await screen.findByText('Dark mode');
    const titles = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')).filter((l) => ['Dark mode', 'Widgets', 'Crash on launch'].includes(l ?? ''));
    expect(titles).toEqual(['Dark mode', 'Widgets', 'Crash on launch']);
    expect(screen.getByRole('tab', { name: 'Roadmap' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Updates' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Review' })).toBeNull();
  });

  it('votes optimistically and toggles off', async () => {
    const adapter = seed();
    render(<FeedbackBoard adapter={adapter} locale="en" />);
    await screen.findByText('Widgets');
    const upvotes = screen.getAllByRole('button', { name: 'Upvote' });
    fireEvent.click(upvotes[1]!);
    await waitFor(() => expect(adapter.posts.find((p) => p.id === 'p2')!.myVote).toBe(1));
    await screen.findByText('3');
    fireEvent.click(screen.getAllByRole('button', { name: 'Upvote' })[1]!);
    await waitFor(() => expect(adapter.posts.find((p) => p.id === 'p2')!.myVote).toBe(0));
  });

  it('hides downvotes when the client turns them off, but cannot turn on what the server disables', async () => {
    const first = render(<FeedbackBoard adapter={seed()} locale="en" features={{ downvote: false }} />);
    await screen.findByText('Dark mode');
    expect(screen.queryAllByRole('button', { name: 'Downvote' })).toHaveLength(0);
    first.unmount();

    const locked = createMemoryAdapter({ settings: { allowDownvotes: false, roadmapEnabled: false }, posts: [{ title: 'Only' }] });
    render(<FeedbackBoard adapter={locked} locale="en" features={{ downvote: true, roadmap: true }} />);
    await screen.findByText('Only');
    expect(screen.queryAllByRole('button', { name: 'Downvote' })).toHaveLength(0);
    expect(screen.queryByRole('tab', { name: 'Roadmap' })).toBeNull();
  });

  it('opens a post, comments, and returns', async () => {
    render(<FeedbackBoard adapter={seed()} locale="en" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dark mode' }));
    // The list stays mounted (hidden) underneath, so its excerpt is in the DOM too.
    await waitFor(() => expect(screen.getAllByText('Please')).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Add a comment…'), { target: { value: 'Yes please' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Yes please');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('tab', { name: 'Feedback' });
  });

  it('submits a post that stays pending for review', async () => {
    const adapter = seed();
    render(<FeedbackBoard adapter={adapter} locale="en" />);
    fireEvent.click(await screen.findByRole('button', { name: /New idea/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Offline mode' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Thanks! Your post will appear once it has been reviewed.');
    expect(adapter.posts[0]).toMatchObject({ title: 'Offline mode', moderation: 'pending' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // Detail banner + detail pill, plus the new card's pill in the (hidden) list underneath.
    expect(await screen.findAllByText('Awaiting review')).toHaveLength(3);
  });

  it('shows the review queue for in-app admins and approves', async () => {
    const adapter = createMemoryAdapter({
      settings: { inAppAdmin: true },
      viewer: { id: 'boss', isAdmin: true },
      posts: [{ id: 'q1', title: 'Pending idea', moderation: 'pending' }],
    });
    render(<FeedbackBoard adapter={adapter} locale="en" initialTab="admin" />);
    await screen.findByText('Pending idea');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(adapter.posts[0]!.moderation).toBe('approved'));
    await screen.findByText('Nothing to review.');
  });
});

describe('styling', () => {
  it('applies theme tokens and slot overrides', async () => {
    render(
      <FeedbackBoard
        adapter={seed()}
        locale="en"
        theme={{ colors: { primary: '#123456' } }}
        styles={{ cardTitle: { color: 'rgb(1, 2, 3)', letterSpacing: 2 } }}
      />,
    );
    const title = await screen.findByText('Dark mode');
    expect(getComputedStyle(title).color).toBe('rgb(1, 2, 3)');
    const activeTab = screen.getByRole('tab', { name: 'Feedback' });
    expect(getComputedStyle(activeTab).borderBottomColor).toBe('rgb(18, 52, 86)');
  });

  it('replaces components entirely', async () => {
    const PostCard = vi.fn(({ post }: PostCardProps) => <Text>custom:{post.title}</Text>);
    render(<FeedbackBoard adapter={seed()} components={{ PostCard }} />);
    await screen.findByText('custom:Dark mode');
    expect(PostCard).toHaveBeenCalled();
  });

  it('localizes and accepts string overrides', async () => {
    render(<FeedbackBoard adapter={seed()} locale="nl-BE" strings={{ tabs: { board: 'Ideeën' } }} />);
    await screen.findByRole('tab', { name: 'Ideeën' });
    expect(screen.getByRole('tab', { name: 'Roadmap' })).toBeTruthy();
    expect(screen.getByText('Populair')).toBeTruthy();
  });
});

describe('composable screens', () => {
  it('renders an exported screen inside FeedbackProvider and reports events', async () => {
    const onOpen = vi.fn<(p: Post) => void>();
    const onEvent = vi.fn();
    render(
      <FeedbackProvider adapter={seed()} locale="en" onEvent={onEvent}>
        <FeedbackList onOpenPost={onOpen} hideToolbar />
      </FeedbackProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Widgets' }));
    expect(onOpen.mock.calls[0]![0].id).toBe('p2');
    expect(screen.queryByLabelText('Search feedback…')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Upvote' })[0]!);
    });
    await waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'voted' })));
  });
});
