-- Create user_profiles table for Consumer/Merchant ID login
-- Run this SQL in your Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  custom_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'consumer',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read of user_profiles" ON user_profiles;
DROP POLICY IF EXISTS "Allow users to insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Allow users to update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Allow users to read own profile" ON user_profiles;
DROP POLICY IF EXISTS "Allow users to insert own user_profile" ON user_profiles;
DROP POLICY IF EXISTS "Allow users to update own user_profile" ON user_profiles;

CREATE POLICY "Allow users to read own profile"
  ON user_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Allow users to insert own user_profile"
  ON user_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Allow users to update own user_profile"
  ON user_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
