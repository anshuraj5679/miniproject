# GitHub Setup Instructions

Follow these steps to push your Next.js app to GitHub:

## Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `safebill-nextjs` (or your preferred name)
3. Description: "SafeBill Next.js web app - Warranty management system"
4. Choose **Public** or **Private**
5. **DO NOT** check "Initialize this repository with a README" (we already have one)
6. Click **"Create repository"**

## Step 2: Push to GitHub

After creating the repository, GitHub will show you commands. Use these:

### Option A: If you haven't committed yet

```powershell
# Navigate to the project
cd nextjs-app

# Initialize git (if not done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: SafeBill Next.js app"

# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/safebill-nextjs.git

# Push to GitHub
git branch -M main
git push -u origin main
```

### Option B: If you already committed

```powershell
# Navigate to the project
cd nextjs-app

# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/safebill-nextjs.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 3: Verify

1. Go to your GitHub repository page
2. Verify all files are uploaded
3. Check that `.env.local` is NOT in the repository (it's in .gitignore)

## Next Steps

After pushing to GitHub, follow the `DEPLOYMENT.md` guide to deploy to Vercel.

