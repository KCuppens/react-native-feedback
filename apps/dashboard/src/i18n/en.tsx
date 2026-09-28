import type { ReactNode } from 'react';

type Toggle = { label: string; help: string };

export interface DashboardStrings {
  languageName: string;
  common: {
    loading: string;
    retry: string;
    cancel: string;
    close: string;
    save: string;
    delete: string;
    add: string;
    create: string;
    show: string;
    hide: string;
    copy: string;
    copied: string;
    copyFailed: string;
    team: string;
    language: string;
  };
  errors: {
    network: string;
    generic: string;
    session: string;
    notAllowed: string;
    notFound: string;
    conflict: string;
    slugTaken: string;
    rateLimited: string;
    tooLarge: string;
    invalidInput: string;
    wrongPassword: string;
  };
  login: { title: string; password: string; signIn: string; signingIn: string };
  shell: {
    brand: string;
    projects: string;
    pending: (n: number) => string;
    newProject: string;
    signOut: string;
    noProject: string;
    noProjectHelp: string;
    createProject: string;
    sections: string;
  };
  tabs: { queue: string; posts: string; roadmap: string; categories: string; webhooks: string; settings: string };
  create: {
    title: string;
    appName: string;
    createdTitle: string;
    createdAlert: string;
    publicKey: string;
    signingSecret: string;
    adminKey: string;
    copiedKey: string;
  };
  moderation: { pending: string; approved: string; declined: string };
  attachment: (n: number) => string;
  queue: {
    emptyTitle: string;
    emptyHelp: string;
    reasonPlaceholder: string;
    reasonLabel: string;
    approve: string;
    decline: string;
    declineMore: string;
  };
  posts: {
    searchPlaceholder: string;
    searchLabel: string;
    moderation: string;
    anyModeration: string;
    status: string;
    anyStatus: string;
    noMatch: string;
    columns: { title: string; score: string; comments: string; state: string; status: string; category: string; created: string };
    statusOf: (title: string) => string;
    categoryOf: (title: string) => string;
    firstPage: string;
    nextPage: string;
  };
  roadmap: { truncated: (n: number) => string; move: (title: string) => string };
  categories: {
    intro: string;
    empty: string;
    colourOf: (name: string) => string;
    nameOf: (name: string) => string;
    moveUp: (name: string) => string;
    moveDown: (name: string) => string;
    deleteQuestion: (name: string) => string;
    colour: string;
    newPlaceholder: string;
    newLabel: string;
  };
  webhooks: {
    intro: (code: { header: ReactNode; verify: ReactNode; pkg: ReactNode }) => ReactNode;
    empty: string;
    deleteQuestion: string;
    signingSecret: string;
    addEndpoint: string;
    urlLabel: string;
    events: string;
    addWebhook: string;
  };
  settings: {
    behaviour: string;
    toggles: Record<
      | 'autoApprove'
      | 'allowAnonymous'
      | 'allowDownvotes'
      | 'allowComments'
      | 'allowAttachments'
      | 'roadmapEnabled'
      | 'inAppAdmin'
      | 'publicBoard'
      | 'notifySubmitter',
      Toggle
    >;
    moderationEmail: string;
    moderationEmailPlaceholder: string;
    emailLanguage: string;
    emailLanguageHelp: string;
    publicBoard: string;
    keys: string;
    publicKey: string;
    signingSecret: string;
    newAdminKey: string;
    rotate: string;
    rotateAdmin: string;
    rotateAdminQuestion: string;
    rotateSigning: string;
    rotateSigningQuestion: string;
    rotatePublic: string;
    rotatePublicQuestion: string;
    rotateNote: string;
    install: string;
    project: string;
    projectName: string;
    rename: string;
    deleteProject: string;
    deleteWarning: (slug: ReactNode) => ReactNode;
    confirmSlug: string;
    deleteForever: string;
    appearance: {
      title: string;
      intro: string;
      colorScheme: string;
      schemes: Record<'system' | 'light' | 'dark', string>;
      logoUrl: string;
      homeUrl: string;
      fontsUrl: string;
      fontsHelp: string;
      theme: string;
      themeHelp: string;
      css: string;
      invalidTheme: string;
      save: string;
      reset: string;
    };
  };
  drawer: {
    label: string;
    votes: (up: number, down: number, score: number) => string;
    merged: string;
    declineReason: (reason: string) => string;
    reasonPlaceholder: string;
    reasonLabel: string;
    status: string;
    deletePost: string;
    deleteQuestion: string;
    findTarget: string;
    findTargetLabel: string;
    mergeInto: string;
    mergeIntoLabel: string;
    merge: string;
    comments: string;
    loadingComments: string;
    noComments: string;
    deleteCommentQuestion: string;
    loadMoreComments: string;
    replyPlaceholder: string;
    replyLabel: string;
    replyAsTeam: string;
  };
}

export const en: DashboardStrings = {
  languageName: 'English',
  common: {
    loading: 'Loading…',
    retry: 'Retry',
    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    delete: 'Delete',
    add: 'Add',
    create: 'Create',
    show: 'Show',
    hide: 'Hide',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    team: 'Team',
    language: 'Language',
  },
  errors: {
    network: 'Could not reach the server. Check your connection and retry.',
    generic: 'Something went wrong.',
    session: 'Your session has ended. Sign in again.',
    notAllowed: 'You are not allowed to do that.',
    notFound: 'This no longer exists. It may have been deleted.',
    conflict: 'This changed in the meantime. Reload and try again.',
    slugTaken: 'A project with this name already exists.',
    rateLimited: 'Too many attempts. Wait a moment and try again.',
    tooLarge: 'That is too large.',
    invalidInput: 'Check the values and try again.',
    wrongPassword: 'Wrong password.',
  },
  login: { title: 'Feedback admin', password: 'Password', signIn: 'Sign in', signingIn: 'Signing in…' },
  shell: {
    brand: 'Feedback',
    projects: 'Projects',
    pending: (n) => `${n} pending`,
    newProject: '＋ New project',
    signOut: 'Sign out',
    noProject: 'No project selected',
    noProjectHelp: 'Create a project for each app that embeds the board.',
    createProject: 'Create a project',
    sections: 'Sections',
  },
  tabs: {
    queue: 'Review queue',
    posts: 'All posts',
    roadmap: 'Roadmap',
    categories: 'Categories',
    webhooks: 'Webhooks',
    settings: 'Settings & keys',
  },
  create: {
    title: 'New project',
    appName: 'App name',
    createdTitle: 'Project created',
    createdAlert: "Project created. Copy the admin API key now: it is stored hashed and won't be shown again.",
    publicKey: 'Public key (in your app)',
    signingSecret: 'Signing secret (your server only)',
    adminKey: 'Admin API key (shown once)',
    copiedKey: "I've copied the key",
  },
  moderation: { pending: 'Pending', approved: 'Approved', declined: 'Declined' },
  attachment: (n) => `Attachment ${n} (opens in a new tab)`,
  queue: {
    emptyTitle: 'All caught up',
    emptyHelp: 'New submissions that need approval appear here.',
    reasonPlaceholder: 'Reason shown to the author (optional)',
    reasonLabel: 'Decline reason',
    approve: 'Approve',
    decline: 'Decline',
    declineMore: 'Decline…',
  },
  posts: {
    searchPlaceholder: 'Search title or body…',
    searchLabel: 'Search posts',
    moderation: 'Moderation',
    anyModeration: 'Any moderation',
    status: 'Status',
    anyStatus: 'Any status',
    noMatch: 'No posts match.',
    columns: {
      title: 'Title',
      score: 'Score',
      comments: 'Comments',
      state: 'State',
      status: 'Status',
      category: 'Category',
      created: 'Created',
    },
    statusOf: (title) => `Status of ${title}`,
    categoryOf: (title) => `Category of ${title}`,
    firstPage: 'First page',
    nextPage: 'Next page',
  },
  roadmap: {
    truncated: (n) => `Showing the top ${n}. Use All posts to see the rest.`,
    move: (title) => `Move ${title}`,
  },
  categories: {
    intro: 'Categories let users tag submissions (Feature, Bug, Improvement…) and filter the board.',
    empty: 'No categories yet. Add the first one below.',
    colourOf: (name) => `Colour of ${name}`,
    nameOf: (name) => `Name of ${name}`,
    moveUp: (name) => `Move ${name} up`,
    moveDown: (name) => `Move ${name} down`,
    deleteQuestion: (name) => `Delete "${name}"? Its posts become uncategorized.`,
    colour: 'Colour',
    newPlaceholder: 'New category',
    newLabel: 'New category name',
  },
  webhooks: {
    intro: ({ header, verify, pkg }) => (
      <>
        Events are POSTed as JSON with an {header} header. Verify it with {verify} from {pkg}, for example to send your own push
        notifications.
      </>
    ),
    empty: 'No webhooks yet.',
    deleteQuestion: 'Delete this webhook?',
    signingSecret: 'Signing secret',
    addEndpoint: 'Add endpoint',
    urlLabel: 'Webhook URL',
    events: 'Events',
    addWebhook: 'Add webhook',
  },
  settings: {
    behaviour: 'Board behaviour',
    toggles: {
      autoApprove: { label: 'Auto-approve submissions', help: 'Skip the review queue: new posts are public immediately.' },
      allowAnonymous: { label: 'Allow anonymous users', help: 'Users without a signed token can post and vote with a device id.' },
      allowDownvotes: { label: 'Allow downvotes', help: 'Otherwise only upvotes are possible.' },
      allowComments: { label: 'Allow comments', help: '' },
      allowAttachments: { label: 'Allow image attachments', help: 'Screenshots up to 5 MB.' },
      roadmapEnabled: { label: 'Show roadmap', help: 'Planned / In progress / Done columns.' },
      inAppAdmin: { label: 'In-app admin', help: 'Signed users with isAdmin: true can moderate inside the widget.' },
      publicBoard: { label: 'Public board page', help: 'Read-and-vote page at /p/<slug>.' },
      notifySubmitter: {
        label: 'Email submitters',
        help: "On approval, decline and status changes, in the language of the author's app (needs their email in the signed token).",
      },
    },
    moderationEmail: 'Moderation email',
    moderationEmailPlaceholder: 'Defaults to ADMIN_EMAIL on the worker',
    emailLanguage: 'Language of new-post emails',
    emailLanguageHelp: 'The emails sent to the moderation address. Emails to submitters use their own app language.',
    publicBoard: 'Public board:',
    keys: 'Keys',
    publicKey: 'Public key: pass as projectKey in your app',
    signingSecret: 'Signing secret: your server only, for signFeedbackUser()',
    newAdminKey: 'New admin API key (copy now, shown once)',
    rotate: 'Rotate',
    rotateAdmin: 'Rotate admin API key',
    rotateAdminQuestion: 'Scripts using the current key stop working. Rotate?',
    rotateSigning: 'Rotate signing secret',
    rotateSigningQuestion: 'Your servers must sign with the new secret. Rotate?',
    rotatePublic: 'Rotate public key',
    rotatePublicQuestion: 'Shipped app builds stop working until updated. Rotate?',
    rotateNote: 'Rotating the public key or signing secret breaks existing app builds and server tokens until you ship the new values.',
    install: 'Install',
    project: 'Project',
    projectName: 'Project name',
    rename: 'Rename',
    deleteProject: 'Delete project…',
    deleteWarning: (slug) => <>This deletes every post, vote, comment and image. Type {slug} to confirm.</>,
    confirmSlug: 'Confirm slug',
    deleteForever: 'Delete forever',
    appearance: {
      title: 'Public board appearance',
      intro: 'Match the public board page to your website. Board elements carry fb-<slot> classes for the CSS below.',
      colorScheme: 'Colour scheme',
      schemes: { system: 'Follow the device', light: 'Always light', dark: 'Always dark' },
      logoUrl: 'Logo URL',
      homeUrl: 'Logo links to',
      fontsUrl: 'Google Fonts URL',
      fontsHelp: 'A fonts.googleapis.com/css2 link for the fonts your theme names.',
      theme: 'Theme tokens (JSON)',
      themeHelp: 'Colours, fonts, radii and spacing, e.g. {"colors":{"primary":"#1a1a1a"},"radii":{"md":0}}.',
      css: 'Custom CSS',
      invalidTheme: 'The theme is not valid JSON.',
      save: 'Save appearance',
      reset: 'Reset to default',
    },
  },
  drawer: {
    label: 'Post',
    votes: (up, down, score) => `▲ ${up} · ▼ ${down} · score ${score}`,
    merged: 'Merged into another post.',
    declineReason: (reason) => `Decline reason: ${reason}`,
    reasonPlaceholder: 'Decline reason (optional)',
    reasonLabel: 'Decline reason',
    status: 'Status',
    deletePost: 'Delete post…',
    deleteQuestion: 'Delete permanently, including votes, comments and images?',
    findTarget: 'Find duplicate target…',
    findTargetLabel: 'Search merge target',
    mergeInto: 'Merge into…',
    mergeIntoLabel: 'Merge into',
    merge: 'Merge',
    comments: 'Comments',
    loadingComments: 'Loading comments…',
    noComments: 'No comments yet.',
    deleteCommentQuestion: 'Delete this comment?',
    loadMoreComments: 'Load more comments',
    replyPlaceholder: 'Official reply (shown with a Team badge)',
    replyLabel: 'Official reply',
    replyAsTeam: 'Reply as team',
  },
};
