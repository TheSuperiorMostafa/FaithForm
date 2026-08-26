-- Faithful: rotating QR check-in, short-code fallback, and occurrence-scoped kiosks
-- Migration 0059 (Prompt 8)
--
-- Additive. Five new tables and eight new functions. Nothing in 0055–0058 is
-- altered, and nothing existing is dropped.
--
-- ## What this adds, and why each piece has to be in the database
--
-- A rotating check-in code is a coordination problem before it is a
-- cryptographic one. Two browser tabs showing the same service must agree on
-- which code is current; a projector that refreshes must land on the same code
-- it was already showing; and two visitors scanning the same screen must both
-- be able to use it. Every one of those is a race, and a race is settled by a
-- unique index, not by application code reading and then writing.
--
--   * `attendance_checkin_sessions` — one active display per occurrence,
--     enforced by a partial unique index rather than by a check-then-insert.
--   * `attendance_checkin_codes`    — one code per (session, rotation window),
--     so concurrent polls converge on one code instead of minting a stream of
--     them.
--   * `attendance_display_pairings` — a single-use code that turns into a
--     read-only display capability, so no dashboard cookie reaches a projector.
--   * `attendance_qr_scan_redemptions` — per **account**, not per nonce.
--   * `attendance_kiosk_sessions`   — a kiosk bound to one occurrence.
--
-- ## The change of behaviour this records
--
-- 0055 created `attendance_qr_redemptions` with a unique index on
-- `(service_occurrence_id, nonce)`. That is a **global** consumption: the first
-- person to scan a displayed code takes the nonce, and the second person
-- looking at the same screen collides and is refused.
--
-- That is wrong for a congregation. A code on a projector is meant to be used by
-- everyone in the room during the few seconds it is up. The uniqueness that
-- actually prevents double-counting is the unique counted fact inside
-- `record_attendance` — one person, one occurrence, once — and it is unaffected
-- by how many codes that person scans.
--
-- So redemption moves to `attendance_qr_scan_redemptions`, unique on
-- `(service_occurrence_id, account_id, nonce)`. What that row buys is an audit
-- trail of which rotating code a person presented and a cheap signal for one
-- account working through many codes. It is explicitly **not** the
-- duplicate-count defence.
--
-- `attendance_qr_redemptions` is left exactly as 0055 wrote it — additive
-- migrations only — and is superseded from this point.
--
-- ## What is not in here
--
-- No signing key, no pepper, no plaintext code, and no plaintext credential.
-- Everything a human could type is stored as a keyed hash computed by the
-- application, so a copy of this database yields no working code. The key lives
-- in the deployment environment and never reaches a browser, a projector, or a
-- phone.

-- ---------------------------------------------------------------------------
-- SESSIONS
-- ---------------------------------------------------------------------------

create table if not exists public.attendance_checkin_sessions (
  id uuid primary key default gen_random_uuid(),

  church_id uuid not null references public.churches (id) on delete cascade,
  service_occurrence_id uuid not null
    references public.service_occurrences (id) on delete cascade,

  status text not null default 'active'
    check (status in ('active', 'ended')),

  -- How often the displayed code changes. Bounded at both ends: below 15s a
  -- visitor cannot finish scanning before it moves, and above 120s the code is
  -- no longer meaningfully rotating.
  rotation_seconds integer not null default 30
    check (rotation_seconds between 15 and 120),

  started_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_by uuid references auth.users (id) on delete set null,
  ended_at timestamptz,

  -- A hard bound, set from the occurrence's own check-in window. A display
  -- nobody remembers to stop still stops.
  expires_at timestamptz not null,

  created_at timestamptz not null default now()
);

-- **One active display per occurrence.** Partial, so ended sessions accumulate
-- as history without blocking a new one.
create unique index if not exists attendance_checkin_sessions_active_idx
  on public.attendance_checkin_sessions (service_occurrence_id)
  where status = 'active';

create index if not exists attendance_checkin_sessions_church_idx
  on public.attendance_checkin_sessions (church_id, started_at desc);

create index if not exists attendance_checkin_sessions_expiry_idx
  on public.attendance_checkin_sessions (expires_at)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- ROTATING CODES
-- ---------------------------------------------------------------------------

create table if not exists public.attendance_checkin_codes (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.attendance_checkin_sessions (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  service_occurrence_id uuid not null
    references public.service_occurrences (id) on delete cascade,

  -- The rotation window this code belongs to: floor(epoch / rotation_seconds).
  -- Deriving the identity from the clock rather than from an arrival order is
  -- what lets two independent pollers agree without talking to each other.
  window_index bigint not null,

  -- **Keyed hash, computed by the application.** A short code is short enough
  -- to type, which means it is short enough to brute-force offline from a plain
  -- digest. The pepper is not in this database.
  code_hash text not null,

  -- Which derivation attempt produced the code. Almost always 0; incremented
  -- only when a hash collides with a live code from another session, which the
  -- unique index below refuses.
  derivation_attempt integer not null default 0,

  -- The QR nonce for this window. Not a secret — it is derived from the same
  -- window and identifies which code a redemption used.
  nonce text not null,

  valid_from timestamptz not null,
  valid_until timestamptz not null,

  created_at timestamptz not null default now()
);

-- One code per window. This is the convergence guarantee.
create unique index if not exists attendance_checkin_codes_window_idx
  on public.attendance_checkin_codes (session_id, window_index);

-- The typed-code lookup: one index probe, no scan, no per-session iteration.
create unique index if not exists attendance_checkin_codes_hash_idx
  on public.attendance_checkin_codes (code_hash);

create index if not exists attendance_checkin_codes_expiry_idx
  on public.attendance_checkin_codes (valid_until);

-- ---------------------------------------------------------------------------
-- DISPLAY PAIRING
-- ---------------------------------------------------------------------------
--
-- The projector problem. A church's display machine must show a rotating code
-- and nothing else — it must not hold a dashboard session, because a dashboard
-- session in a public room is an administrator account in a public room.
--
-- So the pastor starts the session in the dashboard, reads a short pairing code
-- off their own screen, and types it into the display. The display exchanges it
-- once for a capability that can do exactly one thing: read the current code for
-- one occurrence.

create table if not exists public.attendance_display_pairings (
  id uuid primary key default gen_random_uuid(),

  session_id uuid not null
    references public.attendance_checkin_sessions (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,

  -- Keyed hash again, and unique so a redemption is an index probe.
  code_hash text not null unique,

  expires_at timestamptz not null,
  redeemed_at timestamptz,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_display_pairings_session_idx
  on public.attendance_display_pairings (session_id, created_at desc);

create index if not exists attendance_display_pairings_expiry_idx
  on public.attendance_display_pairings (expires_at);

-- ---------------------------------------------------------------------------
-- PER-ACCOUNT SCAN REDEMPTIONS
-- ---------------------------------------------------------------------------

create table if not exists public.attendance_qr_scan_redemptions (
  id uuid primary key default gen_random_uuid(),

  church_id uuid not null references public.churches (id) on delete cascade,
  service_occurrence_id uuid not null
    references public.service_occurrences (id) on delete cascade,
  account_id uuid not null
    references public.visitor_accounts (id) on delete cascade,

  nonce text not null,
  entry_method text not null check (entry_method in ('qr', 'short_code')),

  redeemed_at timestamptz not null default now()
);

-- **Per account.** Two people may use one displayed code; one person using the
-- same code twice finds their own row.
create unique index if not exists attendance_qr_scan_redemptions_account_idx
  on public.attendance_qr_scan_redemptions
     (service_occurrence_id, account_id, nonce);

create index if not exists attendance_qr_scan_redemptions_sweep_idx
  on public.attendance_qr_scan_redemptions (redeemed_at);

-- ---------------------------------------------------------------------------
-- KIOSK SESSIONS
-- ---------------------------------------------------------------------------
--
-- 0055's `attendance_kiosk_credentials` is church-and-campus scoped and has no
-- pairing step, no idle lock, and no occurrence. It stays where it is. This is
-- the occurrence-scoped kiosk Prompt 8 requires, and it is deliberately a
-- separate table rather than columns bolted onto the old one: the two have
-- different lifetimes and different blast radii.

create table if not exists public.attendance_kiosk_sessions (
  id uuid primary key default gen_random_uuid(),

  church_id uuid not null references public.churches (id) on delete cascade,
  -- **The scope.** A kiosk credential names one occurrence and can reach no
  -- other, which is the difference between a check-in station and a login.
  service_occurrence_id uuid not null
    references public.service_occurrences (id) on delete cascade,
  campus_id uuid references public.church_campuses (id) on delete set null,

  label text not null,

  status text not null default 'pending'
    check (status in ('pending', 'active', 'ended')),

  -- Typed once on the tablet, then gone.
  pairing_code_hash text unique,
  pairing_expires_at timestamptz,
  paired_at timestamptz,

  -- The long random credential the tablet holds afterwards. Hash only.
  credential_hash text unique,

  -- **Auto-lock.** After this much inactivity the credential stops resolving
  -- and a staff member has to unlock it again. A kiosk left on a table after
  -- the service is a kiosk anyone can use.
  idle_lock_seconds integer not null default 300
    check (idle_lock_seconds between 30 and 1800),

  last_used_at timestamptz,
  expires_at timestamptz not null,

  started_by uuid references auth.users (id) on delete set null,
  ended_by uuid references auth.users (id) on delete set null,
  ended_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists attendance_kiosk_sessions_occurrence_idx
  on public.attendance_kiosk_sessions (service_occurrence_id, status);

create index if not exists attendance_kiosk_sessions_church_idx
  on public.attendance_kiosk_sessions (church_id, created_at desc);

create index if not exists attendance_kiosk_sessions_expiry_idx
  on public.attendance_kiosk_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- START A SESSION
-- ---------------------------------------------------------------------------

/*
 * Starts, or returns, the one active check-in display for an occurrence.
 *
 * Idempotent by the partial unique index rather than by a read-then-write: two
 * pastors pressing the button at the same moment both reach the insert, one
 * wins, and the loser reads the winner's row. Both then see the same session,
 * the same rotation period, and therefore the same code.
 *
 * The church is read from the occurrence and compared with the caller's — never
 * taken from the caller. A session cannot be started against another tenant's
 * service by naming its id.
 */
create or replace function public.start_attendance_checkin_session(
  p_occurrence_id uuid,
  p_church_id uuid,
  p_actor_user_id uuid default null,
  p_rotation_seconds integer default 30,
  p_grace_seconds integer default 900
)
returns table (
  ok boolean,
  reason text,
  session_id uuid,
  rotation_seconds integer,
  expires_at timestamptz,
  was_existing boolean
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  occ record;
  now_server timestamptz := now();
  bound timestamptz;
  rotation integer;
  new_id uuid;
  existing record;
begin
  select o.id, o.church_id, o.status, o.checkin_closes_at_utc
    into occ
    from public.service_occurrences o
   where o.id = p_occurrence_id;

  if not found then
    return query select false, 'occurrence_not_found', null::uuid, 0, null::timestamptz, false;
    return;
  end if;

  -- Tenancy, from the occurrence.
  if occ.church_id <> p_church_id then
    return query select false, 'occurrence_not_found', null::uuid, 0, null::timestamptz, false;
    return;
  end if;

  if occ.status = 'cancelled' then
    return query select false, 'occurrence_cancelled', null::uuid, 0, null::timestamptz, false;
    return;
  end if;

  -- A display for a service whose check-in has closed would show codes nobody
  -- can redeem. Refuse rather than mint theatre.
  bound := occ.checkin_closes_at_utc + make_interval(secs => greatest(0, p_grace_seconds));
  if bound <= now_server then
    return query select false, 'too_late', null::uuid, 0, null::timestamptz, false;
    return;
  end if;

  rotation := greatest(15, least(120, coalesce(p_rotation_seconds, 30)));

  insert into public.attendance_checkin_sessions (
    church_id, service_occurrence_id, status, rotation_seconds,
    started_by, started_at, expires_at
  ) values (
    occ.church_id, occ.id, 'active', rotation,
    p_actor_user_id, now_server, bound
  )
  on conflict (service_occurrence_id) where status = 'active' do nothing
  returning id into new_id;

  if new_id is not null then
    return query
      select true, 'ok', s.id, s.rotation_seconds, s.expires_at, false
        from public.attendance_checkin_sessions s
       where s.id = new_id;
    return;
  end if;

  -- Lost the race, or the display was already running. Return what is live —
  -- restarting it would rotate the code out from under a room mid-scan.
  select s.* into existing
    from public.attendance_checkin_sessions s
   where s.service_occurrence_id = p_occurrence_id
     and s.status = 'active';

  if not found then
    -- The winner ended between the insert and this read. Genuinely rare, and
    -- the honest answer is "try again" rather than a fabricated session.
    return query select false, 'session_unavailable', null::uuid, 0, null::timestamptz, false;
    return;
  end if;

  return query select true, 'ok', existing.id, existing.rotation_seconds,
                      existing.expires_at, true;
end;
$$;

revoke all on function public.start_attendance_checkin_session(
  uuid, uuid, uuid, integer, integer
) from public, anon, authenticated;
grant execute on function public.start_attendance_checkin_session(
  uuid, uuid, uuid, integer, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- END A SESSION
-- ---------------------------------------------------------------------------

/*
 * Ends a display. The church predicate is in the statement, so a session id
 * from another tenant updates nothing rather than being ended by a guess.
 *
 * Ending is immediate and total: the display capability resolves through the
 * session, so the projector stops receiving codes on its next poll. Nothing
 * already counted is affected — a counted fact is independent of the code that
 * produced it.
 */
create or replace function public.end_attendance_checkin_session(
  p_session_id uuid,
  p_church_id uuid,
  p_actor_user_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  update public.attendance_checkin_sessions as s
     set status = 'ended',
         ended_at = now(),
         ended_by = p_actor_user_id
   where s.id = p_session_id
     and s.church_id = p_church_id
     and s.status = 'active';

  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

revoke all on function public.end_attendance_checkin_session(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.end_attendance_checkin_session(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- CLAIM THE CODE FOR A ROTATION WINDOW
-- ---------------------------------------------------------------------------

/*
 * Returns the code row for one rotation window, creating it if this is the
 * first caller to ask.
 *
 * The caller supplies **candidate hashes**, not codes: the plaintext is derived
 * in the application from the signing key, the session and the window, so every
 * poller computes the same code without coordination and nothing readable is
 * ever written here.
 *
 * Why an array. Codes are short enough that two live sessions can, very rarely,
 * derive the same one — and `attendance_checkin_codes_hash_idx` refuses that,
 * correctly, because a typed code must resolve to exactly one session. The
 * caller therefore offers several derivations and this takes the first that
 * lands. `derivation_attempt` records which, so later polls in the same window
 * re-derive the same plaintext.
 *
 * Returning `ok = false` when every candidate collides is deliberate: the
 * display shows the QR without a short code rather than showing a code that
 * belongs to another church.
 */
create or replace function public.claim_attendance_checkin_code(
  p_session_id uuid,
  p_window_index bigint,
  p_code_hashes text[],
  p_nonce text,
  p_valid_from timestamptz,
  p_valid_until timestamptz
)
returns table (
  ok boolean,
  code_id uuid,
  derivation_attempt integer,
  nonce text,
  valid_from timestamptz,
  valid_until timestamptz,
  was_existing boolean
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  session_row record;
  existing record;
  candidate text;
  index_position integer := 0;
  inserted_id uuid;
begin
  select s.* into session_row
    from public.attendance_checkin_sessions s
   where s.id = p_session_id;

  if not found or session_row.status <> 'active' or session_row.expires_at <= now() then
    return query select false, null::uuid, 0, null::text,
                        null::timestamptz, null::timestamptz, false;
    return;
  end if;

  -- Already minted for this window: return it unchanged. This is what makes a
  -- refresh, a second tab, and a slow poll all show the same code.
  select c.* into existing
    from public.attendance_checkin_codes c
   where c.session_id = p_session_id
     and c.window_index = p_window_index;

  if found then
    return query select true, existing.id, existing.derivation_attempt, existing.nonce,
                        existing.valid_from, existing.valid_until, true;
    return;
  end if;

  foreach candidate in array coalesce(p_code_hashes, array[]::text[]) loop
    insert into public.attendance_checkin_codes (
      session_id, church_id, service_occurrence_id, window_index,
      code_hash, derivation_attempt, nonce, valid_from, valid_until
    ) values (
      p_session_id, session_row.church_id, session_row.service_occurrence_id,
      p_window_index, candidate, index_position, p_nonce,
      p_valid_from, p_valid_until
    )
    on conflict do nothing
    returning id into inserted_id;

    if inserted_id is not null then
      return query select true, inserted_id, index_position, p_nonce,
                          p_valid_from, p_valid_until, false;
      return;
    end if;

    -- A concurrent caller may have won the *window* rather than the hash.
    select c.* into existing
      from public.attendance_checkin_codes c
     where c.session_id = p_session_id
       and c.window_index = p_window_index;

    if found then
      return query select true, existing.id, existing.derivation_attempt, existing.nonce,
                          existing.valid_from, existing.valid_until, true;
      return;
    end if;

    index_position := index_position + 1;
  end loop;

  -- Every candidate collided with a live code elsewhere. Fail closed.
  return query select false, null::uuid, 0, null::text,
                      null::timestamptz, null::timestamptz, false;
end;
$$;

revoke all on function public.claim_attendance_checkin_code(
  uuid, bigint, text[], text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_attendance_checkin_code(
  uuid, bigint, text[], text, timestamptz, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- RESOLVE A TYPED SHORT CODE
-- ---------------------------------------------------------------------------

/*
 * Turns a typed short code into the session it belongs to.
 *
 * **It does not consume it.** A short code is the accessibility twin of the QR
 * on the same screen, and the QR is deliberately multi-use for the seconds it
 * is up. Consuming the code would mean the first person in a row of four to
 * type it correctly locks out the other three.
 *
 * `reason` exists for the attempt audit and for an operator reading logs. It is
 * **not** for the client: the caller collapses every failure into one message,
 * because telling someone whether their guess was "expired" or "unknown" tells
 * them whether they hit a real code.
 *
 * Timing is not claimed to be constant. The lookup is a single unique-index
 * probe, so a hit and a miss differ by roughly one heap fetch; the defence
 * against guessing is the rate limit and the 4.5-bits-per-character code space,
 * not an unmeasurable timing property.
 */
create or replace function public.redeem_attendance_short_code(
  p_code_hash text,
  p_now timestamptz default now()
)
returns table (
  ok boolean,
  reason text,
  session_id uuid,
  service_occurrence_id uuid,
  church_id uuid,
  nonce text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  code record;
  session_row record;
begin
  if p_code_hash is null or length(p_code_hash) < 16 then
    return query select false, 'malformed', null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  select c.* into code
    from public.attendance_checkin_codes c
   where c.code_hash = p_code_hash;

  if not found then
    return query select false, 'unknown', null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  if p_now < code.valid_from or p_now >= code.valid_until then
    return query select false, 'window_closed', null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  select s.* into session_row
    from public.attendance_checkin_sessions s
   where s.id = code.session_id;

  -- A display the pastor stopped stops working immediately, including for a
  -- code still inside its rotation window.
  if not found or session_row.status <> 'active' or session_row.expires_at <= p_now then
    return query select false, 'session_ended', null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  return query select true, 'ok', code.session_id, code.service_occurrence_id,
                      code.church_id, code.nonce;
end;
$$;

revoke all on function public.redeem_attendance_short_code(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.redeem_attendance_short_code(text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- RESOLVE A CHECK-IN SESSION FOR A SCANNED QR
-- ---------------------------------------------------------------------------

/*
 * Confirms a signed QR capability still corresponds to a live display.
 *
 * The signature proves the server minted the token; this proves the display is
 * still running. Both are required, and this is the half that a stopped session
 * or an ended service can revoke — which a signature alone never can.
 */
create or replace function public.resolve_attendance_checkin_session(
  p_session_id uuid,
  p_now timestamptz default now()
)
returns table (
  ok boolean,
  reason text,
  service_occurrence_id uuid,
  church_id uuid,
  rotation_seconds integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  session_row record;
begin
  select s.* into session_row
    from public.attendance_checkin_sessions s
   where s.id = p_session_id;

  if not found then
    return query select false, 'unknown', null::uuid, null::uuid, 0;
    return;
  end if;

  if session_row.status <> 'active' then
    return query select false, 'session_ended', null::uuid, null::uuid, 0;
    return;
  end if;

  if session_row.expires_at <= p_now then
    return query select false, 'session_expired', null::uuid, null::uuid, 0;
    return;
  end if;

  return query select true, 'ok', session_row.service_occurrence_id,
                      session_row.church_id, session_row.rotation_seconds;
end;
$$;

revoke all on function public.resolve_attendance_checkin_session(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_attendance_checkin_session(uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- RECORD A SCAN
-- ---------------------------------------------------------------------------

/*
 * Records that one account presented one rotating code.
 *
 * Returns whether the row was new. **Nothing is gated on that answer.** A
 * person who scans the same code twice is not doing anything wrong, and
 * `record_attendance` already returns `already_counted` for the second attempt
 * through the unique counted fact.
 *
 * What this row is for: answering "which code did this person use" when a
 * church asks, and making one account working through many codes visible.
 */
create or replace function public.record_attendance_qr_scan(
  p_occurrence_id uuid,
  p_account_id uuid,
  p_church_id uuid,
  p_nonce text,
  p_entry_method text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.attendance_qr_scan_redemptions (
    church_id, service_occurrence_id, account_id, nonce, entry_method
  ) values (
    p_church_id, p_occurrence_id, p_account_id, p_nonce,
    case when p_entry_method = 'short_code' then 'short_code' else 'qr' end
  )
  on conflict (service_occurrence_id, account_id, nonce) do nothing
  returning id into new_id;

  return new_id is not null;
end;
$$;

revoke all on function public.record_attendance_qr_scan(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_attendance_qr_scan(uuid, uuid, uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- DISPLAY PAIRING
-- ---------------------------------------------------------------------------

/*
 * Spends a display pairing code, once.
 *
 * A conditional `update ... returning` rather than a select-then-update: two
 * machines typing the same code race into one statement and exactly one row is
 * updated, so exactly one of them gets a capability.
 */
create or replace function public.redeem_attendance_display_pairing(
  p_code_hash text,
  p_now timestamptz default now()
)
returns table (
  ok boolean,
  reason text,
  session_id uuid,
  service_occurrence_id uuid,
  church_id uuid,
  rotation_seconds integer,
  session_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  claimed record;
  session_row record;
begin
  if p_code_hash is null or length(p_code_hash) < 16 then
    return query select false, 'malformed', null::uuid, null::uuid, null::uuid,
                        0, null::timestamptz;
    return;
  end if;

  update public.attendance_display_pairings as d
     set redeemed_at = p_now
   where d.code_hash = p_code_hash
     and d.redeemed_at is null
     and d.expires_at > p_now
  returning d.* into claimed;

  if not found then
    -- Unknown, already spent, or expired. One answer for all three.
    return query select false, 'invalid', null::uuid, null::uuid, null::uuid,
                        0, null::timestamptz;
    return;
  end if;

  select s.* into session_row
    from public.attendance_checkin_sessions s
   where s.id = claimed.session_id;

  if not found or session_row.status <> 'active' or session_row.expires_at <= p_now then
    return query select false, 'invalid', null::uuid, null::uuid, null::uuid,
                        0, null::timestamptz;
    return;
  end if;

  return query select true, 'ok', session_row.id, session_row.service_occurrence_id,
                      session_row.church_id, session_row.rotation_seconds,
                      session_row.expires_at;
end;
$$;

revoke all on function public.redeem_attendance_display_pairing(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.redeem_attendance_display_pairing(text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- KIOSK PAIRING
-- ---------------------------------------------------------------------------

/*
 * Turns a typed kiosk pairing code into a long random credential, once.
 *
 * The tablet generates nothing and the server stores no plaintext: the caller
 * mints the credential, hands over its hash, and keeps the only copy of the
 * value. A second attempt with the same pairing code finds `status <> 'pending'`
 * and is refused, so a code read off a shoulder after the fact is useless.
 */
create or replace function public.pair_attendance_kiosk(
  p_pairing_code_hash text,
  p_credential_hash text,
  p_now timestamptz default now()
)
returns table (
  ok boolean,
  reason text,
  kiosk_session_id uuid,
  service_occurrence_id uuid,
  church_id uuid,
  campus_id uuid,
  idle_lock_seconds integer,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  claimed record;
begin
  if p_pairing_code_hash is null or length(p_pairing_code_hash) < 16
     or p_credential_hash is null or length(p_credential_hash) < 16 then
    return query select false, 'malformed', null::uuid, null::uuid, null::uuid,
                        null::uuid, 0, null::timestamptz;
    return;
  end if;

  -- **Aliased, and every predicate qualified.** This function returns an OUT
  -- parameter called `expires_at`, and `attendance_kiosk_sessions` has a column
  -- called `expires_at`; an unqualified reference is ambiguous and Postgres
  -- refuses the whole function at run time rather than at creation. Found by
  -- executing this, not by reading it.
  update public.attendance_kiosk_sessions as k
     set status = 'active',
         credential_hash = p_credential_hash,
         paired_at = p_now,
         last_used_at = p_now,
         pairing_code_hash = null,
         pairing_expires_at = null
   where k.pairing_code_hash = p_pairing_code_hash
     and k.status = 'pending'
     and k.pairing_expires_at > p_now
     and k.expires_at > p_now
  returning k.* into claimed;

  if not found then
    return query select false, 'invalid', null::uuid, null::uuid, null::uuid,
                        null::uuid, 0, null::timestamptz;
    return;
  end if;

  return query select true, 'ok', claimed.id, claimed.service_occurrence_id,
                      claimed.church_id, claimed.campus_id,
                      claimed.idle_lock_seconds, claimed.expires_at;
end;
$$;

revoke all on function public.pair_attendance_kiosk(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.pair_attendance_kiosk(text, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- RESOLVE A KIOSK CREDENTIAL
-- ---------------------------------------------------------------------------

/*
 * Resolves a kiosk credential and enforces the auto-lock in the same statement
 * that touches it.
 *
 * The idle check and the `last_used_at` write must not be two round trips: a
 * kiosk polling every second would otherwise keep resetting a lock it should
 * have tripped. A single conditional update settles it — either the credential
 * was inside its idle window and is now refreshed, or it was not and no row
 * moved.
 *
 * Note what a resolved kiosk gets: an occurrence, a church, and a campus. It
 * does not get a role, a user id, or a token that reaches anything else.
 */
create or replace function public.resolve_attendance_kiosk_session(
  p_credential_hash text,
  p_now timestamptz default now()
)
returns table (
  ok boolean,
  reason text,
  kiosk_session_id uuid,
  service_occurrence_id uuid,
  church_id uuid,
  campus_id uuid,
  idle_lock_seconds integer
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  touched record;
  probe record;
begin
  if p_credential_hash is null or length(p_credential_hash) < 16 then
    return query select false, 'malformed', null::uuid, null::uuid, null::uuid, null::uuid, 0;
    return;
  end if;

  -- Aliased for the same reason as the pairing function: `idle_lock_seconds`
  -- is both a column here and one of this function's OUT parameters.
  update public.attendance_kiosk_sessions as k
     set last_used_at = p_now
   where k.credential_hash = p_credential_hash
     and k.status = 'active'
     and k.expires_at > p_now
     and (
       k.last_used_at is null
       or k.last_used_at + make_interval(secs => k.idle_lock_seconds) > p_now
     )
  returning k.* into touched;

  if found then
    return query select true, 'ok', touched.id, touched.service_occurrence_id,
                        touched.church_id, touched.campus_id, touched.idle_lock_seconds;
    return;
  end if;

  -- Nothing moved. Distinguish "locked, unlock it" from "gone", because the
  -- first is a staff instruction and the second is not. Neither reveals whether
  -- the credential was real to anyone who did not already hold it.
  select k.status, k.expires_at, k.last_used_at, k.idle_lock_seconds
    into probe
    from public.attendance_kiosk_sessions k
   where k.credential_hash = p_credential_hash;

  if not found then
    return query select false, 'unknown', null::uuid, null::uuid, null::uuid, null::uuid, 0;
    return;
  end if;

  if probe.status <> 'active' or probe.expires_at <= p_now then
    return query select false, 'ended', null::uuid, null::uuid, null::uuid, null::uuid, 0;
    return;
  end if;

  return query select false, 'idle_locked', null::uuid, null::uuid, null::uuid, null::uuid, 0;
end;
$$;

revoke all on function public.resolve_attendance_kiosk_session(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_attendance_kiosk_session(text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- PURGE
-- ---------------------------------------------------------------------------

/*
 * Removes what has stopped being useful.
 *
 * Codes and pairings are deleted outright once past their window: they are
 * capabilities, not history, and a table of expired capabilities is a liability
 * with no reader. Sessions and scan redemptions are *retained* for the audit
 * window and then removed, because "was a display running" and "which code did
 * this person use" are questions a church legitimately asks weeks later.
 *
 * Sessions past their hard bound are ended rather than deleted, so the history
 * survives while the capability does not.
 */
create or replace function public.purge_attendance_checkin_artifacts(
  p_now timestamptz default now(),
  p_scan_retention_days integer default 90
)
returns table (
  codes_removed integer,
  pairings_removed integer,
  sessions_ended integer,
  scans_removed integer
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c integer;
  p integer;
  s integer;
  r integer;
begin
  delete from public.attendance_checkin_codes where valid_until <= p_now - interval '1 hour';
  get diagnostics c = row_count;

  delete from public.attendance_display_pairings where expires_at <= p_now - interval '1 hour';
  get diagnostics p = row_count;

  update public.attendance_checkin_sessions as s
     set status = 'ended', ended_at = coalesce(s.ended_at, p_now)
   where s.status = 'active' and s.expires_at <= p_now;
  get diagnostics s = row_count;

  update public.attendance_kiosk_sessions as k
     set status = 'ended', ended_at = coalesce(k.ended_at, p_now), credential_hash = null
   where k.status in ('pending', 'active') and k.expires_at <= p_now;

  delete from public.attendance_qr_scan_redemptions
   where redeemed_at <= p_now - make_interval(days => greatest(1, p_scan_retention_days));
  get diagnostics r = row_count;

  return query select c, p, s, r;
end;
$$;

revoke all on function public.purge_attendance_checkin_artifacts(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.purge_attendance_checkin_artifacts(timestamptz, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Server only, every one of them. These tables hold capabilities and their
-- hashes; nothing client-side reads or writes one, and there is no policy that
-- would let it. A browser reaching Supabase directly with an authenticated JWT
-- sees no rows here, because there are no policies to match.

alter table public.attendance_checkin_sessions enable row level security;
alter table public.attendance_checkin_codes enable row level security;
alter table public.attendance_display_pairings enable row level security;
alter table public.attendance_qr_scan_redemptions enable row level security;
alter table public.attendance_kiosk_sessions enable row level security;

revoke all on public.attendance_checkin_sessions from public, anon, authenticated;
revoke all on public.attendance_checkin_codes from public, anon, authenticated;
revoke all on public.attendance_display_pairings from public, anon, authenticated;
revoke all on public.attendance_qr_scan_redemptions from public, anon, authenticated;
revoke all on public.attendance_kiosk_sessions from public, anon, authenticated;

notify pgrst, 'reload schema';
