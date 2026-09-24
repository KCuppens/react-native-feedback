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
});
