# react-native-feedback

A drop-in feedback & roadmap board for all your apps. Users submit ideas and bugs, vote them up or down, comment and follow the roadmap. You approve, decline, reply and move items along. One hosted backend serves every app; each app styles the board to look native.

| Package | What |
|---|---|
| [`@kobecuppens/react-native-feedback`](packages/native) | React Native / Expo components (also run on react-native-web) |
| [`@kobecuppens/react-feedback`](packages/react) | React DOM components (Next.js, Vite, …) |
| [`@kobecuppens/feedback-core`](packages/core) | Types, API clients, headless hooks, theme tokens, i18n (EN/NL/FR), server signing helpers, in-memory adapter |
| [`apps/worker`](apps/worker) | Cloudflare Worker API (Hono + D1 + R2 + Queues + Email), serves the dashboard and public board |
| [`apps/dashboard`](apps/dashboard) | Admin SPA at `/admin/`: review queue, posts, kanban roadmap, replies, categories, webhooks, settings & keys |
| [`apps/public-board`](apps/public-board) | Public read-and-vote page at `/p/<slug>` |
| [`apps/example-expo`](apps/example-expo) | Expo demo, offline by default, with three brand themes |

## Add it to an app

```bash
npx expo install @kobecuppens/react-native-feedback @react-native-async-storage/async-storage expo-image-picker
```

```tsx
import { FeedbackBoard } from '@kobecuppens/react-native-feedback';

export function FeedbackScreen() {
  return (
    <FeedbackBoard
      projectKey="pk_…"                      // from the dashboard
      baseUrl="https://feedback.yourdomain.com"
      userToken={session.feedbackToken}      // signed on your server, see below (omit for anonymous)
    />
  );
}
```

On the web:

```tsx
import { FeedbackBoard } from '@kobecuppens/react-feedback'; // styles are injected automatically
<FeedbackBoard projectKey="pk_…" baseUrl="https://feedback.yourdomain.com" userToken={token} />
```

### Identify users (recommended)

Sign the user on **your** server with the project's signing secret; never ship the secret to clients. Tokens last 24h; pass `getUserToken` to refresh.

```ts
import { signFeedbackUser } from '@kobecuppens/feedback-core/server'; // Node 18+, Workers, Deno, Bun

const feedbackToken = await signFeedbackUser(
  { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar, isAdmin: user.isStaff },
  process.env.FEEDBACK_SIGNING_SECRET!,
);
```

Without a token, users are anonymous (a device id in AsyncStorage/localStorage), when the project allows it. `email` is only used to notify the submitter of status changes. `isAdmin` only takes effect when the project enables **in-app admin**.

## Styling

Each app can restyle the board in up to four layers, from light-touch to full control.

```tsx
<FeedbackBoard
  projectKey="pk_…"
  // 1. Tokens: colours, fonts, radii, spacing. Per scheme, or one theme.
  theme={{
    light: { colors: { primary: '#1F3D2B', background: '#F7F4EF' }, fonts: { heading: 'Fraunces' }, radii: { lg: 20 } },
    dark: { colors: { primary: '#C9E4C5' } },
  }}
  colorScheme="system"                       // 'light' | 'dark' | 'system'
  // 2. Slots: override the style of any part (see SLOT_NAMES)
  styles={{ card: { borderWidth: 0 }, cardTitle: { letterSpacing: 0.2 }, fab: { borderRadius: 14 } }}
  // 3. Components: replace building blocks entirely
  components={{ PostCard: MyPostCard, VoteControl: MyVoteControl, Button: MyButton }}
  // 4. Strings: built-in en / nl / fr (auto-detected), override any string
  locale="nl"
  strings={{ tabs: { board: 'Ideeën' } }}
/>
```

The React DOM package also takes `classNames={{ card: 'rounded-2xl shadow' }}` (Tailwind or CSS modules) and `unstyled` to drop the built-in CSS. Its default rules use `:where()` (zero specificity), so your classes always win. Theme tokens are exposed as CSS variables (`--fb-color-primary`, `--fb-radius-md`, …).

### Headless / custom navigation

Every screen is exported for use inside your own navigator, and every hook for fully custom UIs:

```tsx
<FeedbackProvider projectKey="pk_…" userToken={token} theme={theme}>
  <FeedbackList onOpenPost={(p) => nav.push('Post', { id: p.id })} onNewPost={() => nav.push('NewPost')} />
</FeedbackProvider>
// also: FeedbackDetail, FeedbackSubmit, FeedbackRoadmap, FeedbackUpdates, FeedbackAdminQueue, FeedbackUpdatesBadge
// hooks: usePosts, usePost, useVote, useCreatePost, useComments, useRoadmap, useUpdates, useModeration, useFeatures, …
```

`<FeedbackUpdatesBadge />` shows the user's unseen status changes (e.g. on your tab-bar icon).

### Your own backend

Pass `adapter` instead of `projectKey` to plug in any backend that implements `FeedbackAdapter`. `createMemoryAdapter()` is a complete in-memory backend for tests, Storybook and demos.

## Moderation & flags

New posts are **pending**: visible only to their author ("Awaiting review") until you approve them. Declined posts show the author your reason. Admin surfaces are all optional:

| Switch | Where | Effect |
|---|---|---|
| `FEATURE_DASHBOARD` | worker var | `/admin/` dashboard + `/v1/dashboard/*` (404 when off) |
| `FEATURE_ADMIN_API` | worker var | `Authorization: Bearer sk_…` access to `/v1/admin/*` |
| `FEATURE_PUBLIC_BOARD` | worker var | `/p/<slug>` pages (each project must also enable `publicBoard`) |
| `FEATURE_EMAIL` | worker var | Moderation + submitter emails |
| `autoApprove`, `inAppAdmin`, `publicBoard`, `allowAnonymous`, `allowDownvotes`, `allowComments`, `allowAttachments`, `roadmapEnabled`, `notifySubmitter`, `adminEmail` | per project (dashboard / admin API) | Enforced by the server |
| `features={{ roadmap: false, … }}` | component prop | Can only **hide** things; never enables what the server disallows |

With the dashboard off, create projects from the CLI:

```bash
cd apps/worker && npm run project:create -- --name "1% Better" --remote --env production
```

…then moderate with the admin API (`createAdminClient({ baseUrl, secretKey })` from core), in-app admin, or both.

## Webhooks

Configure per project in the dashboard or `POST /v1/admin/webhooks`. Events: `post.created`, `post.approved`, `post.declined`, `post.status_changed`, `post.merged`, `post.deleted`, `comment.created`. Verify with `verifyWebhook(secret, rawBody, req.headers['x-feedback-signature'])` from `@kobecuppens/feedback-core/server`. Use this to send your own push notifications.

**Delivery.** Each event is POSTed once, **at most once**: the worker claims the event before sending, tries your endpoint twice (10s timeout each), and does not retry later. Answer `2xx` quickly and do heavy work asynchronously. Use `id` to deduplicate if you process events elsewhere too.

```json
{
  "id": "5f0c…",
  "type": "post.status_changed",
  "projectId": "…",
  "createdAt": 1767225600000,
  "data": { "post": { "id": "…", "title": "Dark mode", "status": "planned", "…": "…" }, "previousStatus": "open" }
}
```

## Deploy the backend

```bash
cd apps/worker
wrangler d1 create feedback            # paste the id into wrangler.jsonc (env.production)
wrangler r2 bucket create feedback-files
wrangler queues create feedback-events && wrangler queues create feedback-events-dlq
wrangler secret put ADMIN_PASSWORD --env production    # 12+ chars
wrangler secret put SESSION_SECRET --env production    # 32+ random chars
# set FROM_EMAIL (a Cloudflare Email Sending domain) and ADMIN_EMAIL in wrangler.jsonc
npm run db:migrate:remote
cd ../.. && npm run deploy   # typecheck, test, build the web apps, migrate D1, deploy
```

Set `DEFAULT_API_URL` in `packages/core/src/hosted.ts` to your deployed URL, so apps can omit `baseUrl`.

## Develop

```bash
npm install
npm test           # core, native (via react-native-web in jsdom), react, worker (D1 on node:sqlite)
npm run typecheck
npm run build      # publishable dist/ for the three packages
```

Local stack: `cp apps/worker/.dev.vars.example apps/worker/.dev.vars`, `npm run db:migrate:local -w @feedback/worker`, `npm run dev -w @feedback/worker` (API on :8787), then `npm run dev -w @feedback/dashboard` (proxies `/v1`).
