# AWS Deployment (Backend)

This backend supports two AWS runtime options:

1. Lambda + API Gateway (SAM template included)
2. ECS Fargate (Dockerfile included)

Frontend hosting is expected on AWS Amplify (`nextjs-app/DEPLOYMENT.md`) for full AWS-only deployment.

## 1) Lambda + API Gateway (Recommended to start)

Prerequisites:

- AWS CLI configured for your account/region.
- AWS SAM CLI installed.
- Region example: `ap-southeast-2`.

Commands:

```bash
cd backend/infra/aws-lambda
sam build --template-file template.yaml
sam deploy --guided --template-file template.yaml
```

Set Lambda environment variables after deploy (or in template):

- `DATABASE_URL`
- `AWS_ONLY_MODE=true`
- `AUTH_PROVIDER=cognito`
- `AI_PROVIDER=bedrock`
- `AWS_REGION`
- `AWS_SECRETS_ENABLED=true`
- `AWS_SECRETS_MANAGER_SECRET_ID`
- `STORAGE_PROVIDER=s3`
- `S3_BUCKET_NAME`
- `ASYNC_EXTRACTION_ENABLED=true`
- `ASYNC_EXTRACTION_SOURCE_PREFIX=async-extraction`
- `ASYNC_EXTRACTION_CALLBACK_TOKEN`
- `EMAIL_PROVIDER=ses`
- `SES_REGION`
- `SMS_PROVIDER=sns`
- `SNS_REGION`

Important:

- Keep `DISABLE_IN_APP_NOTIFICATION_WORKER=true` on Lambda.
- Keep `LOCAL_ASYNC_EXTRACTION_WORKER_ENABLED=false` on Lambda.
- Trigger notification processing via a scheduled Lambda/EventBridge job hitting `/api/v1/notifications/process-due`.
- The SAM template now provisions:
  - API Lambda
  - S3 documents bucket
  - async extraction Lambda
  - S3 event trigger for `documents/async-extraction/`
- Async extraction flow is:
  - client uploads image
  - backend creates `extraction_job` row and stores source image in S3
  - S3 event triggers extraction Lambda
  - Lambda runs Google Vision OCR + Bedrock arbitration
  - Lambda calls `/api/v1/extraction-jobs/{jobId}/callback`
  - backend persists final `document` and marks job `completed`

## Local Development

You do not need AWS SAM to run async extraction locally.

Use:

- `ASYNC_EXTRACTION_ENABLED=true`
- `LOCAL_ASYNC_EXTRACTION_WORKER_ENABLED=true`

Then start the normal backend. The in-process local worker will pick up queued
`extraction_jobs` and complete them without a public callback URL.

## 2) ECS Fargate

Build/push image:

```bash
cd backend
docker build -t safebill-backend:latest .
```

Deploy this image to ECR and run on ECS Fargate behind an ALB.

Container start command is already in Dockerfile:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```
