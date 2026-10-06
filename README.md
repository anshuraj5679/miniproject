# SafeBill

SafeBill is a warranty locker and invoice intelligence platform that helps consumers and merchants store bills, extract structured data, and stay ahead of warranty deadlines. The repo is a monorepo with a Next.js web app and a FastAPI backend.

## Product Snapshots

![Landing Page](nextjs-app/public/readme/Landing%20Page.png)

![Consumer](nextjs-app/public/readme/consumer.png)

![Merchant](nextjs-app/public/readme/merchant.png)

![Login & Signup](nextjs-app/public/readme/loginsignup.png)

![Product Page](nextjs-app/public/readme/productpage.png)

## What It Does

- OCR and metadata extraction for invoices and warranty documents
- Consumer warranty locker with reminders and claim readiness insights
- Merchant bill assignment workflow to consumers
- AI-powered summaries and insights for invoices
- Secure document storage and sharing

## Repository Layout

- `nextjs-app/` — Next.js app (consumer + merchant portals) and BFF `/api/*` proxy routes
- `backend/` — FastAPI ingestion/RAG API, extraction pipeline, and notifications
- `deploy/` — EC2 deployment assets and infrastructure references

## AWS Tech Stack (Brief)

SafeBill is deployed on AWS using a managed stack for identity, storage, AI inference, and messaging:

- **Amazon Cognito** — user authentication and JWT identity
- **Amazon S3** — invoice/document storage and presigned downloads
- **Amazon Bedrock** — LLM-powered extraction and insight generation
- **Amazon Textract / Vision OCR** — OCR for images (fallbacks handled in backend)
- **Amazon SES** — email notifications (verified domain sender)
- **Amazon SNS** — push/SMS/WhatsApp channels (optional)
- **Amazon RDS (Postgres)** — primary metadata store
- **EC2 + Docker Compose** — runtime deployment for API and web

![AWS Tech Stack](nextjs-app/public/readme/aws%20tech-stack.png)

## Contributions

Contributions are welcome. Please open an issue to discuss major changes before submitting a PR. For smaller fixes, submit a PR directly with a concise description and screenshots if UI behavior changes.
