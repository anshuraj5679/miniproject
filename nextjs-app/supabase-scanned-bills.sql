-- Create scanned_bills table for storing extracted bill/invoice data
-- Run this SQL in your Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS scanned_bills (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_id TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT,
  file_name TEXT,
  product_name TEXT,
  brand TEXT,
  category TEXT DEFAULT 'Others',
  amount TEXT,
  purchase_date TEXT,
  warranty_period TEXT,
  warranty_start TEXT,
  warranty_end TEXT,
  serial_number TEXT,
  invoice_number TEXT,
  store TEXT,
  extracted_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE scanned_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow insert scanned_bills" ON scanned_bills;
DROP POLICY IF EXISTS "Allow read own scanned_bills" ON scanned_bills;
DROP POLICY IF EXISTS "Allow delete own scanned_bills" ON scanned_bills;
DROP POLICY IF EXISTS "Allow users to insert own scanned_bills" ON scanned_bills;
DROP POLICY IF EXISTS "Allow users to read own scanned_bills only" ON scanned_bills;
DROP POLICY IF EXISTS "Allow users to delete own scanned_bills only" ON scanned_bills;

CREATE POLICY "Allow users to insert own scanned_bills"
  ON scanned_bills
  FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Allow users to read own scanned_bills only"
  ON scanned_bills
  FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Allow users to delete own scanned_bills only"
  ON scanned_bills
  FOR DELETE
  USING (auth.uid()::text = user_id);
