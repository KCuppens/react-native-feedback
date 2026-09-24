import type { Post, VoteValue } from './types';

/** Optimistically apply the viewer's vote change to a post's counters. */
export function applyVote(post: Post, next: VoteValue): Post {
  const prev = post.myVote;
  if (prev === next) return post;
  let { upvotes, downvotes } = post;
  if (prev === 1) upvotes -= 1;
  if (prev === -1) downvotes -= 1;
  if (next === 1) upvotes += 1;
  if (next === -1) downvotes += 1;
  return { ...post, myVote: next, upvotes, downvotes, score: upvotes - downvotes };
}

/** Tapping the active arrow clears the vote; tapping the other one switches. */
export function nextVote(current: VoteValue, pressed: 1 | -1): VoteValue {
  return current === pressed ? 0 : pressed;
}
