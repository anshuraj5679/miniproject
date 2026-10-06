# AWS Deployment Guide (Next.js Frontend)

This guide deploys the Next.js app on AWS Amplify Hosting and connects it to the AWS-hosted backend API.

## Target Architecture

- Frontend: AWS Amplify Hosting (Next.js SSR)
- Auth: Amazon Cognito (Hosted UI + Google federated identity)
- Backend: API Gateway + Lambda (or ECS Fargate)
- Storage/AI/Comms: S3, Bedrock, Textract, SNS, SES

## 1) Prerequisites

- AWS account with access to Amplify, Cognito, Route53 (optional), ACM (optional)
- GitHub repository for this project
- Backend deployed on AWS (see `../backend/infra/AWS_DEPLOY.md`)

## 2) Deploy Frontend on Amplify

1. Open Amplify Console.
2. Create a new app and connect your GitHub repository.
3. Set app root to `nextjs-app`.
4. Use the included `amplify.yml` build config in this folder.

## 3) Amplify Environment Variables

Set these in Amplify (App settings -> Environment variables):

```env
NEXT_PUBLIC_COGNITO_REGION=ap-south-1
NEXT_PUBLIC_COGNITO_DOMAIN=your-cognito-domain-prefix.auth.ap-south-1.amazoncognito.com
NEXT_PUBLIC_COGNITO_CLIENT_ID=your-cognito-app-client-id
NEXT_PUBLIC_COGNITO_REDIRECT_URI=https://your-frontend-domain/auth/callback
NEXT_PUBLIC_COGNITO_LOGOUT_URI=https://your-frontend-domain/login
NEXT_PUBLIC_COGNITO_SCOPE=openid email profile

COGNITO_REGION=ap-south-1
COGNITO_DOMAIN=your-cognito-domain-prefix.auth.ap-south-1.amazoncognito.com
COGNITO_CLIENT_ID=your-cognito-app-client-id
COGNITO_CLIENT_SECRET=your-cognito-client-secret
COGNITO_REDIRECT_URI=https://your-frontend-domain/auth/callback
COGNITO_LOGOUT_URI=https://your-frontend-domain/login
COGNITO_SCOPE=openid email profile

NEXT_PUBLIC_APP_API_BASE_URL=/api
BACKEND_API_BASE_URL=https://your-api-gateway-domain-or-alb-domain
BACKEND_API_SERVICE_TOKEN=
BACKEND_API_TIMEOUT_MS=45000
```

## 4) Cognito App Client URLs

In Cognito app client configuration, set:

- Allowed callback URL: `https://your-frontend-domain/auth/callback`
- Allowed sign-out URL: `https://your-frontend-domain/login`

These must exactly match frontend env values.

## 5) DNS (Optional Custom Domain)

- If using Route53, attach domain directly in Amplify custom domain settings.
- If using external DNS, map records as instructed by Amplify.

## 6) Validation Checklist

- Login works with Cognito Hosted UI.
- Consumer goes to `/locker`, merchant goes to `/merchant-dashboard`.
- `/scan` uploads and processes invoice via backend.
- `/document/[id]`, `/reminders`, `/chat` call backend successfully.

## Notes

- This app is configured for AWS-only auth flow (Cognito).
- Keep `NEXT_PUBLIC_APP_API_BASE_URL=/api` so browser never calls backend directly.
