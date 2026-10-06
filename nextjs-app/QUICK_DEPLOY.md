# Quick AWS Deploy (Frontend)

## 1) Push Code

```powershell
cd nextjs-app
git remote add origin https://github.com/YOUR_USERNAME/safebill-nextjs.git
git branch -M main
git push -u origin main
```

## 2) Deploy on AWS Amplify

1. Open AWS Amplify Console.
2. Connect your GitHub repo.
3. Set app root to `nextjs-app`.
4. Confirm `amplify.yml` is used.
5. Add environment variables from `DEPLOYMENT.md`.
6. Deploy.

## 3) Verify

- Cognito login works.
- `/locker` loads assets.
- `/scan` uploads invoice.
- `/chat` returns grounded answers.

For full setup, use `DEPLOYMENT.md`.
