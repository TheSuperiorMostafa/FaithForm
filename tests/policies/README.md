# Security Policy Tests

## Overview

These tests validate Row Level Security (RLS) policies, storage access controls, and database constraints against a live Supabase/PostgreSQL database.

## Requirements

### Local Supabase Instance

These tests require a local Supabase instance with all migrations applied:

```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase (Docker required)
supabase start

# Apply migrations
supabase db reset
```

### Environment Variables

Set these environment variables to connect to your local Supabase:

```bash
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="<anon key from supabase start>"
export SUPABASE_SECRET_KEY="<service_role key from supabase start>"
```

Alternatively, for CI/CD or disposable test instances, use a test Supabase project.

### Test Execution

```bash
# Run all policy tests
pnpm test tests/policies/

# Run specific test suites
pnpm test tests/policies/notification-outbox-constraints.test.ts
pnpm test tests/policies/group-membership-rls.test.ts
pnpm test tests/policies/stream-recordings-storage.test.ts
```

## Test Coverage

### notification-outbox-constraints.test.ts

Validates migration 0149's strict per-kind notification validation:
- ✅ All 11 valid kind/topic/subject_type combinations
- ✅ Rejection of 8 invalid mismatches (e.g., event_published + groups topic)
- ✅ target_account_ids cardinality validation (1-200)

### group-membership-rls.test.ts

Validates migration 0148's active church relationship verification:
- ✅ Allows updates with active relationship
- ✅ Denies updates without active relationship
- ✅ Prevents cross-church unauthorized writes (TOCTOU protection)

### stream-recordings-storage.test.ts

Validates migration 0146's storage RLS for private video bucket:
- ✅ Service-role-only direct access
- ✅ Signed URL functionality
- ✅ Church path isolation
- ✅ Authenticated user denial (read/write/delete)

## Security Notes

- **Synthetic test data only**: All tests create disposable test users, churches, and data
- **Automatic cleanup**: `after()` hooks remove all test data
- **No production access**: Never run against production Supabase instances
- **Isolated execution**: Each test suite creates independent test fixtures
- **No private data leakage**: Tests use timestamp-based unique identifiers

## Troubleshooting

### "Missing NEXT_PUBLIC_SUPABASE_URL" Error

The tests are skipped if Supabase environment variables are not set. To run them:

1. Install Docker Desktop (required for local Supabase)
2. Install Supabase CLI: `npm install -g supabase`
3. Start local instance: `supabase start`
4. Set environment variables from `supabase start` output
5. Run tests

### Migration Not Applied

If tests fail with "relation does not exist" or constraint errors:

```bash
# Reset and reapply all migrations
supabase db reset

# Or apply new migrations only
supabase db push
```

### RLS Denial Errors

If tests fail unexpectedly with RLS denials:
- Verify the user is authenticated properly in test setup
- Check that test data matches the policy's church/account relationships
- Ensure migrations 0146, 0147, 0148, 0149 are applied in order
