# Deployment Guide

This guide deploys the Next.js app to Vercel and connects it to a backend running on Neon Postgres + Pinecone.

## Prerequisites

- GitHub account
- Vercel account
- A deployed backend URL (FastAPI)
- Backend configured with Neon + Pinecone env vars

## Step 1: Push to GitHub

```bash
cd nextjs-app
git init
git add .
git commit -m "Initial commit: SafeBill Next.js app"
git remote add origin https://github.com/YOUR_USERNAME/safebill-nextjs.git
git branch -M main
git push -u origin main
```

## Step 2: Deploy on Vercel

1. Go to `https://vercel.com/new`.
2. Import your repository.
3. Use default Next.js build settings.

## Step 3: Set Vercel Environment Variables

Add these:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
NEXT_PUBLIC_APP_API_BASE_URL=/api
BACKEND_API_BASE_URL=https://your-backend-domain
BACKEND_API_SERVICE_TOKEN=
BACKEND_API_TIMEOUT_MS=45000
```

Notes:

- `BACKEND_API_BASE_URL` should be backend origin without `/api/v1`.
- User JWTs are forwarded from Next.js API routes to backend per request.
- `SUPABASE_SERVICE_ROLE_KEY` is required for secure custom ID lookup route.
- Keep `NEXT_PUBLIC_APP_API_BASE_URL` as `/api` in most cases.

## Step 4: Verify E2E

After deploy, test:

- `/scan` (PDF/image upload and ingestion)
- `/locker` (document list)
- `/document/:id` (detail + delete)
- `/chat` (RAG answers)
- `/reminders` (warranty reminders)

## Troubleshooting

- API failures:
  - Check `BACKEND_API_BASE_URL` and token.
  - Check backend CORS and availability.
- Empty RAG responses:
  - Confirm backend has `OPENAI_API_KEY`.
  - Confirm Pinecone index exists and matches embedding dimensions.
  - Confirm data was ingested successfully.
