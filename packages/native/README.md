# @kobecuppens/react-native-feedback

Part of **react-native-feedback**, a drop-in feedback & roadmap board with voting, moderation, comments, a roadmap and full theming.

See the main README for setup, styling layers, user signing and the hosted backend.

```tsx
import { FeedbackBoard } from '@kobecuppens/react-native-feedback';

<FeedbackBoard projectKey="pk_…" baseUrl="https://feedback.yourdomain.com" userToken={token} theme={{ colors: { primary: '#1F3D2B' } }} />
```

Optional peers: `@react-native-async-storage/async-storage` (persists the anonymous id) and `expo-image-picker` (screenshot attachments; or pass `pickImage`).
