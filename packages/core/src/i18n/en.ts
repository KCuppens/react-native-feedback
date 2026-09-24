import type { PostStatus, PostSort } from '../types';

export interface FeedbackStrings {
  /** BCP-47 tag used to format dates, e.g. 'nl'. */
  dateLocale: string;
  common: { loading: string };
  tabs: { board: string; roadmap: string; updates: string; admin: string };
  sort: Record<PostSort, string>;
  status: Record<PostStatus, string>;
  moderation: { pending: string; declined: string; declinedWithReason: (reason: string) => string };
  list: {
    searchPlaceholder: string;
    allCategories: string;
    allStatuses: string;
    empty: string;
    emptySearch: string;
    newPost: string;
    loadMore: string;
  };
  post: {
    comments: (n: number) => string;
    votes: (n: number) => string;
    upvote: string;
    downvote: string;
    by: (name: string) => string;
    anonymous: string;
    official: string;
    mergedInto: string;
    openAttachment: (n: number) => string;
    back: string;
    attachments: string;
  };
  comments: {
    title: string;
    placeholder: string;
    send: string;
    empty: string;
    disabled: string;
  };
  submit: {
    title: string;
    titleLabel: string;
    titlePlaceholder: string;
    bodyLabel: string;
    bodyPlaceholder: string;
    categoryLabel: string;
    attach: string;
    removeAttachment: string;
    submit: string;
    submitting: string;
    successPending: string;
    successPublished: string;
    cancel: string;
    done: string;
    tooLong: (max: number) => string;
    required: string;
  };
  roadmap: { empty: string };
  updates: {
    empty: string;
    approved: string;
    declined: string;
    statusChanged: (status: string) => string;
    officialReply: string;
  };
  admin: {
    queue: string;
    queueEmpty: string;
    approve: string;
    decline: string;
    declineReasonPlaceholder: string;
    confirmDecline: string;
    changeStatus: string;
    changeCategory: string;
    delete: string;
    confirmDelete: string;
    cancel: string;
  };
  errors: {
    generic: string;
    retry: string;
    network: string;
    notAllowed: string;
    uploadTooLarge: string;
    rateLimited: string;
    signIn: string;
    boardNotFound: string;
    boardLoadFailed: string;
  };
  time: {
    justNow: string;
    minutes: (n: number) => string;
    hours: (n: number) => string;
    days: (n: number) => string;
  };
}

export const en: FeedbackStrings = {
  dateLocale: 'en',
  common: { loading: 'Loading…' },
  tabs: { board: 'Feedback', roadmap: 'Roadmap', updates: 'Updates', admin: 'Review' },
  sort: { top: 'Top', new: 'New', trending: 'Trending' },
  status: {
    open: 'Open',
    under_review: 'Under review',
    planned: 'Planned',
    in_progress: 'In progress',
    done: 'Done',
    closed: 'Closed',
  },
  moderation: {
    pending: 'Awaiting review',
    declined: 'Declined',
    declinedWithReason: (reason) => `Declined: ${reason}`,
  },
  list: {
    searchPlaceholder: 'Search feedback…',
    allCategories: 'All',
    allStatuses: 'Any status',
    empty: 'No feedback yet. Be the first to share an idea!',
    emptySearch: 'Nothing matches your search.',
    newPost: 'New idea',
    loadMore: 'Load more',
  },
  post: {
    comments: (n) => (n === 1 ? '1 comment' : `${n} comments`),
    votes: (n) => (n === 1 ? '1 vote' : `${n} votes`),
    upvote: 'Upvote',
    downvote: 'Downvote',
    by: (name) => `by ${name}`,
    anonymous: 'Anonymous',
    official: 'Team',
    mergedInto: 'Merged into another post',
    openAttachment: (n) => `Open attachment ${n}`,
    back: 'Back',
    attachments: 'Attachments',
  },
  comments: {
    title: 'Comments',
    placeholder: 'Add a comment…',
    send: 'Send',
    empty: 'No comments yet.',
    disabled: 'Comments are turned off.',
  },
  submit: {
    title: 'Share an idea',
    titleLabel: 'Title',
    titlePlaceholder: 'Short, descriptive title',
    bodyLabel: 'Details',
    bodyPlaceholder: 'What problem would this solve? How would it work?',
    categoryLabel: 'Category',
    attach: 'Add screenshot',
    removeAttachment: 'Remove',
    submit: 'Submit',
    submitting: 'Submitting…',
    successPending: 'Thanks! Your post will appear once it has been reviewed.',
    successPublished: 'Thanks! Your post is live.',
    cancel: 'Cancel',
    done: 'Done',
    tooLong: (max) => `Keep it under ${max} characters.`,
    required: 'Required',
  },
  roadmap: { empty: 'Nothing here yet.' },
  updates: {
    empty: "You're all caught up.",
    approved: 'Your post was approved',
    declined: 'Your post was declined',
    statusChanged: (status) => `Moved to ${status}`,
    officialReply: 'The team replied',
  },
  admin: {
    queue: 'Review queue',
    queueEmpty: 'Nothing to review.',
    approve: 'Approve',
    decline: 'Decline',
    declineReasonPlaceholder: 'Reason (optional, shown to the author)',
    confirmDecline: 'Decline post',
    changeStatus: 'Status',
    changeCategory: 'Category',
    delete: 'Delete',
    confirmDelete: 'Delete this post permanently?',
    cancel: 'Cancel',
  },
  errors: {
    generic: 'Something went wrong.',
    retry: 'Try again',
    network: 'Check your connection and try again.',
    notAllowed: "You can't do that here.",
    uploadTooLarge: 'That file is too large.',
    rateLimited: "You're going a bit fast. Try again in a little while.",
    signIn: 'Please sign in again to continue.',
    boardNotFound: "This board doesn't exist or isn't public.",
    boardLoadFailed: "Couldn't load this board. Check your connection and try again.",
  },
  time: {
    justNow: 'just now',
    minutes: (n) => `${n}m ago`,
    hours: (n) => `${n}h ago`,
    days: (n) => `${n}d ago`,
  },
};
