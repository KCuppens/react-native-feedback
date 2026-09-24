import { createMemoryAdapter, FeedbackApiError } from '@kobecuppens/feedback-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackBoard, type PostCardProps } from '../src';

const seed = () =>
  createMemoryAdapter({
    categories: [{ id: 'bug', name: 'Bug', color: '#DC2626', sort: 0 }],
    posts: [
      { id: 'p1', title: 'Dark mode', body: 'Please', score: 5, upvotes: 5 },
      { id: 'p2', title: 'Widgets', score: 2, upvotes: 2, status: 'planned' },
    ],
  });

describe('<FeedbackBoard> (DOM)', () => {
  it('renders, injects styles once and exposes theme as CSS variables', async () => {
    const { container } = render(<FeedbackBoard adapter={seed()} locale="en" theme={{ colors: { primary: '#ff0066' } }} />);
    await screen.findByText('Dark mode');
    expect(document.querySelectorAll('#rnf-feedback-styles')).toHaveLength(1);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('fb-root');
    expect(root.style.getPropertyValue('--fb-color-primary')).toBe('#ff0066');
  });

  it('adds classNames and inline styles per slot, or drops defaults when unstyled', async () => {
    const first = render(
      <FeedbackBoard adapter={seed()} locale="en" classNames={{ card: 'rounded-xl shadow' }} styles={{ cardTitle: { letterSpacing: '2px' } }} />,
    );
    const title = await screen.findByText('Dark mode');
    expect(title.closest('article')!.className).toBe('fb-card rounded-xl shadow');
    expect(title.style.letterSpacing).toBe('2px');
    first.unmount();

    render(<FeedbackBoard adapter={seed()} locale="en" unstyled classNames={{ card: 'my-card' }} />);
    const bare = await screen.findByText('Dark mode');
    expect(bare.closest('article')!.className).toBe('my-card');
    expect(bare.className).toBe('');
  });

  it('votes, opens a post and comments', async () => {
    const adapter = seed();
    render(<FeedbackBoard adapter={adapter} locale="en" />);
    await screen.findByText('Widgets');
    fireEvent.click(screen.getAllByRole('button', { name: 'Upvote' })[1]!);
    await waitFor(() => expect(adapter.posts.find((p) => p.id === 'p2')!.myVote).toBe(1));
    expect(screen.getAllByRole('button', { name: 'Upvote' })[1]!.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    await screen.findByText('Please');
    fireEvent.change(screen.getByLabelText('Add a comment…'), { target: { value: 'Agreed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Agreed');
  });

  it('submits through a real form (French UI)', async () => {
    const adapter = seed();
    render(<FeedbackBoard adapter={adapter} locale="fr" />);
    fireEvent.click(await screen.findByRole('button', { name: /Nouvelle idée/ }));
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Mode hors ligne' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bug' }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    await screen.findByText('Merci ! Votre suggestion apparaîtra après validation.');
    expect(adapter.posts[0]).toMatchObject({ title: 'Mode hors ligne', moderation: 'pending', category: { id: 'bug' } });
  });

  it('rolls back an optimistic vote when the server rejects it', async () => {
    const adapter = seed();
    adapter.vote = () => Promise.reject(new FeedbackApiError(500, 'boom'));
    const onEvent = vi.fn();
    render(<FeedbackBoard adapter={adapter} locale="en" onEvent={onEvent} />);
    await screen.findByText('Widgets');
    const up = () => screen.getAllByRole('button', { name: 'Upvote' })[1]!;
    fireEvent.click(up());
    await waitFor(() => expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(up().getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('2 votes')).toBeTruthy();
  });

  it('replaces components', async () => {
    const PostCard = ({ post }: PostCardProps) => <div data-testid="custom">{post.title.toUpperCase()}</div>;
    render(<FeedbackBoard adapter={seed()} components={{ PostCard }} />);
    expect(await screen.findByText('DARK MODE')).toBeTruthy();
  });
});
