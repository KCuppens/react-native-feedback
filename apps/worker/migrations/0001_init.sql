-- Timestamps are unix epoch milliseconds.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  signing_secret TEXT NOT NULL,
  secret_key_hash TEXT NOT NULL UNIQUE,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE end_users (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  email TEXT,
  avatar_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  last_seen_updates_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, external_id)
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX categories_project ON categories (project_id, sort);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES end_users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  moderation TEXT NOT NULL DEFAULT 'pending',
  decline_reason TEXT,
  merged_into_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  score INTEGER NOT NULL DEFAULT 0,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status_changed_at INTEGER,
  moderated_at INTEGER,
  last_official_reply_at INTEGER
);
CREATE INDEX posts_board ON posts (project_id, moderation, score DESC);
CREATE INDEX posts_new ON posts (project_id, moderation, created_at DESC);
CREATE INDEX posts_status ON posts (project_id, status);
CREATE INDEX posts_author ON posts (author_id);
-- Merges look up and repoint children; deletes check the SET NULL references.
CREATE INDEX posts_merged ON posts (merged_into_id) WHERE merged_into_id IS NOT NULL;
CREATE INDEX posts_category ON posts (category_id) WHERE category_id IS NOT NULL;

CREATE TABLE votes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES end_users(id) ON DELETE CASCADE,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX votes_user ON votes (user_id);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES end_users(id),
  body TEXT NOT NULL,
  is_official INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX comments_post ON comments (post_id, created_at);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES end_users(id),
  post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX attachments_post ON attachments (post_id);
CREATE INDEX attachments_comment ON attachments (comment_id);
CREATE INDEX attachments_project ON attachments (project_id);
-- Lets the hourly sweep find uploads that were never attached to a post.
CREATE INDEX attachments_unclaimed ON attachments (created_at) WHERE post_id IS NULL;

CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX webhooks_project ON webhooks (project_id);

-- Outbox: every notable change lands here and is fanned out by the queue consumer.
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  post_id TEXT,
  actor_id TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX events_project ON events (project_id, created_at DESC);
CREATE INDEX events_unprocessed ON events (created_at) WHERE processed_at IS NULL;

-- Fixed-window counters for limits that cannot key on a user (logins, anonymous devices by IP).
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
