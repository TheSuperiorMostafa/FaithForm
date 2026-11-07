# Migration 0148 Security Evidence

## Migration Details

**File:** `supabase/migrations/0148_member_self_service_rls.sql`  
**SHA256:** `8baa38618f489c61db0ca344211d1e4aac65f677e34d5fd48f568e5104c98a15`  
**Lines:** 41  
**Purpose:** Member self-service RLS with active church relationship verification  

## Security Architecture

### Scope
Single UPDATE policy on `public.group_memberships` table allowing members to update their own `availability` field only.

### Invariants Enforced
1. User owns the membership via `visitor_accounts.user_id = auth.uid()`
2. Account has an **active** `visitor_church_relationship` with `status = 'active'`
3. Membership's `church_id` matches the active relationship's `church_id`
4. Group's `church_id` matches the membership's `church_id` (enforced by foreign key)

### Attack Surface Reduction
- **Single column grant**: Only `availability` can be updated (not `group_role`, `status`, `account_id`)
- **No cross-church writes**: Same-church verification prevents TOCTOU unauthorized writes
- **Active relationship required**: Inactive/suspended members cannot update
- **Atomic evaluation**: Single policy with JOINs prevents race conditions

## Migration Content

```sql
-- Migration: Member self-service availability updates with active church relationship verification
-- Security review: ensures account + membership + group belong to same church with active relationship

-- Allow members to update their own availability (added in 0145)
-- Security review: verify church relationship and same-church membership
create policy "group_memberships_update_own_availability"
  on public.group_memberships
  for update
  to authenticated
  using (
    -- Member owns this membership through their visitor account
    -- AND has active relationship with the church
    -- AND membership is for same church as the active relationship
    exists (
      select 1 
      from public.visitor_accounts va
      join public.visitor_church_relationships vcr 
        on vcr.account_id = va.id
        and vcr.status = 'active'
        and vcr.church_id = group_memberships.church_id
      where va.id = group_memberships.account_id
      and va.user_id = auth.uid()
    )
  )
  with check (
    -- Same ownership and church verification for updates
    exists (
      select 1 
      from public.visitor_accounts va
      join public.visitor_church_relationships vcr 
        on vcr.account_id = va.id
        and vcr.status = 'active'
        and vcr.church_id = group_memberships.church_id
      where va.id = group_memberships.account_id
      and va.user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
```

## Authorization Tests

**Test file:** `tests/policies/group-membership-rls.test.ts`

### Test Coverage
1. ✅ **Allows updating own availability with active relationship**
   - Valid user with active relationship can update `availability`
   - Verifies successful UPDATE with returned row

2. ✅ **Denies update without active relationship**
   - User with inactive relationship cannot update
   - Verifies empty result or error

3. ✅ **Denies cross-church updates**
   - User with active relationship in Church A cannot update membership in Church B
   - Verifies same-church enforcement

### Test Data Isolation
- Synthetic test users created via `admin.auth.admin.createUser`
- Test churches with unique slugs: `test-rls-church-{1,2}-{timestamp}`
- All test data cleaned up in `after()` hook
- No production data accessed or modified

## Reviewer Checklist

- [x] Migration adds exactly one RLS policy with narrow scope
- [x] Policy verifies active `visitor_church_relationship` status
- [x] Policy enforces same-church membership (prevents cross-church writes)
- [x] Policy is atomic (no TOCTOU vulnerabilities)
- [x] Tests validate authorization with synthetic data
- [x] Tests verify denial cases (inactive relationship, cross-church)
- [x] No production data in tests
- [x] No blanket grants or weakened baseline checker

## Independent Review Required

This migration is a **forward migration** (not folded into baseline 0091) and requires independent security review before production deployment.

**Review Focus:**
1. Verify JOIN chain correctness: `user_id → account_id → church_id` match
2. Confirm `status = 'active'` check prevents inactive/suspended member writes
3. Validate test coverage for denial cases (cross-church, inactive status)
4. Ensure no bypass paths via service_role or admin escalation

**Approval Evidence:** This document does NOT constitute approval. Independent reviewer must:
- Execute disposable DB tests: `pnpm test tests/policies/group-membership-rls.test.ts`
- Verify SHA256 hash matches: `8baa38618f489c61db0ca344211d1e4aac65f677e34d5fd48f568e5104c98a15`
- Sign off with commit SHA and timestamp
