# Quick Deployment Guide

## 1. Push to GitHub

```powershell
cd nextjs-app
git remote add origin https://github.com/YOUR_USERNAME/safebill-nextjs.git
git branch -M main
git push -u origin main
```

## 2. Deploy to Vercel

1. Open `https://vercel.com/new`
2. Import your repository
3. Add env vars:

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
NEXT_PUBLIC_APP_API_BASE_URL=/api
BACKEND_API_BASE_URL=https://your-backend-domain
BACKEND_API_SERVICE_TOKEN=
BACKEND_API_TIMEOUT_MS=45000
```

4. Click Deploy

## 3. Done Checklist

- Scan page can upload PDF/image
- Locker shows ingested documents
- Chat returns grounded answers
- Reminders list renders

For full details, see `DEPLOYMENT.md`.
