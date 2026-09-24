import type { ProjectSettings } from '@kobecuppens/feedback-core';

export interface EmailMessage {
  to: string;
  from: { email: string; name: string };
  subject: string;
  text: string;
  html: string;
}

export interface EventMessage {
  eventId: string;
}

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  EVENTS?: Queue<EventMessage>;
  EMAIL?: { send(message: EmailMessage): Promise<unknown> };
  ASSETS?: Fetcher;

  ENVIRONMENT?: string;
  /** Deployment-wide switches ("true"/"false"). Missing means off. */
  FEATURE_DASHBOARD?: string;
  FEATURE_ADMIN_API?: string;
  FEATURE_PUBLIC_BOARD?: string;
  FEATURE_EMAIL?: string;

  /** Dashboard superadmin password + JWT secret (wrangler secrets). */
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;

  /** Fallback recipient for moderation emails when a project has no adminEmail. */
  ADMIN_EMAIL?: string;
  FROM_EMAIL?: string;
  FROM_NAME?: string;
  /** Public origin, used in email links. Defaults to the request origin. */
  PUBLIC_URL?: string;
}

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  public_key: string;
  signing_secret: string;
  secret_key_hash: string;
  settings: string;
  created_at: number;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  publicKey: string;
  signingSecret: string;
  settings: ProjectSettings;
  createdAt: number;
}

export interface EndUserRow {
  id: string;
  project_id: string;
  external_id: string;
  is_anonymous: number;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_admin: number;
  last_seen_updates_at: number | null;
  created_at: number;
}

/** Who is making a public request. */
export interface Identity {
  externalId: string;
  anonymous: boolean;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  claimsAdmin: boolean;
}

export type AdminLevel = 'full' | 'moderator';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    project: Project;
    identity: Identity | null;
    /** Cached end-user row for the identity, once looked up. */
    viewer: EndUserRow | null | undefined;
    adminLevel: AdminLevel;
    requestId: string;
  };
};
