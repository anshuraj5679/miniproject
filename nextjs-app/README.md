# SafeBill Next.js App

A modern Next.js web application for managing warranties and claims, migrated from the Flutter mobile app.

## Features

- ✅ **Onboarding Screen** - Beautiful welcome screen with hero animation
- ✅ **Authentication** - Consumer/Merchant login with Google OAuth support
- ✅ **Locker Dashboard** - Main consumer dashboard with:
  - Quick scan invoice action
  - Active warranties and asset value stats
  - Category filters (Gadgets, Appliances, Vehicle, Others)
  - Expiring soon list
  - Bottom navigation
- ✅ **Merchant Dashboard** - For merchants to assign bills to consumers
- ✅ **Scan Screen** - Upload and process invoices with AI extraction
- ✅ **Document Detail** - View detailed warranty information
- ✅ **Chat Assistant** - AI-powered chat for warranty questions
- ✅ **Reminders** - View and manage warranty expiry reminders
- ✅ **Claim Wizard** - Generate claim letters for denied warranties
- ✅ **Settings** - Theme toggle, local-only mode, OCR preferences

## Tech Stack

- **Next.js 14** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Zustand** - Lightweight state management
- **Axios** - HTTP client for API calls
- **Lucide React** - Icon library
- **date-fns** - Date formatting

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn
- Backend API running at `http://localhost:8000` (or your deployed backend URL)

### Local Development

1. Install dependencies:
```bash
cd nextjs-app
npm install
```

2. Create `.env.local` file:
```bash
cp .env.local.example .env.local
```

3. Update `.env.local` with your configuration:
```env
NEXT_PUBLIC_COGNITO_REGION=your-aws-region
NEXT_PUBLIC_COGNITO_DOMAIN=your-cognito-domain
NEXT_PUBLIC_COGNITO_CLIENT_ID=your-cognito-client-id
NEXT_PUBLIC_COGNITO_REDIRECT_URI=http://localhost:3000/auth/callback
NEXT_PUBLIC_COGNITO_LOGOUT_URI=http://localhost:3000/login
NEXT_PUBLIC_COGNITO_SCOPE=openid email profile
COGNITO_REGION=your-aws-region
COGNITO_DOMAIN=your-cognito-domain
COGNITO_CLIENT_ID=your-cognito-client-id
COGNITO_CLIENT_SECRET=your-cognito-client-secret
COGNITO_REDIRECT_URI=http://localhost:3000/auth/callback
NEXT_PUBLIC_APP_API_BASE_URL=/api
BACKEND_API_BASE_URL=http://localhost:8000
BACKEND_API_SERVICE_TOKEN=
BACKEND_API_TIMEOUT_MS=45000
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Deployment

#### Quick Deploy to AWS Amplify

1. **Push to GitHub** (see `GITHUB_SETUP.md`):
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/safebill-nextjs.git
   git branch -M main
   git push -u origin main
   ```

2. **Deploy to AWS Amplify**:
   - Open AWS Amplify Console
   - Connect your GitHub repository
   - Set app root to `nextjs-app`
   - Add environment variables (see `DEPLOYMENT.md`)
   - Deploy

For detailed instructions, see:
- `QUICK_DEPLOY.md` - Fast deployment guide
- `GITHUB_SETUP.md` - GitHub setup
- `DEPLOYMENT.md` - Complete AWS deployment guide

## Project Structure

```
nextjs-app/
├── app/                    # Next.js App Router pages
│   ├── page.tsx           # Home/Onboarding
│   ├── landing/           # Landing/Auth page
│   ├── locker/            # Consumer dashboard
│   ├── merchant-dashboard/# Merchant dashboard
│   ├── scan/              # Scan invoice page
│   ├── chat/              # AI chat assistant
│   ├── reminders/         # Reminders list
│   ├── claims/            # Claim wizard
│   ├── settings/          # Settings page
│   └── document/[id]/     # Document detail page
├── components/            # React components
├── lib/                   # Utilities and stores
│   ├── api-client.ts      # API client
│   ├── types.ts           # TypeScript types
│   └── store/             # Zustand stores
└── public/                # Static assets
```

## Backend Integration

The app routes all business APIs through Next.js `/api/*` handlers, which proxy to the backend RAG API configured via:

- `BACKEND_API_BASE_URL`
- `BACKEND_API_SERVICE_TOKEN` (optional)

### API Endpoints Used

- `POST /api/scan` -> backend ingest (`/api/v1/ingest/pdf` and `/api/v1/ingest/image`)
- `POST /api/chat` -> backend ask (`/api/v1/ask`)
- `GET /api/documents` -> backend documents list
- `GET /api/documents/:id` -> backend document details
- `DELETE /api/documents/:id` -> backend delete
- `GET /api/reminders` -> backend reminders

## Features Comparison with Flutter App

All features from the Flutter app have been retained:

| Feature | Flutter | Next.js | Status |
|---------|---------|---------|--------|
| Onboarding | ✅ | ✅ | Complete |
| Auth (Consumer/Merchant) | ✅ | ✅ | Complete |
| Google OAuth | ✅ | ✅ | Complete |
| Locker Dashboard | ✅ | ✅ | Complete |
| Scan Invoice | ✅ | ✅ | Complete |
| Document Detail | ✅ | ✅ | Complete |
| AI Chat | ✅ | ✅ | Complete |
| Reminders | ✅ | ✅ | Complete |
| Claim Wizard | ✅ | ✅ | Complete |
| Settings | ✅ | ✅ | Complete |
| Theme Toggle | ✅ | ✅ | Complete |
| Bottom Navigation | ✅ | ✅ | Complete |

## Development

### Build for Production

```bash
npm run build
npm start
```

### Linting

```bash
npm run lint
```

## Environment Variables

- `NEXT_PUBLIC_COGNITO_REGION` - AWS region for Cognito
- `NEXT_PUBLIC_COGNITO_DOMAIN` - Cognito hosted UI domain
- `NEXT_PUBLIC_COGNITO_CLIENT_ID` - Cognito app client id
- `NEXT_PUBLIC_COGNITO_REDIRECT_URI` - OAuth callback URL
- `COGNITO_CLIENT_SECRET` - Cognito app client secret for server-side code exchange
- `NEXT_PUBLIC_APP_API_BASE_URL` - Frontend API base (default `/api`)
- `BACKEND_API_BASE_URL` - Backend RAG origin (local or deployed)
- `BACKEND_API_SERVICE_TOKEN` - Optional backend token for server-only fallback calls
- `BACKEND_API_TIMEOUT_MS` - Optional proxy timeout in milliseconds

## Notes

- The app uses localStorage for client-side state persistence
- Authentication tokens are stored in localStorage
- Theme preferences are persisted across sessions
- The app is fully responsive and works on mobile, tablet, and desktop

## License

MIT

