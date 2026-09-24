import { createMemoryAdapter, FeedbackApiError, type Post } from '@kobecuppens/feedback-core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeedbackBoard, type PostCardProps } from '../src';

const seed = () => createMemoryAdapter({ posts: [{ id: 'p1', title: 'Dark mode', body: 'Please', score: 2, upvotes: 2 }] });

describe('accessibility and resilience', () => {
  it('moves between tabs with the arrow keys and keeps one tab stop', async () => {
    render(<FeedbackBoard adapter={seed()} locale="en" />);
    const board = await screen.findByRole('tab', { name: 'Feedback' });
    expect(board.tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Roadmap' }).tabIndex).toBe(-1);
    fireEvent.keyDown(board, { key: 'ArrowRight' });
    const roadmap = screen.getByRole('tab', { name: 'Roadmap' });
    await waitFor(() => expect(roadmap.getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(roadmap);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(roadmap.id);
  });

  it('focuses the new screen heading, and returns focus to the card on back', async () => {
    render(<FeedbackBoard adapter={seed()} locale="en" />);
    const card = await screen.findByRole('button', { name: 'Dark mode' });
    card.focus();
    fireEvent.click(card);
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'));
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('moves focus to the new post after submitting', async () => {
    render(<FeedbackBoard adapter={seed()} locale="en" />);
    fireEvent.click(await screen.findByRole('button', { name: /New idea/ }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Keyboard idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Keyboard idea'));
  });

  it('describes a crash as a generic failure, not a network problem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const PostCard = (): never => {
      throw new TypeError("Cannot read properties of undefined (reading 'title')");
    };
    render(<FeedbackBoard adapter={seed()} locale="en" components={{ PostCard }} />);
    await screen.findByText('Something went wrong.');
    expect(screen.queryByText('Check your connection and try again.')).toBeNull();
  });

  it('keeps vote counts visually hidden even when unstyled', async () => {
    render(<FeedbackBoard adapter={seed()} locale="en" unstyled />);
    const label = await screen.findByText('2 votes');
    expect(label.style.position).toBe('absolute');
    expect(label.style.clip).toBe('rect(0px, 0px, 0px, 0px)');
  });

  it('contains render errors from a broken override', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onEvent = vi.fn();
    const PostCard = ({ post }: PostCardProps): never => {
      throw new Error(`cannot render ${post.id}`);
    };
    render(<FeedbackBoard adapter={seed()} locale="en" components={{ PostCard }} onEvent={onEvent} />);
    await screen.findByText('Something went wrong.');
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('shows a localized message when sending a comment fails', async () => {
    const adapter = seed();
    adapter.createComment = () => Promise.reject(new FeedbackApiError(429, 'rate_limited', 'Slow down'));
    render(<FeedbackBoard adapter={adapter} locale="nl" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dark mode' }));
    fireEvent.change(await screen.findByLabelText('Schrijf een reactie…'), { target: { value: 'Hoi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Je gaat wat snel. Probeer het zo meteen opnieuw.');
  });

  it('names attachment links and reads vote counts on the roadmap', async () => {
    const adapter = createMemoryAdapter({
      posts: [
        {
          id: 'p1',
          title: 'With image',
          status: 'planned',
          score: 4,
          attachments: [{ id: 'a1', url: 'https://x/a.png', mime: 'image/png', width: null, height: null, bytes: 1 }],
        } as Partial<Post> & { title: string },
      ],
    });
    render(<FeedbackBoard adapter={adapter} locale="en" initialTab="roadmap" />);
    expect(await screen.findByText('4 votes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /With image/ }));
    expect(await screen.findByRole('link', { name: 'Open attachment 1' })).toBeTruthy();
  });

  it('keeps the fallback working when the Button or EmptyState override is what crashed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = (): never => {
      throw new Error('broken override');
    };
    // The card crashes, and the old fallback went through EmptyState, which crashes too.
    render(<FeedbackBoard adapter={seed()} locale="en" components={{ PostCard: broken, EmptyState: broken, Button: broken }} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('reads roadmap vote counts but hides them visually when unstyled', async () => {
    const adapter = createMemoryAdapter({ posts: [{ id: 'p1', title: 'Planned', status: 'planned', score: 3 }] });
    render(<FeedbackBoard adapter={adapter} locale="en" initialTab="roadmap" unstyled />);
    expect((await screen.findByText('3 votes')).style.position).toBe('absolute');
  });

  it('goes back on Escape inside the board, but ignores Escape pressed in the host app', async () => {
    render(
      <>
        <button type="button">Host button</button>
        <FeedbackBoard adapter={seed()} locale="en" />
      </>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Dark mode' }));
    const heading = await screen.findByRole('heading', { level: 2, name: 'Dark mode' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Host button' }), { key: 'Escape' });
    expect(screen.queryByRole('heading', { level: 2, name: 'Dark mode' })).toBe(heading);
    fireEvent.keyDown(heading, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: 'Dark mode' })).toBeNull());
  });

  it('cancels an open delete confirmation on Escape instead of leaving the post', async () => {
    const adapter = createMemoryAdapter({
      settings: { inAppAdmin: true },
      viewer: { id: 'me', isAdmin: true },
      posts: [{ id: 'p1', title: 'Dark mode' }],
    });
    render(<FeedbackBoard adapter={adapter} locale="en" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dark mode' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.keyDown(cancel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull());
    expect(screen.getByRole('heading', { level: 2, name: 'Dark mode' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
  });

  it('keeps a started draft when Escape is pressed in the submit form', async () => {
    const onDirtyChange = vi.fn();
    const host = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a stand-in for a host dialog's Escape listener
      <div onKeyDown={host}>
        <FeedbackBoard adapter={seed()} locale="en" onDirtyChange={onDirtyChange} />
      </div>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /New idea/ }));
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Half an idea' } });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Submit' }), { key: 'Escape' });
    expect(screen.getByLabelText('Title')).toBe(title);
    // Also with focus outside the form (the screen heading).
    fireEvent.keyDown(screen.getByRole('heading', { level: 2 }), { key: 'Escape' });
    expect(screen.getByLabelText('Title')).toBe(title);
    // Marked as handled, so a host dialog around the board does not close and lose it either.
    expect(fireEvent.keyDown(title, { key: 'Escape' })).toBe(false);
    expect(screen.getByRole('status', { name: '' }).textContent).toBe('Draft kept. Use Cancel to discard it.');
    expect(host).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    // A capture-phase host dialog (Radix) that already blocked Escape: still announced, anew.
    const status = screen.getByRole('status', { name: '' });
    const before = status.firstChild;
    const block = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener('keydown', block, true);
    try {
      fireEvent.keyDown(title, { key: 'Escape' });
    } finally {
      document.removeEventListener('keydown', block, true);
    }
    expect(status.firstChild).not.toBe(before);
    expect(status.textContent).toBe('Draft kept. Use Cancel to discard it.');
    expect(screen.getByLabelText('Title')).toBe(title);
  });

  it('keeps focus on a busy button so a failed request does not lose the user', async () => {
    const adapter = createMemoryAdapter({
      settings: { inAppAdmin: true },
      viewer: { id: 'me', isAdmin: true },
      posts: [{ id: 'p1', title: 'Dark mode', moderation: 'pending' }],
    });
    let fail = (_: unknown) => {};
    adapter.admin!.approve = () => new Promise((_, reject) => (fail = reject));
    render(<FeedbackBoard adapter={adapter} locale="en" initialTab="admin" />);
    fireEvent.click(await screen.findByRole('button', { name: /Dark mode/ }));
    const approve = await screen.findByRole('button', { name: 'Approve' });
    approve.focus();
    fireEvent.click(approve);
    // Busy: announced and inert, but still focusable (a disabled button would drop focus).
    await waitFor(() => expect(approve.getAttribute('aria-disabled')).toBe('true'));
    expect(approve.hasAttribute('disabled')).toBe(false);
    fail(new FeedbackApiError(500, 'server_error'));
    await screen.findByRole('alert');
    expect(approve.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(approve);
  });
});
