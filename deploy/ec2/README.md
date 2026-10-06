# SafeBill on EC2

This deployment path runs the full app on one EC2 instance:

- `frontend`: Next.js production server
- `backend`: FastAPI API
- `nginx`: public reverse proxy on port `80`

Users access the app through:

- `http://<EC2_PUBLIC_IP>`
- or later `https://your-domain`

## 1) Launch the EC2 instance

From Windows PowerShell:

```powershell
cd C:\Users\aryan\Pictures\safebill\SAFE\deploy\ec2
.\provision-ec2.ps1 -KeyName your-keypair-name
```

This script:

- finds the default VPC/subnet
- creates a security group with `22`, `80`, `443`
- launches Ubuntu `24.04`
- installs Docker + Docker Compose via user data
- prints the public IP and SSH command

If you already have an instance, skip this and SSH into it.

## 2) SSH into the instance

```bash
ssh -i /path/to/your-key.pem ubuntu@<EC2_PUBLIC_IP>
```

## 3) Clone the repo

```bash
cd /opt/safebill
git clone https://github.com/SCARPxVeNOM/SAFE.git
cd SAFE
```

## 4) Create deployment env

```bash
cp deploy/ec2/app.env.example deploy/ec2/.env
nano deploy/ec2/.env
```

Fill these first:

- `APP_BASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `DATABASE_URL`
- `GOOGLE_VISION_CREDENTIALS_HOST_PATH`
- `COGNITO_USER_POOL_ID`
- `COGNITO_APP_CLIENT_ID`
- `COGNITO_JWT_ISSUER`
- `COGNITO_JWT_AUDIENCE`
- `NEXT_PUBLIC_COGNITO_DOMAIN`
- `COGNITO_DOMAIN`
- `COGNITO_CLIENT_SECRET`
- `S3_BUCKET_NAME`
- `BEDROCK_CHAT_MODEL`

For public-IP deployment, set:

- `APP_BASE_URL=http://<EC2_PUBLIC_IP>`
- `NEXT_PUBLIC_COGNITO_REDIRECT_URI=http://<EC2_PUBLIC_IP>/auth/callback`
- `NEXT_PUBLIC_COGNITO_LOGOUT_URI=http://<EC2_PUBLIC_IP>/login`
- `COGNITO_REDIRECT_URI=http://<EC2_PUBLIC_IP>/auth/callback`
- `COGNITO_LOGOUT_URI=http://<EC2_PUBLIC_IP>/login`

## 5) Start the stack

Before starting, place your Google Vision service-account JSON on the EC2 host.

Example:

```bash
mkdir -p deploy/ec2/secrets
nano deploy/ec2/secrets/google-vision.json
```

Then keep:

- `GOOGLE_VISION_CREDENTIALS_HOST_PATH=./secrets/google-vision.json`

The backend container mounts that file at:

- `/run/secrets/google-vision.json`

Now start the stack:

```bash
docker compose -f deploy/ec2/docker-compose.yml --env-file deploy/ec2/.env up -d --build
```

Check status:

```bash
docker compose -f deploy/ec2/docker-compose.yml ps
docker compose -f deploy/ec2/docker-compose.yml logs -f
```

## 6) Public app link

Once containers are healthy:

- `http://<EC2_PUBLIC_IP>`

## 7) HTTPS and domain

If you want a production domain:

1. point your domain DNS to the EC2 public IP
2. update all Cognito redirect/logout URLs to use `https://your-domain`
3. add TLS on the EC2 host with Nginx + Let's Encrypt, or place an ALB/CloudFront in front

Until that is done, use the public IP over HTTP.

## 8) AWS permissions

Best practice is to attach an EC2 IAM role with access to:

- S3 bucket used by SafeBill
- Amazon Bedrock invoke permissions
- Cognito user-pool operations used by the backend
- SES/SNS if those channels are enabled
- DynamoDB if mirrors are enabled

If you do not attach an IAM role, the app can still run with explicit AWS keys in `deploy/ec2/.env`, but that is weaker operationally.
