#!/bin/bash
set -e

echo "Setting up local PostgreSQL test database..."

# Create test database and user
sudo -u postgres psql -c "DROP DATABASE IF EXISTS faithform_test;" || true
sudo -u postgres psql -c "CREATE DATABASE faithform_test;"
sudo -u postgres psql -c "DROP USER IF EXISTS faithform_test_user;" || true
sudo -u postgres psql -c "CREATE USER faithform_test_user WITH PASSWORD 'test_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE faithform_test TO faithform_test_user;"

# Create minimal Supabase-like auth schema
sudo -u postgres psql faithform_test <<'SQL'
-- Create auth schema (minimal Supabase emulation)
CREATE SCHEMA IF NOT EXISTS auth;

-- Minimal auth.users table
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auth helper functions for RLS testing
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
$$ LANGUAGE SQL STABLE;

-- Create storage schema (minimal emulation)
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text NOT NULL,
  owner uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bucket_id, name)
);

-- Grant permissions
GRANT USAGE ON SCHEMA auth TO faithform_test_user;
GRANT USAGE ON SCHEMA storage TO faithform_test_user;
GRANT SELECT ON auth.users TO faithform_test_user;
GRANT ALL ON storage.buckets TO faithform_test_user;
GRANT ALL ON storage.objects TO faithform_test_user;

-- Create authenticated and anon roles (for RLS testing)
DO $$ BEGIN
  CREATE ROLE authenticated;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE anon;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE service_role;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

GRANT authenticated TO faithform_test_user;
GRANT anon TO faithform_test_user;
GRANT service_role TO faithform_test_user;
SQL

echo "✅ Auth and storage schemas created"

# Apply migrations
echo "Applying migrations..."
cd /workspace
for migration in supabase/migrations/*.sql; do
  echo "  Applying $(basename $migration)..."
  sudo -u postgres psql faithform_test -f "$migration" 2>&1 | grep -v "NOTICE:" | head -10 || true
done

echo "✅ Migrations applied"

# Set up environment variables for tests
cat > /workspace/.env.test.local <<EOF
NEXT_PUBLIC_SUPABASE_URL="postgresql://faithform_test_user:test_password@localhost:5432/faithform_test"
SUPABASE_SECRET_KEY="test-service-role-key"
DATABASE_URL="postgresql://faithform_test_user:test_password@localhost:5432/faithform_test"
EOF

echo "✅ Test environment configured"
echo ""
echo "To run tests:"
echo "  export $(cat .env.test.local | xargs)"
echo "  pnpm test tests/policies/"
