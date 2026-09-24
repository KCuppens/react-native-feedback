# @kobecuppens/react-feedback

Part of **react-native-feedback**, a drop-in feedback & roadmap board with voting, moderation, comments, a roadmap and full theming.

See the main README for setup, styling layers, user signing and the hosted backend.

```tsx
import { FeedbackBoard } from '@kobecuppens/react-feedback';

<FeedbackBoard projectKey="pk_…" baseUrl="https://feedback.yourdomain.com" classNames={{ card: 'rounded-2xl' }} />
```

Styles are injected automatically (`injectStyles={false}` + `import '@kobecuppens/react-feedback/styles.css'` for SSR/CSP setups).
